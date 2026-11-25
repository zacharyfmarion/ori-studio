# Counted tool and command events

## Goal

Ori Studio is on PostHog's free plan: 1,000,000 product-analytics events a
month, with the current period running 2026-11-03 to 2026-12-03 (it resets at
14:23 UTC). By 2026-11-25 it had used 836,611 events, and PostHog projected
1,107,128. Once the cap is reached, PostHog drops every incoming event until the
reset, and dropped events cannot be recovered. Weekly volume doubled between
early October and late November (126k → 262k a week).

Two events, sent once per use, make up three quarters of it:

| Event | 2026-11-03 → 25 | Share | Sent from |
| --- | --- | --- | --- |
| `cp tool used` | 480,673 | 59% | `executeOristudioCpCommand` in `store/workspaceStore/slices/projectSlice.ts`, once per crease-pattern edit |
| `command invoked` | 129,316 | 16% | `trackCommandInvoked` in `commands/menuActions.ts`, once per menu, shortcut or palette action; `edit.undo` alone is 94,327 |

A single heavy desktop user sent 178k events (22% of the total). One event per
edit means the busiest users use up most of the allowance.

Keep what these events are used for, and stop sending one event per edit:

- **Who used which tool or command.** Unique users, funnels, and the
  favourites ranking in `cp-workspace/toolCatalog/cpToolFavorites.ts` must read
  exactly as they do now.
- **How often, in aggregate.** These events matter less than the others, but a
  rough idea of how much each tool is used is still worth having.

## Approach

### Two events per tool per counting window

Uses are counted in memory over a **counting window**. Each window can produce
two events per tool or command:

- **First use, sent at once.** `cp tool used` / `command invoked`, keeping their
  current properties and adding `counting: 'first_in_window'`. Funnels and
  unique-user charts stay exact, because this event never waits on a flush.
- **The count, sent when the window closes.** `cp tool uses counted` /
  `command uses counted`, carrying the same `operation` + `group` (or
  `command_id` + `command_group`) plus `use_count_bucket`, from the shared
  `COUNT_BUCKETS` ladder through `bucketCount`. Per `docs/analytics.md`, the
  exact count is never sent. Sent even when the count is 1, so totals can be
  read off the count events alone.

There is one window for all tools and commands together, which keeps it to one
timer and one set. It opens at the first counted use and closes when the first
of these happens:

- **30 minutes have passed.** A single `setTimeout`, armed only while a window is
  open, so an idle app never wakes up.
- **The page is hidden** (`visibilitychange` → `hidden`) **or unloaded**
  (`pagehide`). The window is flushed with `transport: 'sendBeacon'`, which
  posthog-js 1.411's `CaptureOptions` supports.
- **Analytics is turned off.** The pending counts are discarded, never sent
  (`setAnalyticsEnabled(false)`).

When a window closes, the first-use set is cleared, so the next use of any tool
sends a first-use event again.

Why two events rather than one backdated event per window: the count is the
part that can be lost, for example when the desktop app quits without the
webview being hidden first. If the first use waited for the flush too, a
desktop session shorter than a window would vanish from the unique-user charts.
Losing only the last count costs very little; losing the first use would bias
every desktop chart.

### Expected volume

Measured over 2026-11-03 → 25, with clock-aligned 30-minute buckets as a stand-in
for the window:

- First-use events: 21,473 (`cp tool used`) + 13,041 (`command invoked`) =
  34,514, the same number as count events. That is about **69k instead of
  610k (−89%)**.
- Closing windows when the page is hidden splits some windows in two, so the
  real number will be somewhat higher.
- At current traffic a month comes to about **400k events**, 40% of the
  allowance.
- Ten-minute windows would give 51k first uses, and hour-long windows 28k.
  30 minutes is a constant (`USE_COUNT_WINDOW_MS`) and can be tuned.

### Reading totals from buckets

The count events estimate total uses: add up a midpoint for each
`use_count_bucket` (`<=1` → 1, `<=5` → 3.5, `<=10` → 8, `<=20` → 15.5, `<=50` →
35.5, `<=100` → 75.5, `<=200` → 150.5, `<=500` → 350.5, `>500` → 650). On this
period's data that reads 10.7% high for tools and 11.2% high for commands. The
error is in the same direction every time, so trends and the ranking between
tools hold. In 30 minutes, uses per tool run from a median of 5 to a p99 of 229
(commands: 2 and 150), which the ladder covers.

### Old builds and this month

Desktop builds that are already installed keep sending one event per edit
until people update, and the four biggest senders are all on desktop. A PostHog
**Drop events** transformation closes the gap. Events it drops are not billed,
and the free plan includes transformations.

- The rule: drop `cp tool used` and `command invoked` where `counting` is not
  set.
- Switching it on before the code ships is the stopgap for this period. It
  removes about 28k of the roughly 40k events a day, which keeps the period
  under the cap.
