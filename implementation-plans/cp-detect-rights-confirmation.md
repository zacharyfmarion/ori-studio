# CP Detect Rights Confirmation

## Goal

Detect CP from Image takes any picture of a crease pattern and turns it into an
editable document. A crease pattern is a designer's work, and the dialog never
asks whether the person feeding it one is entitled to. Add a confirmation step
**after an image is chosen and before the crop step**: the user sees the image
they picked and affirms that it was obtained legally before the dialog goes any
further. Declining drops the image and returns to the file picker.

The step is an attestation about *this* image, so it is asked for every image
loaded into the dialog — a second image picked from the crop or review step is
asked about again — and nothing is remembered across sessions. See "Decisions"
for why.

## Where it fits

The dialog is one component, `CpDetectImportModal`, whose stage is derived
rather than stored (`modalStage`, `CpDetectImportModal.tsx:106`):

```text
upload ──image chosen──▶ crop ──Detect──▶ detecting ──▶ review ──Add──▶ closed
```

An image enters through exactly one function, `loadImageFile` (picker or
drop), which sets `source` and immediately starts the auto-rectification. The
menu action `file.detectCpImage` is the only way to open the dialog, and there
is no other image intake anywhere (no open-with, no landing-page drop), so the
gate has a single seam.

The new stage sits between the first two:

```text
upload ──image chosen──▶ confirm ──Continue──▶ crop ──Detect──▶ …
                            │
                            └──Back──▶ upload (image discarded)
```

## Approach

1. **One boolean, reset per image.** `const [rightsConfirmed, setRightsConfirmed]
   = useState(false)` in the modal. `loadImageFile` sets it back to `false`
   alongside its other per-image resets (`quad`, `rectified`, `recognition`,
   `phase`); `resetSession` clears it too, so a closed or completed session asks
   again on the next open. No storage key, no settings field.

2. **Stage machine.** `ModalStage` gains `'confirm'`; `modalStage` takes the
   flag:

   ```ts
   function modalStage(busy, recognition, source, rightsConfirmed): ModalStage {
     if (busy === 'detecting') return 'detecting';
     if (recognition) return 'review';
     if (!source) return 'upload';
     return rightsConfirmed ? 'crop' : 'confirm';
   }
   ```

   Every caller — the render switch, `close`'s `cp detect dismissed` — goes
   through it, so the dismissed stage comes out right for free.

3. **Rectification keeps running underneath.** `loadImageFile` still calls
   `autoRectifyImage` the moment the image is decoded. It is local work in the
   worker (the image never leaves the device: the only `fetch` on the detect
   path is the model registry and the model's own bytes, `lib/cpDetectModels.ts`),
   and doing it during the read means the crop step is ready the instant
   Continue is pressed. The crop step already renders with `quad === null` and
   `busy === 'rectifying'` for a first load today, so Continue need not wait.
   `canClose` already refuses the close button while rectifying; Back follows
   the same rule, which also closes the race of a late `setRectified` landing
   on a discarded session.

4. **A child component for the presentation.** `CpDetectRightsConfirmation.tsx`
   beside `CpDetectCropEditor.tsx` and `CpDetectModelLine.tsx`. Props are
   plain data and two callbacks:

   ```ts
   interface CpDetectRightsConfirmationProps {
     /** The picked image, by URL — never its pixels (see `cropSource`). */
     image: { url: string; width: number; height: number };
     busy: boolean;
     status: string | null; // "Rectifying crop", in the footer, while it runs
     error: string | null; // a failed rectification, shown here and not after
     onConfirm: () => void;
     onBack: () => void;
   }
   ```

   It owns the checkbox's checked state; the modal only learns the answer.
   The image is shown as an `<img src={url}>` capped at ~220 px tall, so the
   user is attesting about something they can see. The modal passes the
   existing `cropSource` memo, for the reason recorded on it — an `ImageData`
   prop is walked byte by byte by React's dev build.

   Layout, top to bottom, inside the modal's existing header (which already
   shows the file name):

   - the image
   - one short paragraph of context
   - a checkbox carrying the attestation itself (`settings-checkbox`, the class
     the shared confirm-with-option dialog uses, so it matches)
   - a footer: the busy status at the left (in the footer's own row, so its
     coming and going moves no button), then **Back** (ghost, disabled while
     busy) and **Continue** (primary, disabled until the box is ticked)

   Surface width follows the upload stage: `.cp-detect-modal__surface--confirm
   { width: min(620px, 100%); grid-template-rows: auto minmax(0, 1fr); }`.

5. **Copy** (English source, inline `t()` defaults; keys under
   `dialogs:cpDetectImport.rights.*`):

   | key | text |
   | --- | --- |
   | `rights.lead` | Crease patterns are their designers' work. Detect only a pattern you have the right to use: one you designed, one that was published for others to fold, or one whose designer gave you permission. The image is processed on this device and is never uploaded. |
   | `rights.attest` | I confirm that this crease pattern was obtained legally and that I have the right to use it. |
   | `rights.continue` | Continue |
   | `rights.back` | Back |

   The attestation sentence is the one the checkbox carries; the lead is
   context. The "never uploaded" clause is true today (point 3) and is there to
   make clear the question is about the user's rights, not our processing —
   drop it if the copy should stay shorter. Four new keys × 8 locales, then
   `i18n:extract` → translate → `i18n:stamp` → `i18n:check`.

