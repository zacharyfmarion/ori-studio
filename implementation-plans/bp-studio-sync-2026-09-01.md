# Box Pleating Studio sync — 2026-09-01

## Goal

Check whether `bp-studio/box-pleating-studio` has moved into code we depend on
(`crates/oristudio-bp`) since the last drift check, and port anything
observable-behavior-changing that it finds.

## Approach

Cloned `https://github.com/bp-studio/box-pleating-studio` at `main` and
compared it against `last_checked_commit` from `upstream-sync.json`.

## Affected Areas

None. Upstream `main` is at `507981157194b13634761c3a2e39565754b6cbbb`
(`v1900: v0.7.15`) — the exact same commit recorded as both
`last_checked_commit` and `vendored_commit` from the 2026-08-10 check. Zero
commits landed on `main` in the three weeks since, so there is no range to
triage and nothing to compare against the watch paths
(`src/core/`, `src/shared/json/`, `src/client/patches/migrations/`).

This is a stronger negative result than "no commits in the watch paths" (the
normal case per the reference file's calibration note) — there were no new
upstream commits at all.

## Checklist

- [x] Cloned upstream at `main`, confirmed `origin/main` HEAD ==
      `last_checked_commit` (`50798115`)
- [x] No commit range to triage; no PORT/SKIP classification needed
- [x] Confirmed no format migration risk: `Migration.$getCurrentVersion()`
      is unchanged from `0.7` (no new commits, so no possibility of a bump)
- [x] Advanced `last_checked_date` to 2026-09-01 in `upstream-sync.json`
      (`last_checked_commit` unchanged — upstream did not move)
- [x] Left `vendored_commit` and `third_party/` untouched
- [x] Left the pre-existing `open_port_candidates` note (roughContour
      stale-contour clear, from the 2026-08-10 check) as-is — it predates this
      run's window and is unrelated to this cycle's (empty) triage
