# Decision history

`DecisionHistory` is append-only and PII-light by default.

It records:

- validation blocks;
- routing outcome and reason;
- review-queue entry;
- future human resolution events;
- integration/delivery events when the application chooses to add them.

Events are hash-linked. This is not a cryptographic audit system or a compliance guarantee; it is a compact reference pattern for making product decisions inspectable without storing raw intake data in every log entry.
