import { canonicalize } from '../canonical-json.js';
import { createHash } from 'node:crypto';
import { sha256 } from '../crypto.js';
import { decryptArchive } from '../encryption/envelope.js';
import { verifyHsmCheckpoint } from '../signing/async-checkpoint.js';

export async function verifyArchivedSegment({payloadBytes,controlBytes,anchorReceipt,dataKeyProvider,signer,timestampClient}={}){
  const control=controlBytes?JSON.parse(Buffer.from(controlBytes).toString('utf8')):(anchorReceipt?.controlObject||anchorReceipt);
  if(!control?.manifest||!control?.manifestDigest)throw new Error('archive_control_object_required');
  const errors=[];
  if(`sha256:${sha256(control.manifest)}`!==control.manifestDigest)errors.push('manifest_digest_mismatch');
  if(control.payload?.digest){const actual=`sha256:${createHash('sha256').update(Buffer.from(payloadBytes)).digest('hex')}`;if(actual!==control.payload.digest)errors.push('payload_digest_mismatch')}
  let plaintext=Buffer.from(payloadBytes);
  if(control.encryptionEnvelope)plaintext=await decryptArchive({ciphertext:plaintext,envelope:control.encryptionEnvelope},{dataKeyProvider});
  const pkg=JSON.parse(plaintext.toString('utf8'));
  if(pkg.manifestDigest!==control.manifestDigest)errors.push('payload_manifest_digest_mismatch');
  const cpOk=await verifyHsmCheckpoint(pkg.manifest.checkpoint,pkg.events,{signer});if(!cpOk)errors.push('checkpoint_invalid');
  if(timestampClient&&pkg.timestamp){const ok=timestampClient.verify(Buffer.from(canonicalize(pkg.manifest),'utf8'),pkg.timestamp.tokenBase64);if(!ok)errors.push('timestamp_invalid')}
  return{ok:errors.length===0,errors,package:pkg,control};
}
