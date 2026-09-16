# Ship the synthetic pixel recognizer

## Goal

Make the evaluated synthetic recognizer and automatic E027 bounded solve the
customer default, while keeping older installed clients compatible.

## Approach

Publish immutable weights and a pixel-capable registry. Updated browser and
desktop clients use `registry-pixel-v1.json`; older clients keep `registry.json`.
Retain the previous model in the new registry for rollback. Deploy the app code
first: the new registry route serves the old registry without caching until its
own channel is published. Verify the preview before merging, verify the
production code, then publish weights and verify downloaded bytes.
E027 already runs automatically for pixel-model imports; no separate switch is
needed. Existing desktop binaries require an app update to use the new runtime.

## Affected Areas

Model pointer/export/publisher, registry client, Cloudflare model route,
deployment smoke checks, release documentation.

## Checklist

- [x] Confirm E027 default behavior and inspect current release path.
- [x] Merge current main and check compatibility with older clients.
- [x] Implement and validate the compatible registry channel and release tools.
- [x] Diagnose and fix the narrow-border crop issue with a synthetic regression; exclude private input from every dataset.
- [ ] Verify the hosted preview, required CI, and merge PR #384.
- [ ] Verify production code before publishing any model assets.
- [ ] Publish verified weights and new registry; leave the legacy registry intact.
- [ ] Verify production deployment, model integrity, and browser recognition.
- [ ] Record release evidence and customer update instructions.
