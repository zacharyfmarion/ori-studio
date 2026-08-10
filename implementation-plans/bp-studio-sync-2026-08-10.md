# Box Pleating Studio sync — 2026-08-10

## Goal

Decide whether upstream's `roughContour` stale-contour fix applies to
`crates/oristudio-bp`, and port it if it does.

This is the record a drift check would have produced. It came out of the
baseline re-vendor in `implementation-plans/upstream-drift-watcher.md`, moving
the pin from v0.7.14 to v0.7.15.

## Triage

Sixteen commits, 260 files touched in the vendored tree. Almost all of it is
outside the watch paths — `src/public` (111), `src/app` (78), `src/client` (15),
plus locale, icons and dependency churn. None of it is ours to care about.

Inside the watch paths:

| Path | Verdict |
| --- | --- |
| `src/shared/json/` | no changes — the `.bps` format did not move |
| `src/client/patches/migrations/` | no changes — no new format version |
| `src/core/design/layout/nodeSet.ts` | `SKIP-REFACTOR` — comment only |
| `src/core/design/tasks/traceContour.ts` | `SKIP-REFACTOR` — comment only |
| `src/core/utils/generator.ts` | `SKIP-REFACTOR` — comment only, documents existing behavior more precisely |
| `src/core/tsconfig.json` | `SKIP-REFACTOR` — `baseUrl` replaced by `paths`, build config |
| `src/core/design/tasks/roughContour.ts` | **`PORT` candidate** |

The format layer being untouched is the important negative result: a new
`Migration.$add` would have meant newly-saved `.bps` files were unopenable in
Ori Studio until ported, which is the highest-risk change class for this
upstream.

## The one candidate

```diff
-	if(!node.$parent) return false;
+	if(!node.$parent) {
+		// The root has no parent edge and therefore no rough contour of its own.
+		// Clear any contour it held as a former non-root, so that no stale
+		// contour referencing its previous subtree survives.
+		node.$graphics.$roughContours = [];
+		return false;
+	}
```

Upstream mutates persistent per-node graphics state, so a node that used to be
a non-root could keep a contour describing a subtree it no longer has.

**Our structure differs, and that may make this a non-issue.**
`crates/oristudio-bp/src/layout/contours.rs:302` reads:

```rust
if node.parent.is_some() {
    result.insert(id, contours.clone());
}
```

We compute into a `result` map and simply do not insert for the root, rather
than mutating state that survives the call. If `result` is built fresh on every
run, there is no stale contour for the root to retain and nothing to port.

That is the question to answer, and it has **not** been answered — this is a
structural reading, not a verified one. Do not port the line reflexively just
because upstream did; a defensive clear on a map that is already empty is noise
in the port, and `PORTING.md` asks for upstream's behavior to be understood
before ours changes.

## Affected Areas

- `crates/oristudio-bp/src/layout/contours.rs` — `build_rough_contours_inner`
- `third_party/box-pleating-studio/src/core/design/tasks/roughContour.ts` — read-only reference

## Checklist

- [ ] Determine whether `result` in `build_rough_contours_inner` is rebuilt per
      run or carried across runs
- [ ] If rebuilt: record that the upstream fix does not apply, and close this
- [ ] If carried: reproduce the stale contour with a node demoted to root, then
      port the clear
- [ ] Either way, note the outcome in `upstream-sync.json` so a future drift
      check does not re-raise it

## Note for the next drift check

The "zero `src/core/` changes" figure quoted in earlier notes for this release
was wrong. It came from GitHub's compare API, which truncates its file list at
300 entries and silently dropped `src/core/` from the response. Every count in
this document comes from a local clone. **Do not size a delta with the compare
API** — the same truncation produced a wrong per-module figure for Oriedita
before it was caught.
