# Universal sales model

v0.2 separates intake integrity from any particular sales domain.

The canonical envelope contains:

- source/channel/campaign;
- primary contact;
- optional parties with roles;
- product/offer/manager/pipeline metadata;
- required privacy/data-processing state;
- optional marketing consent;
- freeform metadata for configuration-specific extension.

The core deliberately does not prescribe a CRM schema, funnel, or 1C configuration.

## Optional parties

The built-in role vocabulary is intentionally broad:

- primary contact;
- buyer;
- billing contact;
- authorized representative;
- beneficiary;
- other.

A B2B sale may only use `primary_contact + buyer`. A family/education/insurance flow may use representative and beneficiary. A simple retail lead may only use the primary contact.

## Dedup modes

### off

No semantic deduplication. Suitable when:

- 1C already owns duplicate control;
- CRM cleanup is out of scope;
- the team only needs safe intake, validation, audit and reliable delivery.

### local

Runs the public reference identity policy and exposes explicit review paths.

### external

Consumes a routing decision from an external system. Useful when CRM/1C already has its own matching engine but the intake UI still needs consistent states such as `review` and `error`.
