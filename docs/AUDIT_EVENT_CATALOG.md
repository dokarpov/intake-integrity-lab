# Audit event catalog

Material categories included in v0.4:

- intake received / validation blocked;
- automated decision and human-review routing;
- human override with mandatory reason;
- consent document seen / granted / withdrawn;
- data create / update / read / export;
- DSR request / completion;
- erasure request / completion;
- outbound integration attempt / success / failure;
- retention assignment / expiry;
- legal hold place / release;
- audit access grant / denial;
- audit bundle export;
- policy and cryptographic-key changes;
- signed checkpoint creation;
- detected integrity failure.

Every new high-impact business action should be added to the catalog before implementation rather than hidden in generic `metadata`.
