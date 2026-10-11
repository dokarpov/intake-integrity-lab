# Dual control and break-glass

Sensitive control-plane operations require two distinct identities:

- legal-hold release;
- signing-key revoke/destroy;
- emergency break-glass access;
- retention-policy change;
- large audit export;
- immutable archive-target change.

Approval requests bind the requested action to a payload digest and expire. The requester cannot approve their own request. An approved request can be consumed once.

Break-glass access is a separate, short-lived grant created only from an approved two-person request. It grants named permissions until an explicit expiry and should itself generate `control.break_glass_granted` / `control.break_glass_used` audit events in the host application.
