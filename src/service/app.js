import { readJson, sendJson, sendNoContent, errorBody, correlationId } from './http/io.js';
import { requirePermission } from './auth/rbac.js';
import { processSalesIntakeAudited, resolveReviewAudited } from '../compliance/audited-intake.js';
import { AUDIT_ACTION, DATA_CLASS, RESULT } from '../compliance/event-catalog.js';
import { buildOneCHttpServiceRequest } from '../integrations/one-c/http-service.js';
import { buildSalesEnvelope } from '../sales-envelope.js';
import { sha256 } from '../compliance/crypto.js';

function actor(principal){return{type:'human',id:principal.id}}
function pathMatch(path,pattern){const a=path.split('/').filter(Boolean),b=pattern.split('/').filter(Boolean);if(a.length!==b.length)return null;const params={};for(let i=0;i<b.length;i++){if(b[i].startsWith(':'))params[b[i].slice(1)]=decodeURIComponent(a[i]);else if(a[i]!==b[i])return null}return params}
function parseLimit(v,def=100,max=500){const n=Number(v);return Number.isFinite(n)?Math.max(1,Math.min(max,Math.trunc(n))):def}
function subjectRefString(ref){return typeof ref==='string'?ref:ref?.ref}
function operationAudit(policy,principal,subjectRef,extra={}){return{actor:actor(principal),subjectRef,...policy,policyRefs:policy.policyRefs||[],...extra}}
function httpStatusFor(error){if(error.statusCode)return error.statusCode;if(/idempotency_key_payload_conflict|enquiry_already_decided|delivery_lease_conflict/.test(String(error.message||'')))return 409;const m=String(error.message||'');if(/required|invalid|not_allowed|fields_|missing|unsupported|transition|conflict|already|not_proposed|not_approved/.test(m))return 400;if(/not_found/.test(m))return 404;if(/forbidden|denied/.test(m))return 403;if(/claim/.test(m)&&/conflict|another/.test(m))return 409;return 500}

