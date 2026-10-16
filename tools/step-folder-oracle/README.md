# Defox renderer compatibility

Ori Studio vendors the unmodified MIT Step-Folder/Defox source at the commit
recorded in `upstream-sync.json`. `defoxOracle.test.js` compares our worker's
inert SVG DOM adapter with that same source drawing into a real jsdom document.
It covers all 16 symbol kinds, transformations, distortion/cycles, and the
saved cell-state branch. Repeat-label font metrics are deterministic in both
environments; the production adapter measures with OffscreenCanvas.

```sh
cd apps/web
npx vitest run src/diagram/import/defoxOracle.test.js src/diagram/import/defoxRenderer.test.ts
# Optional private corpus, never checked in:
ORI_DEFOX_CORPUS=/absolute/path/project.defox npx vitest run src/diagram/import/defoxRenderer.test.ts
```

The external browser harness also exercises sanitization, live CP placement,
links, native project save/reopen, and screenshots:

```sh
DEV_SERVER_PORT=5237 scripts/dev-server.sh start
node scripts/diagram-import-check.mjs /absolute/path/project.defox
node scripts/diagram-import-check.mjs /absolute/path/cp-folder
node scripts/diagram-import-check.mjs /absolute/path/cp-folder finish
```

Outputs belong under the ignored `artifacts/diagram-import/` directory. Never
commit user input files, rendered pictures, project exports, or CPU profiles.
The compatibility target is the pinned saved-state format, not every historical
or future `.defox` variant. Saved views must have one resolvable paper region;
unsupported entries are reported individually rather than linked to the wrong
sheet. Appearance is retained as sanitized SVG; symbols are not converted into
editable Ori Studio annotations. Changing a Defox view's pose explicitly
replaces it with an Ori Studio capture.