- The cost: these two events are missing until the new web build deploys, and
  missing from old desktop builds until they update. The
  owner has said this data is not critical.
- Changing the PostHog project needs the owner's go-ahead. It is a step of its
  own below, done through the PostHog MCP once approved.

### Charts

8 of the 11 saved insights on these events count unique users or are funnels,
and they read the same after the change. Four have a **total** series, which
from the switch on would count windows rather than uses:

- `xlkmgLO5` "Crease-pattern editor — where the work goes"
- `eVzV0A0F` "Tool use over time", its "Operations run" series
- `Lm8HNufN` "Commands invoked by group"
- `fv9pgSvh` "Fold menu, shortcut and palette commands — by command"

Move their total series onto the estimate above (a SQL tile, or a series over
the `* uses counted` events), and add an annotation on the deploy date so the
step in the history is explained.

## Affected Areas

- `apps/web/src/analytics/countedUses.ts` (new): the window counter. It is a
  pure module with `capture`, `now` and timers injected, so it can be tested
  without PostHog or the DOM.
- `apps/web/src/analytics/runtime.tsx`: `createAnalyticsApi` gains
  `trackCountedUse`, plus a module-level `trackCountedUse` for callers outside
  React. `AnalyticsRuntimeProvider` adds the `visibilitychange` / `pagehide`
  listeners. `setAnalyticsEnabled(false)` discards the open window.
- `apps/web/src/analytics/bootstrap.ts`: `PostHogClientLike.capture` already
  takes `options`. No change expected.
- `apps/web/src/analytics/events.ts`, `index.ts`: the two new event names in
  `ANALYTICS_EVENTS`, with notes on `cpToolUsed` and `commandInvoked` saying
  they now fire once per window.
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts`
  (`executeOristudioCpCommand`) and `apps/web/src/commands/menuActions.ts`
  (`trackCommandInvoked`): call `trackCountedUse` instead of `track`.
- Tests: `analytics/__tests__/countedUses.test.ts` (new),
  `analytics/__tests__/runtime.test.ts`, `commands/menuActions.test.ts` and
  `menuActions.foldIo.test.ts`, which assert on `command invoked`.
- `docs/analytics.md`: the two rows in the event table become four, and the
  chokepoint paragraph says what "once per window" means.
- PostHog project 543871: the Drop events transformation, the four charts above,
  and an annotation. These are not repo changes.

## Checklist

- [x] With the owner's go-ahead: create the Drop events transformation (`cp tool
      used` / `command invoked` without `counting`). Live since 2026-11-25
      13:47 UTC as "Drop per-use tool and command events"
      (`01a212f5-c98f-0000-654f-60a0c481db2b`). Its compiled filter is
      `properties.counting = null AND event IN (the two)`.
- [ ] The next day, confirm the drop in `billing-usage-get` and in the
      transformation's metrics.
- [x] `countedUses.ts`: one window, a first use sent at once with
      `counting: 'first_in_window'`, the counts flushed after 30 minutes or on
      hide with `use_count_bucket`, discarded on opt-out.
- [x] Unit tests with fake timers:
  - [x] only the first use in a window is sent;
  - [x] the next window sends a first use again;
  - [x] the count is sent at 30 minutes, with the right bucket for 1, 5, 6,
        500 and 501 uses;
  - [x] hiding the page flushes with `sendBeacon`;
  - [x] opting out sends nothing and clears the window;
  - [x] no timer is left running once the window closes.
- [x] Wire `trackCountedUse` into `runtime.tsx` and the provider's listeners,
      and cover them in `runtime.test.ts`.
- [x] Switch `executeOristudioCpCommand` and `trackCommandInvoked`, including
      the path for actions held behind a modal, and update the menu-action
      tests.
- [x] `events.ts` / `index.ts` names and notes; `docs/analytics.md` rows.
- [x] Verify in the browser with a dummy PostHog key and the
      `eventCaptured` listener (no traffic left the machine):
  - [x] four lines drawn, then one `cp tool used` and nothing more;
  - [x] Undo three times, then one `command invoked`;
  - [x] `pagehide`, then one count each, `<=5`, dated to when the window
        opened;
  - [x] the next line opens a new window: a first use again, then on
        `visibilitychange` → hidden a `<=1` count. The pane's tabs never
        report hidden, so both page events were dispatched by hand, through
        the app's own listeners.
- [ ] Desktop: check whether quitting the app (macOS ⌘Q, Windows close button)
      hides the webview first. If it does not, note that the last window's
      count is lost on quit (first uses are not). Add a flush on Tauri's
      close-requested only if that loss turns out to be large.
- [x] ESLint on the touched files, `tsc --noEmit` (what `typecheck:web`
      runs), and the tests in `src/analytics` and both menu-action files
      (Node 22): 256 passed. CI runs the whole suite.
- [ ] After deploy: the annotation; the four total series moved to the bucket
      estimate; the dashboard header notes updated; daily event volume
      checked against the ~400k/month estimate a week later.
