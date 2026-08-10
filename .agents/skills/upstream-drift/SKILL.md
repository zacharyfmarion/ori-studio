---
name: upstream-drift
description: Use when checking whether an upstream project Ori Studio ports has changed in a way that requires porting work, especially prompts like "run the upstream drift check", "has Oriedita moved", "check BP Studio for changes we need to port", or a monthly sync review. Triages new upstream commits into port-or-skip buckets, writes an implementation plan and opens an issue when porting is needed, and advances the sync pointer either way. This skill never ports code and never edits vendored source.
---

# Upstream Drift Check

Ori Studio ports four actively-maintained upstreams. This skill answers one
question for one of them: **has upstream moved into code we depend on, and does
any of it require porting work?**

You do **not** port code here. You produce a plan and an issue, or you record
that there is nothing to do. Either way you advance the sync pointer.

## Scope

Run this for exactly one upstream per invocation. The user names it; if they do
not, ask which.

| Upstream | Reference file | Our code |
| --- | --- | --- |
| Oriedita | `references/oriedita.md` | `crates/oristudio-cp` |
| Box Pleating Studio | `references/box-pleating-studio.md` | `crates/oristudio-bp` |
| Flat-Folder | `references/flat-folder.md` | `crates/treemaker-flatfold` |
| Origami Simulator | `references/origami-simulator.md` | `packages/origami-simulator` |

**Read the reference file for the chosen upstream before doing anything else.**
It carries the repo URL, branch, watch paths, port map, and — most importantly —
the highest-risk change class for that specific project, which differs
substantially between them.

TreeMaker 5.0.1 is out of scope: the upstream is a 2015 release and cannot
drift.

## Workflow

1. **Read state.** `upstream-sync.json` at the repo root, entry for this
   upstream. You need `last_checked_commit`. Note `vendored_commit` separately —
   it is what `third_party/` actually contains, and you never change it.
2. **Fetch upstream.** Clone the repo at its branch into a temp directory.
3. **List candidates.** Commits in `last_checked_commit..<branch>` restricted to
   the reference file's watch paths. If none, skip to step 6.
4. **Read every diff.** Not the subject line. Not the diff size. The diff. See
   the triage rules below for why this is not optional.
5. **Classify and plan.** Put each commit in exactly one bucket (below). If any
   commit is PORT, write
   `implementation-plans/<upstream>-sync-<YYYY-MM-DD>.md` in the repo's plan
   format (`Goal` / `Approach` / `Affected Areas` / `Checklist`). For each PORT
   commit record: SHA, subject, what actually changed, which of our files is
   affected (use the reference file's port map), and the risk of skipping it.
   Order by risk, highest first.
6. **Advance the pointer.** Update `last_checked_commit` and
   `last_checked_date` in `upstream-sync.json` — **whether or not you found
   work.** The plan file and issue carry outstanding work. If the pointer does
   not advance, every future run re-reports the same commits and this check
   becomes noise within two cycles.
7. **Report.** See Outputs.

## Buckets

Every commit goes in exactly one:

| Bucket | Meaning |
| --- | --- |
| `PORT` | Changes observable behavior in a subsystem we have ported |
| `SKIP-REFACTOR` | No semantic change |
| `SKIP-UNPORTED` | A tool or feature Ori Studio does not implement |
| `SKIP-UI` | Presentation only; we have our own frontend |

## Triage rules

These come from a commit-level audit of Oriedita's 2025 core work — 37 commits,
~2,100 lines. Follow them exactly.

**Size is not signal, in both directions.** The most consequential Oriedita
commit of 2025 (`0d86df23`) was **33 lines**: it halved `Epsilon.POINT` from
`factor * 0.05` to `factor * 0.025`, shifting every geometric predicate in the
kernel, and loosened the Euler characteristic check. In the same year
`92a30434`, whose subject reads *"fix invalid vertex detection"*, was a one-line
`private` → `public` change and a complete no-op to port. You cannot triage this
from a log. Read diffs.

**Any change to a tolerance, epsilon, or precision constant is `PORT`. Always.
Highest priority. Even one character.** These never fail to compile and they
silently change every borderline result in the kernel. This is the single
change class most likely to cause a divergence nobody notices for months.

**Changes to core algorithms or file serialization are `PORT`** — geometry
predicates, folding and layer-order solvers, format readers and writers.

**Language-idiom changes with no semantic effect are `SKIP-REFACTOR`:**
immutability refactors, enum extraction, visibility modifiers,
`equals()`/`hashCode()` overrides, dead-code removal, renames. Rust's type
system gives most of these for free.

**Verify before calling something unported.** A commit touching only a tool we
do not implement is `SKIP-UNPORTED` — but grep our source for the tool first
rather than assuming.

**Watch for the change that lives elsewhere.** If a commit's real effect is
outside the watch paths — a visibility change that enables a caller in another
module, for instance — say so explicitly and name the sibling commit. Do not
call it a no-op just because the visible diff is empty.

**A new feature is a product decision, not a parity gap.** When upstream adds a
tool we do not have, that is `SKIP-UNPORTED` for parity purposes, but surface it
in the report as a decision for the maintainer rather than letting a pointer
bump swallow it.

## Outputs

**When nothing needs porting:** open a draft PR containing only the
`upstream-sync.json` pointer bump. Title:

```
upstream: <name> drift check <YYYY-MM-DD> - nothing to port
```

Body is the triage table: one row per commit — SHA, bucket, one line of
reasoning. If there were no commits at all in the watch paths, say that plainly.

**When something needs porting:** open both.

1. A **draft PR** with the new plan file and the pointer bump. Title:
   ```
   upstream: <name> drift check <YYYY-MM-DD> - <N> to port
   ```
2. A **GitHub issue** — the durable tracker, because porting work often does not
   happen the same week the drift is found and a draft PR is easy to lose among
   agent PRs. Title:
   ```
   upstream sync: <name> - <N> commits to port (<YYYY-MM-DD>)
   ```
   Label `upstream-sync`. Body links the plan file and the PR, and carries a
   checkbox per PORT commit so they can be closed off independently. One issue
   per run, not per commit — at roughly six portable commits a year across all
   upstreams, per-commit issues would be noise.

## Discipline

- **Cite everything.** Every claim names a commit SHA and a file path. No claim
  without a citation.
- **Empty is a valid result.** If nothing needs porting, say so plainly. Do not
  invent work to justify the run.
- **Stop if the backlog is large.** More than 25 commits to triage: stop, open
  an issue summarizing the backlog, and ask for a human. Do not produce a plan
  you cannot support.
- **Never modify `third_party/`.** Never change `vendored_commit`. Never port
  code. Re-vendoring is a separate, deliberate act that requires the parity
  oracles to run — see `implementation-plans/upstream-drift-watcher.md`.
