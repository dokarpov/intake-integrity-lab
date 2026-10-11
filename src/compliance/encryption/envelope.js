import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encryptAes256Gcm(plaintext,key,{aad}={}){
  const bytes=Buffer.isBuffer(plaintext)?plaintext:Buffer.from(plaintext);if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('aes256_key_required');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);if(aad)cipher.setAAD(Buffer.from(aad));const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);return{ciphertext,iv,tag:cipher.getAuthTag(),aad:aad||null};
}
export function decryptAes256Gcm({ciphertext,iv,tag,aad},key){if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('aes256_key_required');const d=createDecipheriv('aes-256-gcm',key,Buffer.from(iv));if(aad)d.setAAD(Buffer.from(aad));d.setAuthTag(Buffer.from(tag));return Buffer.concat([d.update(Buffer.from(ciphertext)),d.final()]);}

export async function encryptForArchive(bytes,{dataKeyProvider,aad='compliance-ledger-archive-v2',context={}}={}){
  if(!dataKeyProvider?.generateDataKey)throw new Error('data_key_provider_required');const generated=await dataKeyProvider.generateDataKey({context});const key=Buffer.from(generated.plaintextKey);
  try{const encrypted=encryptAes256Gcm(bytes,key,{aad});return{ciphertext:encrypted.ciphertext,envelope:{schemaVersion:'2.0',algorithm:'AES-256-GCM',keyProvider:generated.provider,keyId:generated.keyId,wrappedDataKey:Buffer.from(generated.wrappedKey).toString('base64'),iv:encrypted.iv.toString('base64'),tag:encrypted.tag.toString('base64'),aad,encryptionContext:generated.encryptionContext||context}};}finally{key.fill(0)}
}
export async function decryptArchive({ciphertext,envelope},{dataKeyProvider}={}){const context=envelope.encryptionContext||{};const key=Buffer.from(await dataKeyProvider.decryptDataKey(Buffer.from(envelope.wrappedDataKey,'base64'),{keyId:envelope.keyId,context}));try{return decryptAes256Gcm({ciphertext,iv:Buffer.from(envelope.iv,'base64'),tag:Buffer.from(envelope.tag,'base64'),aad:envelope.aad},key)}finally{key.fill(0)}}
