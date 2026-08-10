# Upstream drift watcher

## Goal

Know when an upstream we port has changed in a way that requires porting work,
and be able to trust that a re-vendor did not silently break parity.

Two mechanisms, deliberately separate because their requirements are opposite:

| | Parity oracle | Drift check |
| --- | --- | --- |
| Question | "Does the port still match the source we ported from?" | "Has upstream moved into code we depend on?" |
| Reference | **Pinned** vendored commit | **Current** upstream HEAD |
| Runs | Every CI build | Monthly, invoked by hand |
| On problem | Fails the build | Writes a plan and opens an issue |

Conflating them produces CI that breaks for reasons that are not our fault and
still does not say what changed. The oracle must never float to upstream HEAD.

Ordering matters: the drift check tells us *when* to re-vendor, the oracle tells
us whether the re-vendor *broke* anything. A drift check without a working
oracle generates work whose correctness nobody can verify. Phase 1 comes first.

### Why now

A commit-level audit of Oriedita's 2025 core work (37 commits, ~2,100 lines in
`origami/src/main/`) found the sync burden is small but the detection is absent:

- Only ~6 commits per year genuinely need porting; the rest are Java-idiom
  refactors, UI affordances, or tools we do not implement.
- The most consequential commit of the year, `0d86df23`, was **33 lines**. It
  halved `Epsilon.POINT` (`factor * 0.05` → `factor * 0.025`), shifting every
  geometric predicate in the kernel, and loosened the Euler characteristic
  check. Nothing about it fails to compile.
- In the same year `92a30434`, subject "fix invalid vertex detection", was a
  one-line `private` → `public` change — a complete no-op to port.

Size and subject line are both noise, in opposite directions. The only reliable
triage is reading diffs — recurring, judgement-heavy, low-volume work, which is
why it is a skill rather than a script.

Meanwhile **seven of the eight oracle suites never run in CI**. They skip
silently on a missing env var, so "unconfigured" and "passing" are
indistinguishable in the log.

## Approach

### Phase 1 — Make the oracles actually run

Nothing else here is trustworthy until this lands.

Only `TREEMAKER_CPP_ORACLE` is set in `.github/workflows/ci.yml`. These are
referenced by tests and never run:

| Env var | Test references |
| --- | --- |
| `ORIEDITA_OPERATIONS_ORACLE` | 63 |
| `ORIEDITA_GEOMETRY_ORACLE` | 35 |
| `ORIEDITA_RENDER_ORACLE` | 14 |
| `ORIEDITA_IO_ORACLE` | 6 |
| `FLATFOLDER_ORACLE` | 6 |
| `ORIEDITA_NATIVE_IO_ORACLE` | 4 |
| `ORIEDITA_MODEL_ORACLE` | 2 |

The build cost is lower than it looks: `tools/oriedita-oracle/build_geometry_oracle.sh`
invokes plain `javac` over a hand-picked source list — no maven, no dependency
resolution. It already reads from the pinned snapshot by default
(`source_root="${ORIEDITA_SOURCE:-$repo_root/third_party/oriedita}"`), which is
correct and needs no change.

1. Add `actions/setup-java` to the `native-oracle` job.
2. Build the Oriedita oracles and export each env var.
3. **Convert the silent skip to a hard failure when `CI` is set.** Keep the
   silent skip for local runs only. Without this, a future workflow edit drops
   an env var and the suite goes dormant again behind a green check — the exact
   failure this phase exists to correct.
4. Audit the Flat-Folder and BP Studio oracles the same way. BP Studio's runs
   headlessly under Bun rather than via a Rust env var, so it needs its own
   check.

### Phase 2 — `upstream-sync.json`

One machine-readable manifest at the repo root. Today each upstream is pinned in
a different place and format, and one is not pinned by commit at all:

| Upstream | Pin lives in | Form |
| --- | --- | --- |
| Oriedita | `third_party/oriedita/README.treemaker.md` | prose SHA |
| Flat-Folder | `third_party/flat-folder/README.treemaker.md` | prose SHA |
| Origami Simulator | `packages/origami-simulator/NOTICE` | prose SHA |
| Box Pleating Studio | `third_party/box-pleating-studio/package.json` | **version string, no SHA** |

The critical modelling decision is that **two commits are tracked, not one**:

- `vendored_commit` — what `third_party/<name>/` actually contains and what the
  oracle builds against. Moves only on a real re-vendor.
- `last_checked_commit` — how far a drift check has triaged. Moves every run.

Keeping them separate is what lets a run record "everything through X is
triaged, nothing to do" without implying anything was re-vendored.

