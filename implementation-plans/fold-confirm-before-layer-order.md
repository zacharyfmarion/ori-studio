# Confirm the fold before resolving layer order

## Goal

Let the folder finish locating a fold and choosing its moving flaps before
reviewing ambiguous layer orders. Verify Heart tutorial step 13 can select a
single lower flap for its mountain fold behind.

## Approach

- Keep order search and geometry previews running while the tool is edited,
  but open the order chooser only after the tool's confirmation action.
- An exactly unique result commits normally. Ambiguous or incomplete searches
  require explicit review. A confirmation during search waits and then follows
  the same rule; editing the input cancels that pending confirmation.
- Back/Escape returns to the tool with its line and layer selection intact.
  Changing inputs does not reopen the chooser. Keyboard cycling cannot bypass
  this distinction between choosing paper and choosing its final layer order.
- Copy the external Heart file into ignored artifacts before investigating.
  Preserve the original and all existing engine connectivity checks.

## Affected Areas

Fold order-resolution hook, shared canvas actions/confirmation queue, tool
window, and focused UI and real-engine flow tests.

## Checklist

- [x] Copy the current Heart file and inspect the interruption path.
- [x] Gate order review on tool confirmation, including asynchronous searches.
- [x] Verify selecting the intended flap and diagnose any independent issue.
- [x] Cover confirmation, Back, input changes, unique results and ambiguous results.
- [x] Validate web code and mounted UI flows; check the running local browser.

## Findings and validation

- The resolver previously treated every ambiguous query as an instruction to
  open review. Review is now explicit and scoped to the current input. Changes
  cancel review, including changing away and back to an earlier input.
- Pending confirmation waits for order search. Ambiguity opens review; an exact
  unique result commits. Search-budget exhaustion remains reviewable rather
  than becoming a geometric refusal that disables the confirmation button.
- The copied Heart replays all 24 stored nodes. The screenshot-like free line
  offers the desired mountain placement without an engine change: after Swap,
  the lower-right front corner is display Flap 2. Its second placement moves
  only that flap; the first outer placement adds other flaps. This investigation
  missed that the expanded result violates the explicit selection. The follow-up
  `fold-placement-selected-flaps.md` rejects such candidates; only the selected
  flap's placement is now offered.
- The local Heart flow uses the actual canvas hit test and layer-toggle actions,
  confirms, backs out, reconfirms, chooses the single-flap placement and commits.
  It checks every other material face stays still and verifies identical fresh
  replay. Source, snapshot and reproduction evidence remain ignored under
  `artifacts/heart-fold-confirmation/`; the original was never written.
- 147 Fold/UI test files (1,101 tests), the separate copied-Heart flow,
  TypeScript and web lint pass. Lint has the existing StepFilmstrip compiler
  warning. `git diff --check` passes. No engine or file-format changes, so native
  tests, WASM rebuilding and production bundling were unnecessary.
- The server remains on 5328. Browser inspection reached the tool options, but
  the narrow embedded pane hides the canvas and its Open action did not expose
  a usable file picker. The complete interaction was verified with mounted UI
  and real-WASM canvas tests, not claimed as a manual browser Heart audit.
- Existing model files need no migration. No commit, push, or PR.
