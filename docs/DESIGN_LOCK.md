# APPROVED STAGING DESIGN — LOCKED

Both testing screens have fixed approved visual baselines.

- Main screen `demo/integrity.html` matches the approved pre-iteration Git blob `9853b6a3cb304b2cf110a8575eadb765d8e12136` byte-for-byte.
- CSV comparison `demo/source-comparison.html` uses the exact same base stylesheet, typography, white background, contrast, and compact spacing; its Git blob is pinned as `27000c1cf715c22530e58e3d915de115cce11163`.
- No new colors, gradients, accent palettes, typography, redesigned navigation, or hero artwork during backend iterations.
- A feature that needs its own page may not invent a separate design language. Add behavior through backend modules or a distinct testing artifact without changing the approved screens.
- CI runs `node scripts/verify-design-lock.mjs` and rejects any modifications. Even a benign HTML edit fails and requires an explicit baseline change.
- To revise visual design, obtain specific user approval first; do not silently update baselines with functional changes. Make the approved change in a separate, reviewed design iteration, then update this document and its pinned fingerprints.
- The public marketing site repository is distinct and untouched by this change.

Note: Git blob checks are an automated development guard, not tamper-proof GitHub branch protection. They work only when CI is enforced before release.
