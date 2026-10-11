export class ControlMonitor {
  constructor({ now = () => new Date().toISOString(), maxCheckpointAgeMs = 15 * 60_000, maxArchiveAgeMs = 60 * 60_000, keyExpiryWarningMs = 30 * 86400000 } = {}) {
    this.now=now; this.maxCheckpointAgeMs=maxCheckpointAgeMs; this.maxArchiveAgeMs=maxArchiveAgeMs; this.keyExpiryWarningMs=keyExpiryWarningMs;
  }
  evaluate({ ledgerIntegrity, checkpoints = [], archiveReceipts = [], keys = [], writeFailures = 0, deniedAccess = 0 } = {}) {
    const now=Date.parse(this.now()), alerts=[];
    if (ledgerIntegrity && !ledgerIntegrity.ok) alerts.push({ severity:'critical', code:'ledger_integrity_failed', details:ledgerIntegrity.errors });
    const lastCp=checkpoints.at(-1); if (!lastCp) alerts.push({severity:'critical',code:'checkpoint_missing'}); else if (now-Date.parse(lastCp.createdAt)>this.maxCheckpointAgeMs) alerts.push({severity:'high',code:'checkpoint_overdue'});
    const lastArchive=archiveReceipts.map(x=>Date.parse(x.archivedAt)).filter(Number.isFinite).sort((a,b)=>a-b).at(-1); if (!lastArchive) alerts.push({severity:'critical',code:'immutable_anchor_missing'}); else if (now-lastArchive>this.maxArchiveAgeMs) alerts.push({severity:'high',code:'immutable_anchor_overdue'});
    for (const k of keys) if (k.notAfter && Date.parse(k.notAfter)-now<this.keyExpiryWarningMs && k.status==='active') alerts.push({severity:'medium',code:'key_expiry_approaching',keyId:k.keyId});
    if (writeFailures>0) alerts.push({severity:'critical',code:'audit_write_failure',count:writeFailures});
    if (deniedAccess>=5) alerts.push({severity:'high',code:'audit_access_denial_spike',count:deniedAccess});
    return { ok: !alerts.some(a=>a.severity==='critical'), checkedAt:this.now(), alerts };
  }
}