```json
{
  "oriedita": {
    "repo": "https://github.com/oriedita/oriedita",
    "branch": "master",
    "vendored_commit": "9d39135ae232cc03be4ffaf74baa7ae2df970507",
    "last_checked_commit": "9d39135ae232cc03be4ffaf74baa7ae2df970507",
    "last_checked_date": "2026-08-10",
    "watch_paths": [
      "origami/src/main/",
      "oriedita-data/src/main/java/oriedita/editor/save/",
      "oriedita-data/src/main/java/oriedita/editor/export/"
    ],
    "port_map": {
      "origami/src/main/java/origami/Epsilon.java": "crates/oristudio-cp/src/geometry/epsilon.rs",
      "origami/src/main/java/origami/crease_pattern/": "crates/oristudio-cp/src/geometry/",
      "oriedita-data/src/main/java/oriedita/editor/save/": "crates/oristudio-cp/src/io/"
    }
  }
}
```

The skill's reference files already carry `watch_paths` and `port_map` in prose;
the manifest is the machine-readable copy and the only home for the mutable
pointers. Keep them consistent — if a watch path changes, change both.

TreeMaker 5.0.1 is excluded: the upstream is a 2015 release and cannot drift.

### Phase 3 — Bring every vendor current (one-time baseline)

Establishes a clean starting point so the first real drift check has a short,
honest delta. Measured 2026-08-10:

| Upstream | Behind by | Contents | Porting needed |
| --- | --- | --- | --- |
| Oriedita | 11 commits | Apollonius circle tools (~950 lines, **new feature**) + i18n/resources. `origami/` and `oriedita-data/` untouched. | None for parity — see note |
| Box Pleating Studio | 16 commits (v0.7.14 → v0.7.15) | Zero `src/core/` changes. Vue components, icons, deps, one fatal-error fix. | None |
| Flat-Folder | 4 commits | copyright, unused dependency, notes `start_check` interface, kawasaki logging | None expected; read the kawasaki diff before concluding |
| Origami Simulator | 0 commits | already current | None |

**The Oriedita delta contains one real decision, not just a pointer bump.**
`MouseHandlerCircleDrawApollonius.java` (546 lines) and
`...ApolloniusRadius.java` (401 lines) are a genuine new drawing tool. Under the
skill's triage rules that is `SKIP-UNPORTED` — we do not implement it — but that
is a product choice about whether to add an Apollonius tool, not a parity gap.
Decide it explicitly; do not let a date bump swallow it.

Re-vendoring is a large, low-information diff. Do each upstream as its own
commit so the oracle result is attributable, and run the Phase 1 oracles after
each one rather than after all four.

### Phase 4 — The `upstream-drift` skill

**Landed** at `.agents/skills/upstream-drift/`, matching the repo's existing
skill convention (`.agents/skills/create-feature/`).

```
.agents/skills/upstream-drift/
  SKILL.md                              workflow, buckets, triage rules, outputs
  references/oriedita.md
  references/box-pleating-studio.md
  references/flat-folder.md
  references/origami-simulator.md
```

`SKILL.md` holds what is common — the six-step workflow, the four buckets, the
triage rules, and the output contract. Each reference file holds one upstream's
repo URL, branch, watch paths, port map, expected volume, and **the highest-risk
change class for that project**, which differs substantially:

| Upstream | Highest risk |
| --- | --- |
| Oriedita | Tolerance constants in `Epsilon.java` |
| Box Pleating Studio | A new `Migration.$add` — the `.bps` format has broken seven times |
| Flat-Folder | Kawasaki/Maekawa conditions, and logging-shaped commits that hide them |
| Origami Simulator | Solver numerics; and an empty result means less here than elsewhere |

A skill rather than four pasted prompts because the shared triage rules then
live in one place. The earlier draft duplicated them across four standalone
prompts specifically so a human would not have to assemble two blocks correctly
by hand; a skill assembles them itself, so that tradeoff disappears.

Invocation is a one-liner — name the skill and the upstream. Scheduling is set
up separately by the maintainer; monthly matches the observed rate.

#### Outputs

Both paths end in a **draft** PR, per the repo's agent-PR convention.

- **Nothing to port** — draft PR with only the `upstream-sync.json` pointer
  bump, body carrying the triage table.
- **Something to port** — draft PR with the plan file and the pointer bump,
  **plus a GitHub issue** labeled `upstream-sync`. The issue is the durable
  tracker: porting often will not happen the week the drift is found, and a
  draft PR is easy to lose among agent PRs. One issue per run with a checkbox
  per PORT commit, not one issue per commit — at ~6 portable commits a year
  across all upstreams, per-commit issues would be noise.

`last_checked_commit` advances in **both** cases. The plan file and issue carry
outstanding work; if the pointer did not advance, every future run would
re-report the same commits and the check would become noise within two cycles.

### Phase 5 — Wire it up

Reference the skill from `AGENTS.md` the way `create-feature` is referenced, and
document the oracle/drift-check split in `PORTING.md` so the next person does
not wire the oracle to upstream HEAD.

