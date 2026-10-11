import { randomUUID } from 'node:crypto';
export function correlationId(req){const v=req.headers['x-correlation-id'];return typeof v==='string'&&/^[A-Za-z0-9._:-]{8,128}$/.test(v)?v:`req_${randomUUID()}`}
export async function readJson(req,{maxBytes=256*1024}={}){
  const type=String(req.headers['content-type']||'');if(!type.toLowerCase().startsWith('application/json'))throw Object.assign(new Error('content_type_application_json_required'),{statusCode:415});
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw Object.assign(new Error('request_body_too_large'),{statusCode:413});chunks.push(chunk)}
  if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(new Error('invalid_json'),{statusCode:400})}
}
export function sendJson(res,status,body,{requestId}={}){const text=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(text),'cache-control':'no-store','x-content-type-options':'nosniff','x-request-id':requestId||''});res.end(text)}
export function sendNoContent(res,status=204,{requestId}={}){res.writeHead(status,{'cache-control':'no-store','x-content-type-options':'nosniff','x-request-id':requestId||''});res.end()}
export function errorBody(error,requestId){return{error:{code:error.code||error.message||'internal_error',message:(error.statusCode||0)>=500?'Internal server error':(error.publicMessage||error.message||'Request failed'),requestId}}}
