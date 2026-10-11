import { canonicalize } from '../canonical-json.js';
import { sha256 } from '../crypto.js';
import { createHsmCheckpoint } from '../signing/async-checkpoint.js';
import { buildLedgerSegment } from '../integrity/segmenter.js';
import { encryptForArchive } from '../encryption/envelope.js';

/**
 * Produces a self-recovering immutable archive package:
 *  - payload object: encrypted segment bytes (or JSON when encryption disabled)
 *  - control object: non-secret envelope + manifest + receipts metadata needed to recover payload
 * Both objects are archived under the same retention policy/quorum.
 */
export async function anchorLedgerSegment(events, {
  signer,
  archiveManager,
  dataKeyProvider,
  timestampClient,
  ledgerId,
  segmentId,
  archiveKeyPrefix='segments',
  retainUntil,
  retentionDays,
  legalHold=false
}={}){
  if(!events?.length)throw new Error('anchor_requires_events');if(!signer||!archiveManager)throw new Error('anchor_signer_and_archive_required');
  const segment=buildLedgerSegment(events,{ledgerId,segmentId});
  const checkpoint=await createHsmCheckpoint(events,{signer});
  const manifest={schemaVersion:'2.0',ledgerId:segment.summary.ledgerId,segmentId:segment.summary.segmentId,segmentSummary:segment.summary,checkpoint,createdAt:new Date().toISOString()};
  const manifestDigest=`sha256:${sha256(manifest)}`;
  let timestamp=null;if(timestampClient)timestamp=await timestampClient.timestamp(Buffer.from(canonicalize(manifest),'utf8'));
  const packageObject={manifest,manifestDigest,timestamp,events:segment.events};
  const plaintext=Buffer.from(canonicalize(packageObject),'utf8');

  let payloadBytes=plaintext,encryptionEnvelope=null,payloadSuffix='json';
  if(dataKeyProvider){
    const context={ledger_id:manifest.ledgerId,segment_id:manifest.segmentId,checkpoint_id:checkpoint.checkpointId};
    const encrypted=await encryptForArchive(plaintext,{dataKeyProvider,aad:`${manifest.ledgerId}:${manifest.segmentId}`,context});
    payloadBytes=encrypted.ciphertext;encryptionEnvelope=encrypted.envelope;payloadSuffix='bin';
  }

  const base=`${archiveKeyPrefix}/${manifest.ledgerId}/${manifest.segmentId}/${checkpoint.checkpointId}`;
  const payloadKey=`${base}.payload.${payloadSuffix}`;
  const payloadArchive=await archiveManager.archive({key:payloadKey,bytes:payloadBytes,contentType:dataKeyProvider?'application/octet-stream':'application/json',metadata:{ledger_id:manifest.ledgerId,segment_id:manifest.segmentId,checkpoint_id:checkpoint.checkpointId,manifest_sha256:manifestDigest.replace('sha256:',''),object_role:'payload'},retainUntil,retentionDays,legalHold});

  const controlObject={schemaVersion:'2.0',manifest,manifestDigest,timestamp,encryptionEnvelope,payload:{key:payloadKey,digest:payloadArchive.digest,quorumReceipts:payloadArchive.receipts.map(r=>({archiveKind:r.archiveKind,bucket:r.bucket,key:r.key,versionId:r.versionId,retainUntil:r.retainUntil,legalHold:r.legalHold||false}))}};
  const controlBytes=Buffer.from(canonicalize(controlObject),'utf8');
  const controlKey=`${base}.control.json`;
  const controlArchive=await archiveManager.archive({key:controlKey,bytes:controlBytes,contentType:'application/json',metadata:{ledger_id:manifest.ledgerId,segment_id:manifest.segmentId,checkpoint_id:checkpoint.checkpointId,manifest_sha256:manifestDigest.replace('sha256:',''),object_role:'control'},retainUntil,retentionDays,legalHold});

  return{schemaVersion:'2.0',manifestDigest,checkpoint,segmentSummary:segment.summary,timestamp,encryptionEnvelope,payloadArchive,controlArchive,controlObject,anchoredAt:new Date().toISOString()};
}
