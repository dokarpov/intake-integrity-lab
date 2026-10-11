# Live integration tests

The integration suites are deliberately opt-in. If a real external system is not configured, the test is `SKIP`, not a mock disguised as an integration test.

## PostgreSQL

```bash
npm install --no-save pg@8
TEST_DATABASE_URL=postgres://... npm run test:integration:postgres
```

The suite applies the included SQL migrations, performs concurrent ledger appends, verifies the chain, confirms the database mutation trigger blocks `UPDATE`, and exercises persisted review assignment/claim/resolve.

The GitHub workflow runs this test against a real PostgreSQL 16 service container.

## AWS sandbox

Required:

```text
AWS_LIVE_TESTS=1
AWS_REGION=...
AWS_WORM_BUCKET=...             # Object Lock already enabled
AWS_KMS_SIGNING_KEY_ID=...
AWS_KMS_ARCHIVE_KEY_ID=...
```

Optional test setting:

```text
AWS_WORM_TEST_MODE=GOVERNANCE
AWS_WORM_TEST_RETENTION_DAYS=1
```

The test writes an actual locked object. Use a dedicated sandbox bucket/prefix. A locked version may remain after the test by design.

The suite verifies:

- Object Lock + bucket versioning preflight;
- versioned WORM write and retention state;
- KMS asymmetric sign + verify;
- KMS data-key generate + decrypt round-trip with encryption context.

## 1C sandbox

The suite performs a real write. It refuses to run unless all safeguards are present:

```text
ONE_C_LIVE_TESTS=1
ONE_C_TEST_ENVIRONMENT=sandbox
ONE_C_TEST_ACKNOWLEDGE_WRITES=YES
ONE_C_TEST_BASE_URL=...
ONE_C_TEST_PATH=...
ONE_C_TEST_AUTH=...             # optional bearer value
```

Payload data is synthetic and uses an `.invalid` email address. Point this only at an isolated 1C sandbox / test information base.

Optional:

```text
ONE_C_TEST_VERIFY_REPLAY=1
```

This sends the same idempotency key twice and asserts that the receiver does not fail with a 5xx response. Receiver-specific record comparison is intentionally not invented by the generic test.
