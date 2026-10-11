# Architecture

## Core principle

The intake layer owns the integrity of an intake event, not every downstream business rule.

```text
input → canonical envelope → guards → optional dedup → route → adapter
```

### Canonical envelope

A stable, vendor-neutral object. CRM and 1C field names are mapping configuration, not domain logic.

### Guards

Mandatory consent and minimum-contact requirements fail closed before delivery.

### Optional dedup

`off` keeps semantic identity out of scope. `local` runs the reference policy. `external` lets 1C/CRM own identity matching while this layer owns the UX/product states around the decision.

### Review queue

Ambiguity is represented as a product state. It does not silently become a new record or overwrite an existing identity.

### Decision history

Important routing decisions are inspectable. The reference log avoids raw PII in decision events and hash-links entries for basic tamper evidence.

### Delivery boundary

Adapters build requests; they do not know the receiving system's internal business logic. A stable `intakeId` supports retry-safe integration patterns.