export function createApiHandler({authenticator,runtimes,policies,rateLimiter,intakeConfig={},oneCConfig=null,identityResolver=null,fetchFn=globalThis.fetch,controlStatusProvider=null,integrityStore=null,integrityEvidenceVerifier=null,sandboxEvidenceProvider=null,sandboxCrmSimulator=null,sourceComparisonStore=null}={}){
  if(!authenticator||!runtimes||!policies)throw new Error('service_dependencies_required');
  return async function handler(req,res){
    const requestId=correlationId(req);res.setHeader('x-request-id',requestId);res.setHeader('referrer-policy','no-referrer');res.setHeader('permissions-policy','camera=(), microphone=(), geolocation=()');
    try{
      const url=new URL(req.url,'http://service.local');
      if(req.method==='GET'&&url.pathname==='/healthz')return sendJson(res,200,{ok:true,service:'intake-integrity',version:'0.6.0'},{requestId});
      if(req.method==='GET'&&url.pathname==='/readyz'){
        if(integrityStore?.pool?.query){
          try{await integrityStore.pool.query('SELECT 1 FROM sales_incoming_enquiries LIMIT 1')}
          catch{return sendJson(res,503,{ok:false,error:'database_unavailable'},{requestId})}
        }
        return sendJson(res,200,{ok:true},{requestId});
      }
      let principal;try{principal=await authenticator.authenticate(req)}catch(e){e.statusCode=e.statusCode||401;e.code=e.code||'unauthorized';throw e}const rt=runtimes.tenant(principal.tenantId);
      const rl=rateLimiter?.check(`${principal.tenantId}:${principal.id}:${url.pathname}`,url.pathname.startsWith('/api/audit/export')?{limit:10,windowMs:60_000}:undefined);if(rl&&!rl.allowed){res.setHeader('retry-after',String(Math.ceil(rl.retryAfterMs/1000)));throw Object.assign(new Error('rate_limit_exceeded'),{statusCode:429})}

      if(req.method==='GET'&&url.pathname==='/api/me')return sendJson(res,200,{id:principal.id,name:principal.name,tenantId:principal.tenantId,roles:principal.roles,permissions:[...principal.permissions].sort()},{requestId});

      // Opt-in transactional PostgreSQL integrity v2. The existing API stays unchanged.
      // Authenticated tenant/actor always override browser-provided fields.
      if(url.pathname.startsWith('/api/integrity/')){
        if(!integrityStore)throw Object.assign(new Error('integrity_v2_disabled'),{statusCode:404});
        if(req.method==='POST'&&url.pathname==='/api/integrity/sandbox/crm/run'){
          requirePermission(principal,'integration.test');
          if(!sandboxCrmSimulator||principal.tenantId!=='staging-demo')
            throw Object.assign(new Error('sandbox_disabled'),{statusCode:404});
          const body=await readJson(req);
          const result=await sandboxCrmSimulator.runOnce({
            mode:body.mode==='lost_ack'?'lost_ack':'success',limit:1,outboxId:body.outboxId
          });
          return sendJson(res,200,result,{requestId});
        }
        if(req.method==='POST'&&url.pathname==='/api/integrity/sandbox/crm/reconcile'){
          requirePermission(principal,'integration.test');
          if(!sandboxCrmSimulator||principal.tenantId!=='staging-demo')
            throw Object.assign(new Error('sandbox_disabled'),{statusCode:404});
          const body=await readJson(req);
          const result=await sandboxCrmSimulator.reconcile({outboxId:body.outboxId});
          return sendJson(res,200,result,{requestId});
        }
        if(req.method==='POST'&&url.pathname==='/api/integrity/sandbox/evidence'){
          requirePermission(principal,'review.resolve');
          if(!sandboxEvidenceProvider)throw Object.assign(new Error('sandbox_disabled'),{statusCode:404});
          const body=await readJson(req);
          const result=await sandboxEvidenceProvider.issue({
            ...body,tenantId:principal.tenantId,actorId:principal.id
          });
          return sendJson(res,200,result,{requestId});
        }
        if(sourceComparisonStore&&url.pathname.startsWith('/api/integrity/sources/')){
          if(req.method==='GET'&&url.pathname==='/api/integrity/sources/latest'){
            requirePermission(principal,'review.read');
            return sendJson(res,200,await sourceComparisonStore.latest({tenantId:principal.tenantId}),{requestId});
          }
          if(req.method==='GET'&&url.pathname==='/api/integrity/sources/comparison/latest'){
            requirePermission(principal,'review.read');
            return sendJson(res,200,(await sourceComparisonStore.latestComparison({tenantId:principal.tenantId}))||{comparisonId:null},{requestId});
          }
          if(req.method==='POST'&&url.pathname==='/api/integrity/sources/snapshots'){
            requirePermission(principal,'integration.test');
            const value=await readJson(req,64000);
            return sendJson(res,201,await sourceComparisonStore.importSnapshot({...value,tenantId:principal.tenantId,actorRef:principal.id}),{requestId});
          }
          if(req.method==='POST'&&url.pathname==='/api/integrity/sources/compare'){
            requirePermission(principal,'review.read');
            return sendJson(res,200,await sourceComparisonStore.compareLatest({tenantId:principal.tenantId,actorRef:principal.id}),{requestId});
          }
          if(req.method==='GET'&&url.pathname==='/api/integrity/sources/assessments'){
            requirePermission(principal,'review.read');
            return sendJson(res,200,{items:await sourceComparisonStore.assessments({tenantId:principal.tenantId,comparisonId:url.searchParams.get('comparisonId')})},{requestId});
          }
          if(req.method==='POST'&&url.pathname==='/api/integrity/sources/assessments'){
            requirePermission(principal,'review.resolve');
            const value=await readJson(req);
            return sendJson(res,201,await sourceComparisonStore.assess({...value,tenantId:principal.tenantId,actorRef:principal.id}),{requestId});
          }
        }
        if(req.method==='POST'&&url.pathname==='/api/integrity/intakes'){
          requirePermission(principal,'intake.submit');
          const body=await readJson(req);
          const record=await integrityStore.receiveEnquiry({...body,tenantId:principal.tenantId,actorId:principal.id});
          return sendJson(res,record.replayed?200:201,record,{requestId});
        }
        if(req.method==='GET'&&url.pathname==='/api/integrity/intakes'){
          requirePermission(principal,'review.read');
          const items=await integrityStore.listIntakes({
            tenantId:principal.tenantId,limit:parseLimit(url.searchParams.get('limit'),50,100)
          });
          return sendJson(res,200,{items},{requestId});
        }
        if(req.method==='GET'&&url.pathname==='/api/integrity/people'){
          requirePermission(principal,'review.read');
          const items=await integrityStore.listPeople({
            tenantId:principal.tenantId,limit:parseLimit(url.searchParams.get('limit'),100,100)
          });
          return sendJson(res,200,{items},{requestId});
        }
        let detailMatch=pathMatch(url.pathname,'/api/integrity/intakes/:id');
        if(req.method==='GET'&&detailMatch){
          requirePermission(principal,'review.read');
          const record=await integrityStore.getIntake({
            tenantId:principal.tenantId,intakeId:detailMatch.id
          });
          if(!record)throw Object.assign(new Error('intake_not_found'),{statusCode:404});
          return sendJson(res,200,record,{requestId});
        }
        detailMatch=pathMatch(url.pathname,'/api/integrity/intakes/:id/deliveries');
        if(req.method==='GET'&&detailMatch){
          requirePermission(principal,'integration.read');
          const items=await integrityStore.outboxForIntake({
            tenantId:principal.tenantId,intakeId:detailMatch.id
          });
          return sendJson(res,200,{items},{requestId});
        }
        let match=pathMatch(url.pathname,'/api/integrity/intakes/:id/candidates');
        if(req.method==='GET'&&match){
          requirePermission(principal,'review.read');
          const records=await integrityStore.candidates({tenantId:principal.tenantId,intakeId:match.id});
          return sendJson(res,200,{items:records},{requestId});
        }
        match=pathMatch(url.pathname,'/api/integrity/intakes/:id/history');
        if(req.method==='GET'&&match){
          requirePermission(principal,'audit.read');
          const history=await integrityStore.history({tenantId:principal.tenantId,intakeId:match.id});
          return sendJson(res,200,history,{requestId});
        }
        match=pathMatch(url.pathname,'/api/integrity/intakes/:id/decisions');
        if(req.method==='POST'&&match){
          requirePermission(principal,'review.resolve');
          if(!integrityEvidenceVerifier?.verifyDecision){
            throw Object.assign(new Error('trusted_evidence_verifier_required'),{statusCode:503});
          }
          const body=await readJson(req);
          // Verify source of identity/permission evidence, not just a JSON flag.
          const result=await integrityEvidenceVerifier.verifyDecision({
            tenantId:principal.tenantId,actorId:principal.id,intakeId:match.id,
            action:body.action,personId:body.personId,identityEvidenceRef:body.identityEvidenceRef,
            consentEvidenceRef:body.consentEvidenceRef
          });
          if(result!==true)throw Object.assign(new Error('decision_evidence_not_verified'),{statusCode:403});
          const record=await integrityStore.decideEnquiry({
            ...body,tenantId:principal.tenantId,intakeId:match.id,actorId:principal.id
          });
          return sendJson(res,200,record,{requestId});
        }
        throw Object.assign(new Error('route_not_found'),{statusCode:404});
      }


      if(req.method==='POST'&&url.pathname==='/api/intakes'){
        requirePermission(principal,'intake.submit');const body=await readJson(req);const identitySeed=body.primaryContact?.phone||body.primaryContact?.email;if(!identitySeed)throw Object.assign(new Error('primary_contact_phone_or_email_required'),{statusCode:400});const subjectRef=await runtimes.subjectRef(identitySeed);
        const p=policies.auditContext('intake',principal,subjectRef);
        const dedupMode=intakeConfig.dedupMode||'off';let externalDecision, envelopeOptions;
        if(dedupMode==='external'){if(!identityResolver?.resolve)throw Object.assign(new Error('external_identity_resolver_required'),{statusCode:503});const preview=buildSalesEnvelope(body);externalDecision=await identityResolver.resolve(preview,{principal});envelopeOptions={intakeId:preview.intakeId,now:()=>preview.submittedAt}}
        const result=await processSalesIntakeAudited(body,{ledger:rt.ledger,reviewQueue:rt.reviews,auditContext:p,dedupMode,candidates:intakeConfig.candidates||[],externalDecision,envelopeOptions});
        let delivery=null;
        if(result.ok&&result.deliverable&&oneCConfig){const request=buildOneCHttpServiceRequest(result.envelope,oneCConfig);delivery=await rt.outbox.enqueue({tenantId:principal.tenantId,intakeId:result.envelope.intakeId,destination:'1c',request:{...request,authRef:'one-c-runtime-credential'}})}
        return sendJson(res,result.ok?202:422,{intakeId:result.envelope.intakeId,ok:result.ok,deliverable:result.deliverable??false,route:result.resolution?.route||'blocked',reviewId:result.reviewItem?.id||null,delivery:delivery?{id:delivery.id,status:delivery.status}:null,errors:result.validation?.errors||[]},{requestId});
      }

      if(req.method==='GET'&&url.pathname==='/api/deliveries'){
        requirePermission(principal,'integration.read');const intakeId=url.searchParams.get('intakeId');if(!intakeId||intakeId.length>160)throw Object.assign(new Error('valid_intake_id_required'),{statusCode:400});
        const items=await rt.outbox.listForIntake({tenantId:principal.tenantId,intakeId});return sendJson(res,200,{items},{requestId});
      }

      if(req.method==='GET'&&url.pathname==='/api/reviews'){
        requirePermission(principal,'review.read');const list=await rt.reviews.list({status:url.searchParams.get('status')||undefined,assignee:url.searchParams.get('assignee')||undefined,queue:url.searchParams.get('queue')||undefined,priority:url.searchParams.get('priority')||undefined,limit:parseLimit(url.searchParams.get('limit'),200)});const stats=await rt.reviews.stats?.()||null;return sendJson(res,200,{items:list,stats},{requestId});
      }
      let m=pathMatch(url.pathname,'/api/reviews/:id/assign');if(req.method==='POST'&&m){requirePermission(principal,'review.assign');const body=await readJson(req);const item=await rt.reviews.assign(m.id,{actor:principal.id,assignee:body.assignee,reason:body.reason});const p=policies.get('review');await rt.ledger.append(operationAudit(p,principal,null,{action:AUDIT_ACTION.REVIEW_ASSIGNED,result:RESULT.SUCCESS,reasonCode:body.reason,object:{type:'review_item',ref:m.id},dataClasses:[DATA_CLASS.AUDIT_METADATA],metadata:{assignee:body.assignee}}));return sendJson(res,200,item,{requestId})}
      if(req.method==='POST'&&url.pathname==='/api/reviews/bulk-assign'){requirePermission(principal,'review.bulk_assign');const body=await readJson(req);if(!Array.isArray(body.ids)||!body.ids.length)throw Object.assign(new Error('review_ids_required'),{statusCode:400});const items=await rt.reviews.bulkAssign(body.ids,{actor:principal.id,assignee:body.assignee,reason:body.reason});const p=policies.get('review');for(const item of items)await rt.ledger.append(operationAudit(p,principal,null,{action:AUDIT_ACTION.REVIEW_ASSIGNED,result:RESULT.SUCCESS,reasonCode:body.reason,object:{type:'review_item',ref:item.id},dataClasses:[DATA_CLASS.AUDIT_METADATA],metadata:{assignee:body.assignee,bulk:true}}));return sendJson(res,200,{items},{requestId})}
      m=pathMatch(url.pathname,'/api/reviews/:id/claim');if(req.method==='POST'&&m){requirePermission(principal,'review.claim');const item=await rt.reviews.claim(m.id,{actor:principal.id});const p=policies.get('review');await rt.ledger.append(operationAudit(p,principal,null,{action:AUDIT_ACTION.REVIEW_CLAIMED,result:RESULT.SUCCESS,reasonCode:'review_claimed',object:{type:'review_item',ref:m.id},dataClasses:[DATA_CLASS.AUDIT_METADATA],metadata:{leaseUntil:item.leaseUntil}}));return sendJson(res,200,item,{requestId})}
      m=pathMatch(url.pathname,'/api/reviews/:id/resolve');if(req.method==='POST'&&m){requirePermission(principal,'review.resolve');const body=await readJson(req);const existing=await rt.reviews.get?.(m.id);const p=policies.auditContext('review',principal,null);const item=await resolveReviewAudited(rt.reviews,m.id,{actor:principal.id,decision:body.decision,targetRef:body.targetRef,note:body.note},{ledger:rt.ledger,auditContext:p,intakeId:existing?.intakeId});return sendJson(res,200,item,{requestId})}

      if(req.method==='GET'&&url.pathname==='/api/audit'){
        requirePermission(principal,'audit.read');const subjectRef=url.searchParams.get('subjectRef')||undefined;if(subjectRef)requirePermission(principal,'subject.read');const p=policies.get('audit');await rt.ledger.append(operationAudit(p,principal,subjectRef,{action:AUDIT_ACTION.ACCESS_GRANTED,result:RESULT.SUCCESS,reasonCode:'authorized_audit_review',object:{type:subjectRef?'subject_audit_view':'audit_view',ref:subjectRef?'subject-scope':(url.searchParams.get('intakeId')||'ledger')},dataClasses:[DATA_CLASS.AUDIT_METADATA],metadata:{scope:subjectRef?'subject':'ledger'}}));const items=await rt.ledger.query({intakeId:url.searchParams.get('intakeId')||undefined,subjectRef,action:url.searchParams.get('action')||undefined,result:url.searchParams.get('result')||undefined,afterSequence:Number(url.searchParams.get('afterSequence')||0),limit:parseLimit(url.searchParams.get('limit'))});return sendJson(res,200,{items},{requestId});
      }
      if(req.method==='POST'&&url.pathname==='/api/audit/export'){
        requirePermission(principal,'audit.export');const body=await readJson(req);const preset=body.preset||'auditor';const allowed=new Set(['auditor','dpo','security']);if(!allowed.has(preset))throw Object.assign(new Error('invalid_export_preset'),{statusCode:400});if(preset==='dpo')requirePermission(principal,'subject.read');const events=await rt.ledger.query({intakeId:body.intakeId,subjectRef:body.subjectRef,afterSequence:body.afterSequence||0,limit:Math.min(body.limit||1000,5000)});const p=policies.get('audit');const exportId=`export_${sha256({requestId,principal:principal.id,at:new Date().toISOString()}).slice(0,24)}`;await rt.ledger.append(operationAudit(p,principal,body.subjectRef,{action:AUDIT_ACTION.AUDIT_EXPORTED,result:RESULT.SUCCESS,reasonCode:'authorized_scoped_export',object:{type:'audit_export',ref:exportId},dataClasses:[DATA_CLASS.AUDIT_METADATA],metadata:{preset,eventCount:events.length}}));return sendJson(res,200,{exportId,preset,manifest:{eventCount:events.length,terminalEventHash:events.at(-1)?.eventHash||null},events},{requestId});
      }

      if(req.method==='GET'&&url.pathname==='/api/dsr'){requirePermission(principal,'dsr.read');return sendJson(res,200,{items:await rt.dsr.list({status:url.searchParams.get('status')||undefined,type:url.searchParams.get('type')||undefined,owner:url.searchParams.get('owner')||undefined,limit:parseLimit(url.searchParams.get('limit'),200)})},{requestId})}
      if(req.method==='POST'&&url.pathname==='/api/dsr'){
        requirePermission(principal,'dsr.create');const body=await readJson(req);if(!body.subjectIdentifier)throw Object.assign(new Error('subject_identifier_required'),{statusCode:400});const subjectRef=await runtimes.subjectRef(body.subjectIdentifier,'data-subject');const item=await rt.dsr.create({subjectRef:subjectRef.ref,type:body.type,requestedBy:principal.id,channel:body.channel,reasonCode:body.reasonCode,scope:body.scope});const p=policies.get('dsr');await rt.ledger.append(operationAudit(p,principal,subjectRef,{action:AUDIT_ACTION.DSR_REQUESTED,result:RESULT.PENDING,reasonCode:item.type,object:{type:'dsr_request',ref:item.id},dataClasses:[DATA_CLASS.AUDIT_METADATA],metadata:{requestType:item.type,dueAt:item.dueAt}}));return sendJson(res,201,item,{requestId});
      }
      m=pathMatch(url.pathname,'/api/dsr/:id/assign');if(req.method==='POST'&&m){requirePermission(principal,'dsr.transition');const body=await readJson(req);const item=await rt.dsr.assign(m.id,{actor:principal.id,owner:body.owner});return sendJson(res,200,item,{requestId})}
      m=pathMatch(url.pathname,'/api/dsr/:id/transition');if(req.method==='POST'&&m){requirePermission(principal,'dsr.transition');const body=await readJson(req);const item=await rt.dsr.transition(m.id,{actor:principal.id,to:body.to,reason:body.reason,evidenceRefs:body.evidenceRefs||[],outcome:body.outcome});const p=policies.get('dsr');await rt.ledger.append(operationAudit(p,principal,item.subjectRef,{action:item.status==='completed'?AUDIT_ACTION.DSR_COMPLETED:AUDIT_ACTION.DSR_TRANSITIONED,result:item.status==='completed'?RESULT.SUCCESS:RESULT.PENDING,reasonCode:body.reason,object:{type:'dsr_request',ref:item.id},dataClasses:[DATA_CLASS.AUDIT_METADATA],metadata:{requestType:item.type,status:item.status}}));return sendJson(res,200,item,{requestId})}

      if(req.method==='GET'&&url.pathname==='/api/policy-changes'){requirePermission(principal,'policy.read');return sendJson(res,200,{items:await rt.policies.list({status:url.searchParams.get('status')||undefined,policyId:url.searchParams.get('policyId')||undefined,limit:parseLimit(url.searchParams.get('limit'),200)})},{requestId})}
      if(req.method==='POST'&&url.pathname==='/api/policy-changes'){
        requirePermission(principal,'policy.propose');const body=await readJson(req);const item=await rt.policies.propose({...body,requestedBy:principal.id});const p=policies.get('policy');await rt.ledger.append(operationAudit(p,principal,null,{action:AUDIT_ACTION.POLICY_CHANGE_PROPOSED,result:RESULT.PENDING,reasonCode:body.reason,object:{type:'policy_change',ref:item.id},dataClasses:[DATA_CLASS.AUDIT_METADATA],evidenceRefs:[`policy-digest:${item.payloadDigest}`],metadata:{policyId:item.policyId,fromVersion:item.fromVersion,toVersion:item.toVersion,risk:item.risk}}));return sendJson(res,201,item,{requestId})}
      m=pathMatch(url.pathname,'/api/policy-changes/:id/approve');if(req.method==='POST'&&m){requirePermission(principal,'policy.approve');const body=await readJson(req);const item=await rt.policies.approve(m.id,{actor:principal.id,note:body.note});const p=policies.get('policy');await rt.ledger.append(operationAudit(p,principal,null,{action:AUDIT_ACTION.POLICY_CHANGE_APPROVED,result:RESULT.SUCCESS,reasonCode:body.note||'approved',object:{type:'policy_change',ref:item.id},dataClasses:[DATA_CLASS.AUDIT_METADATA],evidenceRefs:[`policy-digest:${item.payloadDigest}`],metadata:{approvalCount:item.approvals.length,requiredApprovals:item.requiredApprovals}}));return sendJson(res,200,item,{requestId})}
      m=pathMatch(url.pathname,'/api/policy-changes/:id/publish');if(req.method==='POST'&&m){requirePermission(principal,'policy.publish');const item=await rt.policies.publish(m.id,{actor:principal.id});const p=policies.get('policy');await rt.ledger.append(operationAudit(p,principal,null,{action:AUDIT_ACTION.POLICY_CHANGED,result:RESULT.SUCCESS,reasonCode:'approved_policy_published',object:{type:'policy',ref:item.policyId},dataClasses:[DATA_CLASS.AUDIT_METADATA],evidenceRefs:[`policy-digest:${item.payloadDigest}`],metadata:{fromVersion:item.fromVersion,toVersion:item.toVersion}}));return sendJson(res,200,item,{requestId})}

      if(req.method==='GET'&&url.pathname==='/api/controls/health'){requirePermission(principal,'controls.read');const integrity=await rt.ledger.verifyIntegrity(),review=await rt.reviews.stats?.(),delivery=await rt.outbox.stats?.({tenantId:principal.tenantId});const external=controlStatusProvider?await controlStatusProvider({principal,rt}):{};return sendJson(res,200,{integrity,review,delivery,...external},{requestId})}
      if(req.method==='POST'&&url.pathname==='/api/controls/verify'){requirePermission(principal,'controls.verify');const integrity=await rt.ledger.verifyIntegrity();const p=policies.get('controls');await rt.ledger.append(operationAudit(p,principal,null,{action:integrity.ok?AUDIT_ACTION.RECOVERY_VERIFIED:AUDIT_ACTION.INTEGRITY_FAILURE,result:integrity.ok?RESULT.SUCCESS:RESULT.FAILURE,reasonCode:integrity.ok?'operator_integrity_verification':'integrity_verification_failed',object:{type:'ledger',ref:rt.ledger.ledgerId},dataClasses:[DATA_CLASS.AUDIT_METADATA],metadata:{eventCount:integrity.eventCount}}));return sendJson(res,integrity.ok?200:503,integrity,{requestId})}

      if(req.method==='GET'&&url.pathname==='/api/integrations'){requirePermission(principal,'integration.read');return sendJson(res,200,{items:[oneCConfig?{id:'1c',type:'1c_http',status:'configured',baseUrlRef:sha256(oneCConfig.baseUrl).slice(0,16),dedupMode:intakeConfig.dedupMode||'off'}:{id:'1c',type:'1c_http',status:'not_configured'}]},{requestId})}
      if(req.method==='POST'&&url.pathname==='/api/integrations/1c/probe'){requirePermission(principal,'integration.test');if(!oneCConfig?.probePath)throw Object.assign(new Error('one_c_probe_not_configured'),{statusCode:409});const target=`${oneCConfig.baseUrl.replace(/\/$/,'')}/${oneCConfig.probePath.replace(/^\//,'')}`;const response=await fetchFn(target,{method:'GET',headers:{accept:'application/json'}});return sendJson(res,response.ok?200:502,{ok:response.ok,status:response.status,targetRef:sha256(target).slice(0,24)},{requestId})}

      return sendJson(res,404,{error:{code:'not_found',message:'Not found',requestId}},{requestId});
    }catch(error){const status=httpStatusFor(error);error.statusCode=status;return sendJson(res,status,errorBody(error,requestId),{requestId})}
  }
}
