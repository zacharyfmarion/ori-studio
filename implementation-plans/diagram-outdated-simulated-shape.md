# Outdated Simulated Shapes In Pose

## Goal

A Diagram step shown as Simulated keeps the paper's solved positions
(`render.shape`, keyed `sk1:` by the simulator's mesh). When a later build
meshes the same sheet differently, the worker refuses the shape (`mismatch`).
#621 did this to every shape saved before it (crease-free border points
merged, aux lines no longer cut the mesh).

Today Pose then folds the step from flat with no message, and leaving Pose
saves that refold over the step, so one look replaces the user's picture.
Zach chose option A of the write-up
(https://claude.ai/artifact/6zX17a41fxBPtKxtrgN7Ar): say so, and keep the
picture until the user folds again.

## Approach

- The worker's answer decides. A load's `restored`, or a followed render's
  `restoreShape`, of `mismatch` while the step's pattern is unchanged (its
  link is not `stale`) and its fold % is above 0 puts Pose in a new status,
  `outdated`.
- `outdated` shows the step's stored picture, as the other statuses that
  cannot fold do. A line says why, and a Fold Again button starts the
  simulation from flat at the step's fold % and camera. The solver is paused
  (`useSimulatorRuntime`'s `paused`), the transport and keys are off, and
  leaving Pose or Refresh saves nothing.
- Fold Again: `restoreShape(foldPercent, null)` folds from flat, and from
  there Pose is the ordinary live view: leaving saves what it shows.
- Unchanged:
  - a step saved without positions (#609's rule: it refolds and leaving saves);
  - a step whose pattern changed (`stale`: the refold is Refresh's job);
  - a shape this build cannot read (another build's fields or encoding);
  - 0%, where a fold from flat is the flat sheet the step already shows.
- The pattern status comes from `linkStatus`'s own rule, given the scope and
  known creases Pose has (`stepLinkStatus`), so there is one predicate.
- Analytics: `diagram outdated shape shown` from the view, through a hook
  that fires once each time the line appears. `diagram simulation folded
  again` from Fold Again. Both have no properties.

## Affected Areas

- `apps/web/src/diagram/capture/linkStatus.ts`: `stepLinkStatus`.
- `apps/web/src/diagram/capture/useDiagramSimulatedPose.ts`: the `outdated`
  status, the paused solver, the save guard, `foldAgain`, follow path.
- `apps/web/src/components/diagram/DiagramPoseSimulatedView.tsx` and its CSS
  module: the line and the button.
- `apps/web/src/analytics/`: events, the shown hook, the track function, tests.
- `docs/analytics.md`: the two events.
- `apps/web/public/locales/*/panels.json`: two strings in 9 catalogs.

## Checklist

- [x] Plan
- [x] `stepLinkStatus`, with `linkStatus` built on it
- [x] Hook: `outdated` status, paused solver, no save, `foldAgain`, follow path
- [x] View: stored picture, the line and Fold Again
- [x] Strings extracted and translated; `i18n:check`
- [x] Analytics events, hook and docs
- [x] Tests: hook (outdated, stale, Fold Again, follow), event hook, linkStatus
- [x] eslint, typecheck, relevant vitest
- [x] Browser check on a copy of fish.osf: before/after
- [x] Draft PR
