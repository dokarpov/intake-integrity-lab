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


## Code orientation for new engineers

The service runs on **Node.js** with ES modules. The code is intentionally
separated by responsibility rather than by an imposed framework:

| Entry / module | Responsibility |
| --- | --- |
| `service/server.mjs` | Boots the HTTP service and wires runtime configuration |
| `src/service/app.js` | Composes the API; still a large candidate for later router extraction |
| `src/service/auth/authenticator.js` | Authenticated principal boundary |
| `src/service/auth/oidc-verifier.js` | OIDC/JWT validation |
| `src/service/auth/rbac.js` | Role and permission rules |
| `src/service/http/io.js` | HTTP response/request utilities |
| `src/service/http/rate-limit.js` | Bounded local sliding-window limiter (not distributed) |
| `src/service/runtime.js` | Tenant-aware runtime selection |
| `src/intake-machine.js` | Intake state transitions |
| `src/delivery/outbox.js` | Reliable delivery queue behavior |
| `src/delivery/postgres-outbox-store.js` | Persistent outbox adapter |
| `src/compliance/audited-intake.js` | Audit-aware intake |
| `src/policy/review-routing.js` | Human review routing |
| `tests/*.test.js` | Unit/contract tests, including capacity and security checks |
| `tests/integration/*.live.test.js` | Conditional external live integration tests |

Local onboarding: `npm install`, `npm test`, then `npm run service`
for a configured backend or `npm run demo` for static preview.
Live PostgreSQL, AWS and 1C tests require their own authorized environments;
a green unit CI does not mean production integration is active.

**Architecture trade-off:** a single Node service with separated domain modules
is more proportionate at this stage than introducing independently deployed
microservices. The API composition file can be split gradually once stable
route ownership and contract tests are established.
