export class BreakGlassGrant {
  constructor({ subject, permissions, approvedRequest, now = () => new Date().toISOString(), ttlMs = 10 * 60_000 } = {}) {
    if (!subject || !permissions?.length || approvedRequest?.status !== 'approved') throw new Error('break_glass_approved_request_required');
    this.subject=subject; this.permissions=[...new Set(permissions)]; this.approvalId=approvedRequest.id; this.issuedAt=now(); this.expiresAt=new Date(Date.parse(this.issuedAt)+ttlMs).toISOString(); this.now=now;
  }
  allows(permission) { return Date.parse(this.now()) <= Date.parse(this.expiresAt) && this.permissions.includes(permission); }
}
