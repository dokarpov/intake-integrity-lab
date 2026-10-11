# 1C audit integration

The ledger is deliberately outside 1C's internal schema. 1C may remain the system of record while the intake layer keeps independently verifiable evidence of delivery.

For each outbound operation record:

1. `integration.delivery_attempted`
   - intake ID;
   - destination system (`1c`);
   - HTTP method;
   - digest of endpoint reference;
   - digest of request body;
   - actor/service identity and purpose.
2. `integration.delivery_succeeded` or `integration.delivery_failed`
   - receiver status code;
   - optional opaque external record reference;
   - response digest, never copied response credentials/body by default.

This works for both the custom HTTP-service adapter and standard OData adapter. Semantic dedup may remain `off`, `local`, or `external`; audit evidence is independent of the matching strategy.
