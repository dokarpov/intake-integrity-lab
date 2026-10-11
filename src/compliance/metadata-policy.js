const EMAIL=/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const JWT=/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/;
const AUTH=/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{8,}/i;
const PRIVATE_KEY=/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;

export function scanSensitiveMetadataValues(value,path='metadata',found=[]){
 if(value==null)return found;
 if(typeof value==='string'){
   if(value.length>2048)found.push(`${path}:oversized_string`);
   if(EMAIL.test(value))found.push(`${path}:email_like`);
   if(JWT.test(value)||AUTH.test(value))found.push(`${path}:credential_like`);
   if(PRIVATE_KEY.test(value))found.push(`${path}:private_key_like`);
   return found;
 }
 if(Array.isArray(value)){value.forEach((v,i)=>scanSensitiveMetadataValues(v,`${path}[${i}]`,found));return found;}
 if(typeof value==='object')for(const[k,v]of Object.entries(value))scanSensitiveMetadataValues(v,`${path}.${k}`,found);
 return found;
}
