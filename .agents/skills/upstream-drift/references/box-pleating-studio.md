# Box Pleating Studio

The box-pleating design kernel. The only one of the four upstreams whose file
format has a track record of actually breaking compatibility.

| | |
| --- | --- |
| Repo | `https://github.com/bp-studio/box-pleating-studio` |
| Branch | `main` |
| Our code | `crates/oristudio-bp` |
| Vendored at | `third_party/box-pleating-studio/` |
| Manifest key | `box-pleating-studio` |
| Oracle | `tools/bp-studio-oracle` (runs headlessly under Bun, not a Rust env var) |

## Watch paths

```
src/core/
src/shared/json/
src/client/patches/migrations/
```

`src/app/` is out of scope entirely — Vue components, icons, and page chrome.
We have our own frontend.

## Port map

| Upstream | Ours |
| --- | --- |
| `src/core/` | `crates/oristudio-bp/src/` |
| `src/shared/json/` | `crates/oristudio-bp/src/io/` |
| `src/client/patches/migrations/` | `crates/oristudio-bp/src/io/migrations.rs` |

## Highest risk for this upstream: a new format migration

The `.bps` format has shipped **seven versions**: `beta`, `rc0`, `rc1`, `0`,
`0.4`, `0.6`, `0.7`. Upstream registers each via `Migration.$add(...)` in
`src/client/patches/migration.ts` and migrates old files forward, so their users
never notice.

Ours do. `crates/oristudio-bp/src/io/migrations.rs` ports the chain and rejects
anything it does not recognise with
`BpError::IncompatibleProject("Unrecognized version")`. That is the correct
failure mode — it refuses rather than mis-parsing — but it means **a new
upstream migration makes newly-saved `.bps` files unopenable in Ori Studio until
we port it.**

So: **any new `Migration.$add` call, or any change to the `JProject` shape in
`src/shared/json/project.ts`, is `PORT` at the highest priority.** Check
`Migration.$getCurrentVersion()` — if the last registered version is no longer
`0.7`, the format moved.

Version `0.7` has held since 2024-12-31, so this is rare. It is listed first
because it is the one change class here with a direct, user-visible breakage.

## Calibration

A release with **zero** `src/core/` changes is the normal case, not a sign you
searched wrong. Concretely, v0.7.14 → v0.7.15 was 16 commits and 278 changed
files, of which the source changes were entirely Vue components, icons,
`index.htm`, and dependency bumps, plus one fatal-error fix. Nothing to port.

Do not go hunting for work to justify the run.

## Expected volume

Core activity has decelerated hard: 214 commits touching `src/core/` in 2023,
44 in 2024, 12 in 2025, 6 in 2026 through August. Format-adjacent commits: 55 in
2023, 13 in 2024, 7 in 2025, 2 in 2026. Releases come roughly every six weeks
but are mostly app-layer.

## Note on the pin

Historically this upstream was pinned only by the `version` string in
`third_party/box-pleating-studio/package.json`, with no commit SHA — unlike the
other three, which record a SHA. `upstream-sync.json` is the first place it has
a real commit pin. If `vendored_commit` looks absent or wrong, that is the
reason; resolve it against the release tag matching the vendored `package.json`
version rather than assuming.
