import { AUDIT_ACTION, DATA_CLASS, LEGAL_BASIS, RESULT } from './event-catalog.js';

const PURPOSE={code:'compliance_control_plane',version:'1.0'};
const BASIS={basis:LEGAL_BASIS.NOT_APPLICABLE,reference:'security-and-accountability-control'};
export function recordControlEvent(ledger,{actor,action,objectRef,reasonCode,metadata={}}){return ledger.append({actor,action,result:RESULT.SUCCESS,reasonCode,purpose:PURPOSE,legalBasis:BASIS,object:{type:'control_plane',ref:objectRef},dataClasses:[DATA_CLASS.AUDIT_METADATA],metadata});}
export function recordArchiveAnchor(ledger,{actor,receipt}){return recordControlEvent(ledger,{actor,action:AUDIT_ACTION.ARCHIVE_ANCHORED,objectRef:receipt.segmentSummary.segmentId,reasonCode:'immutable_archive_quorum_satisfied',metadata:{checkpointId:receipt.checkpoint.checkpointId,archiveReceiptCount:receipt.archive.receipts.length,quorumSatisfied:receipt.archive.quorumSatisfied}})}
