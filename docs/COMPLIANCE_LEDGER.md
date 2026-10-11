# Compliance Ledger

v0.3 replaces the lightweight v0.2 decision hash-chain with a dedicated audit/control plane.

## Guarantees provided by the reference implementation

- append-only event API;
- persistent JSONL store option;
- deterministic canonical event hashing;
- SHA-256 chain across every event;
- monotonically increasing sequence numbers;
- HMAC-SHA-256 pseudonymous subject references;
- Ed25519 signed checkpoints;
- explicit actor, action, result, purpose, legal basis, object and policy version;
- no raw PII/secrets in free-form metadata by default;
- audited access to the ledger itself;
- DSR, erasure, retention and legal-hold event types;
- 1C/CRM delivery evidence by request/response digest rather than payload copy;
- signed portable audit bundles.

## What it deliberately does not claim

The code alone does not make an organisation GDPR-, ISO-, SOC 2-, PCI- or otherwise certified/compliant. Compliance depends on the actual processing purpose and legal basis, controller/processor roles, policies, retention, access management, infrastructure, incident response, contracts, transfer safeguards and operational evidence.

A local JSONL file is **tamper-evident, not tamper-resistant**. Production should stream or periodically seal events/checkpoints into immutable/WORM storage under separately administered credentials.

## Event shape

Each material event records:

- `eventId`, `sequence`, `occurredAt`, `recordedAt`;
- tenant + processing activity;
- correlation/intake reference;
- pseudonymous `subjectRef` where necessary;
- attributable actor (`human`, `system`, `service`, `external`);
- action + result + reason code;
- versioned purpose and legal-basis record;
- target object reference;
- personal-data classes touched;
- changed field names and before/after digests when applicable;
- recipient/destination metadata;
- retention class/expiry;
- policy and evidence references;
- `previousEventHash` + `eventHash`.

Raw bodies, passwords, tokens, contact data and authentication secrets do not belong in the ledger.

## Integrity model

`eventHash = SHA-256(canonical(event_without_eventHash))`

Each event includes the previous event hash. `verifyIntegrity()` detects edited events, missing/reordered lines, broken sequence continuity and duplicate event IDs.

Periodically, a checkpoint signs the terminal chain state using Ed25519. A stolen application database is therefore insufficient to rewrite history silently if checkpoint public keys and immutable anchors are independently retained.

## Data-subject references

Direct identifiers should be transformed outside the ledger:

`subjectRef = HMAC-SHA-256(namespace + identifier, separately managed secret)`

HMAC is used rather than an unsalted hash because phone numbers and email addresses have a guessable search space. Key rotation must be managed as an explicit migration/lookup policy; the key ID is stored with the reference.
