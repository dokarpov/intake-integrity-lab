# Key lifecycle

Three different cryptographic purposes use separate keys:

| Purpose | Key | Required property |
| --- | --- | --- |
| checkpoint signatures | asymmetric signing key | private key never exportable |
| subject pseudonymisation | HMAC key | deterministic MAC, secret never in app config |
| archive encryption | symmetric KMS KEK / data-key service | envelope encryption |

## States

`active → retired → revoked → destroyed`

A purpose must have exactly one active key at a time in the local key registry. Historical checkpoints retain their `keyId` and algorithm so retired keys remain verifiable.

## Rotation

Rotation is recorded as a ledger control event. Retiring a key does not invalidate old evidence. Revocation/destruction should require two-person control and should happen only after validating that the organisation retains sufficient public verification material and legal/audit evidence.

## HMAC rotation

HMAC-based subject references are intentionally key-versioned. Rotating an HMAC key changes future pseudonyms. A lookup service that must find historical audit rows should try permitted historical active/retired key versions for a known subject identifier; it should not store a reverse map inside the audit ledger.
