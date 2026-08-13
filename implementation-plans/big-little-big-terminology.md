# Big-Little-Big Terminology

## Goal

Rename the flat-foldability rule we currently call **little-big-little** to its
correct name, **big-little-big**, across the UI, the eight translated locales,
and our own Rust/TypeScript identifiers.

The rule is Hull's Big-Little-Big Lemma: at a flat-foldable vertex, a sector
angle strictly smaller than both of its neighbours forces the two creases
bounding it to take opposite mountain/valley assignments. It is universally
called *big-little-big* in the origami-mathematics literature — the outer two
sectors are the "big"s. Oriedita, which we ported the check from, names it
`LittleBigLittleViolation`, and our port inherited that name into user-visible
strings. Reported by hayashi-stl in the FOLD community.

This is a naming change only. No check, threshold, geometry, or parity
behaviour changes.

## Approach

Rename in one pass so the wasm boundary stays consistent. The affected names
are transient diagnostic types that cross wasm as JSON; none of them appear in
a persisted format (`.osf`, share links), so there is no migration to write.

1. **Rust kernel** (`crates/oristudio-cp`): `FlatFoldabilityRule::BigLittleBig`,
   `BigLittleBigSegment`, the `big_little_big` field and its helper functions,
   the `"BigLittleBig"` rule label crossing wasm, and
   `FlatFoldabilityRuleCode::BigLittleBig` in the 3D fold wire (serde
   `snake_case` → `"big_little_big"`).
2. **Rust compiler** (`crates/oristudio-cp-compiler`): `BigLittleBigStatus`,
   `ConstraintSeverity::BigLittleBigFailure`, `big_little_big_failure`,
   `big_little_big_status`.
3. **TypeScript engine types**: `OristudioCpDiagnosticBigLittleBigSegment`, the
   `big_little_big` field, the `'big_little_big'` rule code, and the
   `'big-little-big'` marker shape.
4. **Rendering**: diagnostics geometry helpers (`cpBlbSectors`,
   `cpHasBlbWedges`), the regl wedge program comments, and the
   `--cp-diagnostic-blb-*` / `.cp-diagnostic-blb-sector` CSS tokens.
5. **UI copy**: `Check Maekawa/LBL` → `Check Maekawa/BLB`, the shape label, the
   foldability sentence, and the capability tooltips. English is authored
   inline; regenerate `public/locales/en/` with `i18n:extract`.
6. **Locales**: all eight carry the wrong ordering in their own language
   (`小-大-小`, `pequeño-grande-pequeño`, …). Reorder each to big-little-big and
   swap `LBL` → `BLB`, then `i18n:stamp` and `i18n:check`.
7. **Docs**: update the verbatim-acronym list in `apps/web/docs/i18n.md`.
8. **Rebuild and stage `apps/web/src/generated/oristudio-cp-wasm/`** — it is
   tracked, and nothing in CI rebuilds it.

## Not in scope

- `third_party/oriedita/**` — vendored upstream source; AGENTS.md forbids
  editing it. Upstream's `LittleBigLittleViolation` keeps its name.
- `tools/oriedita-oracle/src/OrieditaGeometryOracle.java` — it *imports*
  upstream's `LittleBigLittleViolation`, so that symbol cannot change, and its
  `lbl|` stdout tokens are an internal harness protocol whose rename would
  force a Java rebuild that rewrites ~200 tracked `.class` files for no gain.
  The token keeps its name with a note; the Rust side of the comparison uses
  the new field name.
- Completed `implementation-plans/*.md` — historical records of the work as it
  was done.

## Affected Areas

- `crates/oristudio-cp/src/{checks.rs,checks_spatial.rs,lib.rs,folding3d/wire.rs}`
- `crates/oristudio-cp/tests/{check_diagnostics.rs,oriedita_operations_oracle.rs,spherical_simplicity.rs}`
- `crates/oristudio-cp-compiler/src/{constraints.rs,assignments.rs,optimizer.rs}`
- `apps/web/src/engine/oristudioCpTypes.ts`
- `apps/web/src/cp-workspace/diagnostics/*`
- `apps/web/src/cp-workspace/folded/foldedFigureNotice.ts`
- `apps/web/src/cp-workspace/renderer/*`
- `apps/web/src/lib/{oristudioCpCommands.ts,workspaceCapabilities.ts}`
- `apps/web/src/menus/menuDefinition.ts`
- `apps/web/src/styles/theme.css`
- `apps/web/public/locales/**` (en generated + 8 translated)
- `apps/web/docs/i18n.md`
- `apps/web/src/generated/oristudio-cp-wasm/` (tracked build output)

## Checklist

- [x] Rename in `crates/oristudio-cp` (kernel, wire, tests)
- [x] Rename in `crates/oristudio-cp-compiler`
- [x] Rename TypeScript engine types and diagnostics/renderer code
- [x] Update CSS custom properties and class names
- [x] Update inline English UI copy and i18n keys
- [x] Regenerate English catalogs (`i18n:extract`)
- [x] Retranslate the affected keys in all eight locales, then `i18n:stamp`
- [x] Update `apps/web/docs/i18n.md` acronym list
- [x] Rebuild and stage `apps/web/src/generated/oristudio-cp-wasm/`
- [x] Validate: `cargo fmt --check`, `clippy`, `cargo test --workspace`
- [x] Validate: web lint, typecheck, unit tests, `i18n:check`
- [x] Run the Oriedita operations oracle against the tracked Java build
- [ ] Open draft PR against `main`
