# Swivel line selection and linked CP picker

## Goal
Make the two-line swivel usable with the normal Locate line toolbar and replace Fold import samples with selectable Edit patterns.

## Approach
Reproduce the private failing selection in both orders before changing geometry. Preserve physical guards, saved operation meaning, and explicit layer-order confirmation. Reuse Diagram pattern segmentation and region identity for per-pattern Collapse links; keep explicit Update from CP.

## Affected Areas
Fold swivel authoring, tool rail, CP import picker and capture, saved Collapse links and status; shared region capture and segmentation used by Fold and Diagram.

## Checklist
- [x] Reproduce and fix the reported swivel refusal without weakening guards.
- [x] Highlight the active line tool during both swivel line selections.
- [x] Replace samples with large Edit pattern thumbnails and region-specific links.
- [x] Verify saved links, updates, replay, and stale/canceled capture handling.
- [x] Run focused engine/UI validation and inspect the browser.

## Result and validation

- Reproduced the refusal with the same lines picked in the opposite order. That order names the other opening end of the folded edge. Authoring now asks about the reversed interpretation only when the initial one is physically blocked; it saves the successful explicit line order. Engine geometry and guards, and replay of existing operations, are unchanged.
- The rail and axiom-preview query share the active-line-mode predicate, including Swivel's two-line construction.
- The picker reuses the shared pattern segmentation and thumbnail generation. Region links export just the chosen pattern, retain a saved revision, follow an unchanged moved region, and refuse a missing region. Existing whole-document links still work. Capture/updates retain the existing project/sequence guards and analytics.
- Extracted the common region lookup and segmentation hooks out of Diagram, preserving the Fold/Diagram dependency boundary.
- 175 Fold/component/Diagram-capture test files, 1,379 tests passed; two additional private real-WASM canvas tests passed for both click orders with identical fingerprints and fresh replay. Scoped CP provenance replay also passed through the built bridge.
- Typecheck, web lint (one existing StepFilmstrip compiler warning), i18n check, and diff check passed. No Rust behavior, bridge, routing, or production build changes; no new Rust/WASM rebuild or production build needed.
- Browser: authored upper line first, lower line second, selected Inside and committed step 36. Verified active Axiom 1 highlight. A separate three-pattern fixture showed large thumbnails, linked only the middle pattern, and successfully ran explicit Update from CP without adding a step. User model preserved byte-for-byte; private evidence stays ignored.
