# Diagram launch hardening

## Goal

Bring #436 up to date with main and finish the preset and font compatibility
safeguards before launch. Resolve routine outstanding product decisions using
their recommendations; leave visual or consequential choices for Zach.

## Approach

- Merge main's simulator OBJ export while preserving Diagram's session and export contracts.
- Save built-in preset values with their identity; preserve older files' appearance and newer fields.
- Freeze the v1 fonts, reject removal of released font files at deploy, and install the font toolchain with hashes.
- Audit the existing decision records, distinguishing a resolved choice from completed implementation.
- Validate the affected web and font-build surfaces and update #436.

## Affected Areas

- Simulator session and shared paper export integration.
- Diagram style model, reader, writer, and style selection.
- Diagram font build/check scripts and deployment action.
- Diagram plans and launch decision records.

## Checklist

- [x] Merge main and regenerate translation hashes (`821a849e2`).
- [x] Preserve built-in preset values in saved diagrams with compatibility tests.
- [x] Enforce font retention and hash-verified toolchain installation.
- [x] Resolve routine decisions and flag choices needing visual review (below).
- [x] Run relevant validation and review the final diff.
- [ ] Commit, push, and update #436 with evidence and remaining gates.

## Launch decisions, 2026-10-10

Zach requested items 1 (main integration) and 3 (preset/font compatibility),
with routine choices in item 4 resolved using recommendations. This is not
permission to mark unbuilt behavior or unperformed hardware checks complete.

| Decision | Resolution | Implementation |
| --- | --- | --- |
| Enlarged Show as Simulated | Accept 1a: get paper faces from the worker that already prepares the mesh. A technical implementation choice that preserves the selected paper area. | Still to build; review-fixes (b) remains an implementation gate. |
| Enlarged paste, R3-37 | Accept A, retaining the existing picture-space rule and visibility safeguards. | Already built. |
| Trimming whole-step lines pasted into enlarged steps | Accept the recommendation: use the same trimming rule as carried lines. | Still to build/test; Revision 2's open implementation item remains. |
| Enlarged-line overshoot | Keep 0.04 of the window. Explicitly accepted by Zach in this chat. | Already built. |
| Spread defaults | Keep current values: affine 3%, keep top, skew 1, axis 81°; depth 2.5% down, screen-relative through turns. Explicitly accepted by Zach in this chat. | Already built. |
| Shortcut keymap | Accept the current R3-25 A keymap for launch; keep every action id so user rebindings survive. A personal key pass is optional, not a launch blocker. | Already built; no key or id changes. |
| Extra touch/Pencil arrow-path editing | Defer the larger grips, touch node gestures and palm rejection package. It changes interaction only and can follow launch without a format change. | Deferred; does not certify current hardware behavior. |
| Step after an enlarged upload | Already settled by review-fixes: not seeded, starts whole. | Already built; old question is moot. |

**Still needs Zach's visual review** (confirmed in this chat):

- Linked flat-fold Turn Over currently leaves all marks and X-rays at their
  old picture positions. Carrying them with the paper requires a new rule
  for all marks; R3-21's original recommendation assumed a carry that does
  not exist. Leave that fork open.
- X-ray contrast: white revealed faces can look like page holes; review
  whether to tint the revealed front or choose a two-colour paper style.

Page-layout #443 and decisions 7/8 are outside this requested work. The final
crane/PDF, real-device, desktop and launch-release gates remain outstanding.

## Validation

- Main integrated at `9d755b86e`; OBJ snapshots retain their extra mesh fields,
  while Diagram's scene-only frames do not need them.
- All generated bridges and simulator outputs rebuilt through the normal npm
  hooks; typecheck, lint and i18n check pass.
- Full web suite: 915 files, 12,654 tests pass; 2 files / 13 tests skipped by
  the suite. This includes the simulator OBJ/shape integration and preset
  migration, future-name, preservation and explicit re-selection cases.
- Production `build:web` including prerender passes; the final deployed font
  directory passes the retention guard. Landing budget passes: 273.2 KB JS
  of 300 KB and 24.2 KB CSS of 40 KB (Brotli). Changed workflow YAML parses.
- Font retention unit tests: 7 pass. A clean Python 3.12 venv installs the
  pinned wheels with hash enforcement. All 16 rebuilt CJK files match v1
  exactly, including coverage. The committed Latin files are unchanged:
  rebuilding changes only their old `head` timestamp/checksum; all glyph,
  advance and other tables match. The lock keeps the original Latin bytes.
- No Rust/native shell code changed in this work. Native workspace/oracle and
  desktop hardware checks remain part of the broader launch gate, not claimed
  by these web and font checks.
