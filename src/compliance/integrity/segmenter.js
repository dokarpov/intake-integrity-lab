import { sha256 } from '../crypto.js';
import { merkleRoot } from './merkle.js';

export function buildLedgerSegment(events, { ledgerId, segmentId, createdAt = new Date().toISOString() } = {}) {
  if (!events?.length) throw new Error('segment_requires_events');
  const summary = {
    schemaVersion: '1.0',
    ledgerId: ledgerId || events[0].ledgerId,
    segmentId: segmentId || `${events[0].sequence}-${events.at(-1).sequence}`,
    createdAt,
    fromSequence: events[0].sequence,
    toSequence: events.at(-1).sequence,
    eventCount: events.length,
    firstEventHash: events[0].eventHash,
    terminalEventHash: events.at(-1).eventHash,
    merkleRoot: merkleRoot(events.map(e => e.eventHash)),
    eventsDigest: sha256(events.map(e => ({ sequence: e.sequence, eventHash: e.eventHash })))
  };
  return { summary, events: structuredClone(events) };
}
