# Control SLOs

Suggested control objectives are configuration, not legal defaults:

- required audit write failure: **0 tolerated material actions**; fail closed;
- checkpoint maximum age: 5–15 minutes;
- immutable anchor maximum age: 30–60 minutes;
- immutable archive quorum: at least 1, preferably 2 independently administered targets for high-assurance deployments;
- chain verification: continuous incremental verification + full scheduled verification;
- key-expiry warning: 30+ days;
- break-glass grant: 10–15 minutes maximum by default;
- audit export: reason + actor + scope recorded before/after export;
- recovery drill: periodic and after material infrastructure changes.

The `ControlMonitor` reports stale checkpoints, missing/stale WORM anchors, audit write failures, key-expiry risk, integrity failure and access-denial spikes.