6. **Analytics.** Two changes in `analytics/events.ts`, mirrored in
   `docs/analytics.md`:

   - `CpDetectDismissStage` gains `'confirm'`, so a close at the gate is
     counted where it happened.
   - One new event, `cpDetectRightsAnswered: 'cp detect rights answered'`,
     with `{ accepted: boolean }` — `true` on Continue, `false` on Back. Same
     shape as `fold warning accepted`. It is the funnel step between
     `cp detect image loaded` and `cp detect started`, and the reason to have it
     is the product question a new friction step raises: how many people bounce
     at the gate. No "shown" event; every `cp detect image loaded` shows it.

   Nothing about the image rides on either. A Close at the gate sends only
   `cp detect dismissed { stage: 'confirm' }`, not a `false` answer — the same
   split the dialog already makes between abandoning and declining.

7. **Tests** (`CpDetectImportModal.test.tsx`). The two walk helpers,
   `reachReviewStage` and `reachCropStage`, tick the box and press Continue
   after `click('Choose Image')` — a shared `confirmRights()` helper. New
   `describe('CpDetectImportModal rights confirmation')`:

   - after an image is chosen the gate is on screen with the file name, and
     neither the crop editor nor Detect is
   - Continue is disabled until the box is ticked
   - Continue reveals the crop step with the rectified result already in it
   - Back returns to the upload stage, drops the image and revokes its object
     URL, and sends `cp detect rights answered { accepted: false }`
   - Continue sends `{ accepted: true }`
   - Close at the gate sends `cp detect dismissed { stage: 'confirm' }` and no
     rights event
   - a second image chosen from the crop step asks again; so does one chosen
     from the review step
   - Back is disabled while the first rectification is still running

   The existing session-reset tests already reopen the dialog after an add and
   after a close; each gains one assertion that the gate is asked again.

## Decisions

- **Per image, not remembered.** The sentence being confirmed is about *this*
  crease pattern. A remembered answer would be an attestation about images the
  user has not seen yet, which is not one. It also keeps the change to the
  dialog: no storage key, no settings row, no `foldWarningEnabled`-style
  toggle. The cost is one tick and one click per detection, on a flow that
  already takes Choose → Crop → Detect → Review → Add. If that turns out to be
  too much friction (`cp detect rights answered` will say), the remembered
  variant is the fold-warning pattern: a `Don't ask again` option on the gate,
  a `STORAGE_KEYS` entry, a settings-store boolean, and a Settings ▸ General
  row to turn it back on.
- **A stage, not the shared confirm dialog.** `requestConfirmationWithOption`
  would stack a second modal over the first and cannot show the image. The
  dialog already has a stage machine; a stage is the cheaper and clearer fit.
- **Checkbox + Continue, not a button that is the sentence.** The explicit
  tick is the conventional affirmative act for a rights attestation, the
  sentence is too long to be a button label, and the shared dialog already
  styles exactly this checkbox.
- **After the image is chosen, not before the picker.** As asked. It also
  means the user attests about a specific, visible image rather than in the
  abstract.

## Affected Areas

- `apps/web/src/components/CpDetectImportModal.tsx` — `rightsConfirmed`,
  `ModalStage`/`modalStage`, the `confirm` render branch, resets in
  `loadImageFile` and `resetSession`
- `apps/web/src/components/CpDetectRightsConfirmation.tsx` — new
- `apps/web/src/components/CpDetectImportModal.css` — `--confirm` surface and
  the gate's layout
- `apps/web/src/components/CpDetectImportModal.test.tsx` — helpers and the
  new describe
- `apps/web/src/analytics/events.ts` — `CpDetectDismissStage`,
  `cpDetectRightsAnswered`
- `docs/analytics.md` — event table row, funnel list, dismissed stages
- `apps/web/public/locales/<lng>/dialogs.json` × 8 — the four new keys
- `apps/web/public/locales/.hashes.json` — stamped

Nothing in `apps/tauri`, no Rust, no wasm.

## Validation

- `npm run lint:web`, `npm run typecheck:web`, `npm run test:web` (from
  `apps/web`, Node 22)
- `npm run i18n:check`
- Browser: open Detect CP from Image with `VITE_CP_DETECT=1`, choose an image,
  confirm the gate shows the image and the file name; Back returns to the
  picker; Continue lands on the crop step with the rectified pane filled;
  Choose Image from the crop step asks again; Close at the gate reopens on the
  picker.

## Checklist

- [x] `rightsConfirmed` state, reset per image and per session
- [x] `ModalStage` + `modalStage` gain `confirm`
- [x] `CpDetectRightsConfirmation` component
- [x] `confirm` render branch in the modal, `--confirm` surface CSS
- [x] Analytics: `CpDetectDismissStage`, `cp detect rights answered`, `docs/analytics.md`
- [x] i18n: four keys, eight locales, stamped, `i18n:check` green
- [x] Tests: helpers updated, rights-confirmation describe, session-reset assertions
- [x] Browser check of the flow
- [ ] Draft PR against `main`
