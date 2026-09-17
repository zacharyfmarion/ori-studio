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
- [x] Correct AUX continuity and shared graph vertices, verify that solving excludes AUX folds while preserving reference geometry, and reproduce Swift Dragon in the browser before release.
- [x] Verify the hosted preview, required CI, and merge PR #384.
- [x] Verify production code before publishing any model assets.
- [x] Publish verified weights and new registry; leave the legacy registry intact.
- [x] Verify production deployment, model integrity, and browser recognition.
- [x] Record release evidence and customer update instructions.

## Release record

PR #384 merged after all checks passed. Production deployment
[35143652346](https://github.com/zacharyfmarion/ori-studio/actions/runs/35143652346)
contains the detector change plus an unrelated precrease-planner merge. The
production entry assets and candidate browser behavior were verified at
20:08 UTC, before publishing any weights or registry. Published model integrity
and the unchanged legacy registry were verified at 20:09 UTC.

Production Swift Dragon: 5.227 s, 407 edges including 40 AUX edges, 46 shared
AUX/physical vertices, no loose AUX ends, and unchanged physical geometry. The
existing-cache update path also passes. Dwarf: 14.893 s and all 2,327 edges,
assignments, and coordinates identical to the previously verified exact result.
Evidence is under the ignored `artifacts/cp-recognition/release-20260916/` tree
and the durable external research archive.

Browser customers refresh the app and choose Download in Detect if an older
model is installed; new installations select detector v2 automatically. Older
desktop builds retain their compatible model. This rollout publishes no desktop
binary; an updated desktop release is required to adopt the pixel runtime there.
