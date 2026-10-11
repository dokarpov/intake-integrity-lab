/**
 * Prevents duplicate outbound delivery of the exact same intakeId.
 * This is transport idempotency, not semantic customer deduplication.
 */
export class DeliveryLedger {
  constructor() {
    this.entries = new Map();
  }

  canDeliver(intakeId) {
    return !this.entries.has(intakeId);
  }

  record(intakeId, receipt = {}) {
    if (this.entries.has(intakeId)) throw new Error('duplicate_delivery_blocked');
    this.entries.set(intakeId, { intakeId, ...receipt });
    return this.entries.get(intakeId);
  }

  get(intakeId) {
    return this.entries.get(intakeId) || null;
  }
}
