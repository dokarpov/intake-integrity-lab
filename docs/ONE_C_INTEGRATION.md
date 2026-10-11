# 1C integration boundary

The core does not require 1C to implement semantic deduplication.

Three deployment modes are supported:

1. `dedupMode: off` — validate and normalise sales intake, then deliver to 1C.
2. `dedupMode: local` — run the reference identity policy before delivery.
3. `dedupMode: external` — 1C/CRM/another identity service returns a routing decision; the intake layer still enforces review/error guards.

## Recommended first integration: custom HTTP service

The least coupled contract is a small HTTP endpoint in the customer's 1C configuration. The public package sends a canonical sales envelope or a field-mapped subset.

```text
Sales form / website / kiosk
          ↓
Intake Integrity Layer
  validate + audit + optional dedup
          ↓ POST JSON
1C custom HTTP service
          ↓
configuration-specific objects
```

Use `src/integrations/one-c/http-service.js` and `config/one-c.http.example.json`.

Benefits:

- the intake package never needs to know the internal 1C object graph;
- 1C developers own mapping into the local configuration;
- configuration changes stay behind the HTTP contract;
- semantic dedup may remain entirely inside 1C, outside 1C, or disabled.

## Standard OData option

If the infobase publishes the standard OData interface, `src/integrations/one-c/odata.js` builds a create request for a configured entity set. The entity-set and field names are intentionally configuration-specific and must be supplied by the integrator.

Use `config/one-c.odata.example.json` only as a template. `Catalog_SalesLeads` is a placeholder, not a claim about a standard 1C object.

## Idempotency is not deduplication

Every envelope has an `intakeId`, and outbound requests carry it as `X-Idempotency-Key`. `DeliveryLedger` can block a second local delivery of the same `intakeId`.

This protects against retry/double-submit duplication of one intake event. It does **not** decide whether two different intake events belong to the same customer.

For robust production integration, persist the idempotency key in the receiving system or middleware and make create operations replay-safe.

## Authentication

Example configs reference credentials by environment variable. Do not commit credentials to the repository.