## Affected Areas

- `.agents/skills/upstream-drift/` — **added**: skill and four reference files
- `.github/workflows/ci.yml` — JDK setup, oracle builds, oracle env vars
- `upstream-sync.json` — new manifest, consolidating four inconsistent pins
- `crates/oristudio-cp/tests/oriedita_*_oracle.rs` — skip becomes hard failure under CI
- `crates/treemaker-flatfold/` tests — same skip audit
- `tools/oriedita-oracle/`, `tools/flat-folder-oracle/`, `tools/bp-studio-oracle/` — confirm each builds in CI
- `third_party/oriedita/`, `third_party/box-pleating-studio/`, `third_party/flat-folder/` — re-vendor to current
- `third_party/*/README.treemaker.md`, `packages/origami-simulator/NOTICE` — defer to the manifest
- `PORTING.md` — document the oracle/drift-check split
- `AGENTS.md` — reference the skill and the manifest

## Checklist

### Phase 1 — oracles in CI
- [x] Add `actions/setup-java` to the `native-oracle` job
- [x] Build the Oriedita oracle in CI, cached on the vendored source
- [x] Export `ORIEDITA_GEOMETRY_ORACLE`, `ORIEDITA_OPERATIONS_ORACLE`, `ORIEDITA_RENDER_ORACLE`, `ORIEDITA_IO_ORACLE`, `ORIEDITA_MODEL_ORACLE`
- [x] Export `FLATFOLDER_ORACLE` (a Node script; no build step needed)
- [x] Convert silent skips to hard failures via `ORACLE_REQUIRED` + `oracle_env_guard`
- [x] Confirm the suites actually execute — 109 tests now run where 0 did
- [ ] `ORIEDITA_NATIVE_IO_ORACLE` — deferred; `build_native_io_oracle.sh` needs
      maven to resolve Oriedita's Java `fold` dependency, unlike the geometry
      oracle's dependency-free `javac`. Worth 4 tests; wire it separately.
- [ ] Audit how the BP Studio (Bun) oracle is invoked and wire it equivalently
- [ ] `flat_folder_corpus` — deliberately excluded; it runs over ten minutes
      locally where `flat_folder_oracle` takes under a second
- [ ] Record the CI wall-clock cost added once the job has run

### Phase 2 — manifest
- [ ] Add `upstream-sync.json` with all four live upstreams
- [ ] Fill `watch_paths` and `port_map` per upstream, matching the skill's reference files
- [ ] Give Box Pleating Studio a real commit SHA pin for the first time
- [ ] Point the four existing pin locations at the manifest
- [ ] Add a test asserting `vendored_commit` matches what is actually vendored

### Phase 3 — baseline re-vendor
- [ ] Decide whether to implement Oriedita's Apollonius circle tools, or record the decision not to
- [ ] Re-vendor Oriedita to current master; run the Phase 1 oracles
- [ ] Re-vendor Box Pleating Studio to v0.7.15; run its oracle
- [ ] Read the Flat-Folder `kawasaki logging` diff before assuming it is benign
- [ ] Re-vendor Flat-Folder to current main; run its oracle
- [ ] Confirm Origami Simulator needs no change (0 commits behind as of 2026-08-10)
- [ ] Set every `vendored_commit`, `last_checked_commit` and `last_checked_date` to today
- [ ] One commit per upstream so an oracle failure is attributable

### Phase 4 — the skill
- [x] Create `.agents/skills/upstream-drift/SKILL.md`
- [x] Write per-upstream reference files for all four upstreams
- [x] Encode the issue-plus-PR output contract
- [ ] Dry-run against a stale `last_checked_commit` covering `0d86df23`; confirm it classifies the epsilon change as `PORT`
- [ ] Dry-run covering `92a30434`; confirm `SKIP-REFACTOR` *and* that it names the sibling commit
- [ ] Confirm the nothing-to-port path produces a clean date-bump PR and no issue
- [ ] Confirm the something-to-port path opens exactly one issue with per-commit checkboxes
- [ ] Confirm no run touches `third_party/`

### Phase 5 — wire it up
- [ ] Reference the skill from `AGENTS.md` alongside `create-feature`
- [ ] Create the `upstream-sync` issue label
- [ ] Document the oracle/drift-check split in `PORTING.md`

## Open questions

- **Backlog runs.** After a quiet period a check could face a large delta. The
  25-commit stop in `SKILL.md` is the guard; confirm it triggers before it is
  needed rather than after.
- **Skill discovery.** `.agents/skills/` matches repo convention but is not a
  location Claude Code auto-registers as a slash command — `create-feature` is
  reached by `AGENTS.md` pointing at its path. If invoking `/upstream-drift`
  directly is wanted, it needs a `.claude/skills/` entry too.
