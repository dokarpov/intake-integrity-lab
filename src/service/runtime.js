import { AsyncComplianceLedger } from '../compliance/async-ledger.js';
import { MemoryAtomicLedgerStore } from '../compliance/storage/memory-atomic-store.js';
import { PostgresLedgerStore } from '../compliance/storage/postgres-store.js';
import { TeamReviewQueue } from '../review/team-review-queue.js';
import { PostgresTeamReviewStore } from '../review/postgres-team-review-store.js';
import { DsrWorkflowStore } from '../workflows/dsr-workflow.js';
import { PostgresDsrStore } from '../workflows/postgres-dsr-store.js';
import { PolicyChangeManager } from '../policy/change-manager.js';
import { PostgresPolicyChangeStore } from '../policy/postgres-change-store.js';
import { MemoryOutboxStore } from '../delivery/outbox.js';
import { PostgresOutboxStore } from '../delivery/postgres-outbox-store.js';
import { Pseudonymizer } from '../compliance/pseudonymizer.js';

export class TenantRuntimeRegistry{
  constructor({mode='memory',pool=null,strictLedger=true,defaultRetention,subjectHmacSecret='dev-only-change-me',subjectRefProvider=null}={}){if(mode==='postgres'&&!pool)throw new Error('postgres_pool_required');Object.assign(this,{mode,pool,strictLedger,defaultRetention});this.atomicStore=mode==='memory'?new MemoryAtomicLedgerStore():null;this.tenants=new Map();this.subjectRefProvider=subjectRefProvider||new Pseudonymizer({secret:subjectHmacSecret,keyId:mode==='memory'?'dev-subject-hmac':'service-subject-hmac'})}
  tenant(tenantId){if(!tenantId)throw new Error('tenant_required');if(this.tenants.has(tenantId))return this.tenants.get(tenantId);const rt=this.mode==='memory'?this._memory(tenantId):this._postgres(tenantId);this.tenants.set(tenantId,rt);return rt}
  async subjectRef(value,namespace='sales-contact'){return await this.subjectRefProvider.subjectRef(value,namespace)}
  _ledger(tenantId,store){return new AsyncComplianceLedger({tenantId,store,ledgerId:`sales-intake-ledger-v3:${tenantId}`,strict:this.strictLedger,defaultRetention:this.defaultRetention})}
  _memory(tenantId){return{tenantId,ledger:this._ledger(tenantId,this.atomicStore),reviews:new TeamReviewQueue(),dsr:new DsrWorkflowStore(),policies:new PolicyChangeManager(),outbox:new MemoryOutboxStore(),mode:'memory'}}
  _postgres(tenantId){const ledgerStore=new PostgresLedgerStore({pool:this.pool});return{tenantId,ledger:this._ledger(tenantId,ledgerStore),reviews:new PostgresTeamReviewStore({pool:this.pool,tenantId}),dsr:new PostgresDsrStore({pool:this.pool,tenantId}),policies:new PostgresPolicyChangeStore({pool:this.pool,tenantId}),outbox:new PostgresOutboxStore({pool:this.pool}),mode:'postgres'}}
}
