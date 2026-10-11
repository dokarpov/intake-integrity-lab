# Atomicity and concurrency

The synchronous JSONL store is useful for a local demonstration but cannot safely serialize multiple application writers.

v0.4 adds `AsyncComplianceLedger` plus `PostgresLedgerStore`:

1. transaction begins;
2. `pg_advisory_xact_lock(hashtext(ledger_id))` serializes writers for one ledger;
3. previous event is read under the same transaction;
4. next sequence and hash are computed;
5. new event is inserted;
6. transaction commits.

`infra/postgres/001_ledger.sql` adds an UPDATE/DELETE rejection trigger. The production application role should additionally receive only `SELECT` and `INSERT`; schema-owner credentials must be separate from application runtime credentials.

The database is still not a WORM archive. It is the durable, transactional live ledger whose segments are independently sealed into WORM storage.
