# Fold workspace: mapping the design to existing components and patterns

**Scope.** I went through every element in the ten screenshots and the prototype (`design-script.js`, `fold-v2.dc.html`), and looked for the matching piece on this branch and on the Diagram branch (`31e1d6d84`). Each claim is marked **VERIFIED** (I read the code) or **INFERRED** (my judgement). I ran nothing and changed no files.

## 0. Headlines

1. **Paper painting is already one system, and Fold should be one more consumer of it.**
   - `PaperStyle` sets the paper's front and back colours and every pen.
   - `PAPER_STYLE_POLICIES` (`apps/web/src/lib/paper/paperStyleResolve.ts:82`) decides which pens each surface reads.
   - Three helpers apply it to any surface:
     - `usePaperStyleTokens` (`cp-workspace/references/usePaperStyleTokens.ts:241`) sets the colours as CSS custom properties on a workspace root.
     - `foldedSceneLocalGeometry(scene, style)` (`cp-workspace/adapters/cpFoldedToScene.ts:657`) turns a folded scene into WebGL geometry with the same functions the SVG painter uses.
     - `paperSceneSvgBody` (`lib/paper/paperSvg.ts:205`) draws the same scene as SVG.
   - The prototype's hard-coded colours (`fillOf`, `#f2df5b`, `#fbfaf4`, `foldColor`) and its swatch row have to go. **VERIFIED.**
2. **Several primitives Fold needs exist only on the frozen Diagram PR (#436), not on `main`:**
   - `ui/ToolRail`, `ui/tools/ToolHintInstructions`, `ui/Notice`, `ui/ActionList`, `ui/OptionCard`;
   - `ToolHintWindow`'s `inside` prop and `ui/useModalDialog`;
   - the `diagram` shortcut scope.
   - `CpToolRail` and `SimulatorToolWindow` were already moved onto these there. Fold either waits for #436, or these move to `main` first as a PR of their own. That decision belongs to you (§6). **VERIFIED** with `git ls-tree` and `ls`.
3. **Three existing parts fit the design almost line for line, but each needs extracting first:**
   - References' step strip (`ReferencesStepFilmstrip`), which already has "ways" — a card with N alternatives, shown as dots, a "Way n of m" readout and ↑/↓ keys. That is the branch "1/2" navigator.
   - The crease-pattern cards (`SheetGrid`).
   - Edit's on-canvas candidate window (`CpToolOptionLayer`), whose plan still has "a second tool's descriptor" unticked.

   `references-card` and `sheet-card`/`sheet-grid` are on the shared-blocks list in `implementation-plans/scoped-css.md`. AGENTS.md says moving a shared block needs your go-ahead and a PR of its own. **VERIFIED.**
4. **Genuinely new UI:**
   - the cross-section layer picker with flap brackets (keep it inside Fold);
   - a danger tone with action buttons on `Notice`, for the collision alert (extend the primitive);
   - a two-canvas split with a phone switch (keep it inside Fold).

   Everything else maps to an existing component as it is, or with one prop.

---

## 1. Design element → existing component

Fit: **as-is**, **prop** (needs a prop or variant), **extract** (shared code exists but has to be lifted out first), **missing**.

| Design element | Existing component / pattern | Fit | Notes |
|---|---|---|---|
| Workspace rail entry "Fold" | `WORKSPACE_DEFINITIONS` (`workspaces/workspaces.ts`) and `workspaceIcons: Record<WorkspaceId,…>` (`components/WorkspaceShell.tsx:59`) | as-is | Driven by data; adding the id is a type error until an icon is given. The rail CSS (`workspace-rail`) is shared, but nothing needs adding to it. The Diagram adds `diagram: BookOpen` on the same lines, so the two branches collide here. VERIFIED |
| Left tool panel, sections Fold / Reference points / Locate line / Model / Planned | `ui/ToolRail` on #436 (collapsible groups of icon tools, `{control}` groups, `collapsedByDefault`, open state saved); used by `CpToolRail` and `DiagramAnnotateRail` there | prop (once #436 lands) | The design's 184px labelled list is not our idiom. Our rails are icon-only, named by tooltip and by press-and-hold on touch. A phone has no rail and uses `ToolPickerSheet`/`ToolPickerGroup`/`ToolPickerRow` (`ui/tools/`), all as-is. Both should read one `foldRailGroups()` list, as Edit's `cpRailGroups()` serves both its surfaces. VERIFIED |
| V / M / P / IR fold kind | `SegmentedControl size="lg" fill iconsOnly` as a rail `{control}` group, the way Edit's line type works (`CpToolRail.tsx:260`) and Diagram's Line Type | as-is | The letter icon is `CpLineTypeMark`'s idea (letter in `--fold-mountain`/`--fold-valley` ink), but that component is typed to CP actions. Fold writes a small `FoldKindMark`, or a generic `LetterMark` is extracted (§4.12). IR in the same control is questionable (§6, Q6). VERIFIED / INFERRED |
| Keyboard badges (`V`, `M`, `D`, `T`, `]`) | Rails name the key in the tooltip, resolved against the user's layout: `shortcutLabelForAction(id, useShortcutResolution())` (`CpToolRail.tsx`, `DiagramAnnotateRail`) | as-is (drop the badges) | Shortcuts appear inline only in menus (styling.md, Menus). VERIFIED |
| Locate line, axiom grid F, 1–7 (A6 planned) | ToolRail tools with `available:false` plus a tooltip reason, as Edit's not-ready actions do (`cpActionDisabledReason`) | as-is | Glyphs: Oriedita's icon font already covers A3 = angle bisector `\uE006`, A4 = perpendicular `\uE008`, A5 `\uE076`, A7 `\uE078` (`cpToolGlyph.tsx`). Reusing them matches Edit's look; A1, A2, A6 and free line need the design's SVGs. VERIFIED |
| "Planned" section | ToolRail group, `collapsedByDefault`, tools unavailable | as-is | Whether the product should show a roadmap list at all is your call (Q7). INFERRED |
| Reference points: Divide line (count / ratio) | Edit's Divided Line options: `divide-mode`, `division-count`, `division-ratio` (`CpContextToolPanel.tsx:460-492`, `:960+`); ratio presets (`lib/oristudioCpToolSettings.ts:240`); Diagram's Equal Divisions uses `NumberRow` | as-is with primitives | Build it from `SegmentedRow` (Count / Ratio), `NumberRow`, and `Chip` with `aria-pressed` for presets. Chip's own doc names "a row of quick picks in a panel — the tool window's groups". Edit's markup sits in `cp-context-panel` (shared global) and speaks Oriedita's ratio form, so don't import it. Keep the same verb and the `D` key: the Diagram's Equal Divisions is also `D`. VERIFIED |
| Model: Turn over, Rotate 90° | Rail verbs (Edit's rail has one-click Generate tools); Diagram's "Turn Over" / "Rotate" labels | as-is | Use the Diagram's wording so a later link reads the same. These *add a step*, unlike the viewport's rotate-view keys `3`/`4`; see §5. VERIFIED |
| Top header: "Fold \| Steps" tabs, "2 steps", Import CP | `WorkspaceTabStrip embedded tone="peers"`, inside the `panel-toolbar` frame, exactly as `DiagramHeader` + `DiagramViewSwitch` do on #436 (References' mode switch likewise); `Button`/`SplitButton size="sm"` | as-is | Fold's header module may lay out its own parts, but must add no rule to `panel-toolbar` (shared). VERIFIED |
| Step strip with thumbnails, badges (SHEET / VALLEY / PREVIEW / BLOCKED / NEW BRANCH / IMPORTED CP) | `ReferencesStepFilmstrip` (`cp-workspace/references/ReferencesStepFilmstrip.tsx`): windowed strip, number plus badge, card kinds `fold \| turn-over \| done`, chevrons | extract | Thumbnail is hard-wired to `StepDiagram`. Fold needs a thumbnail slot and preview/blocked states (§4.2). VERIFIED |
| Instruction line "3. NEXT …" | The filmstrip caption ("number. sentence" plus note), and `Badge tone="accent"` for the tag | prop | The caption needs a tag slot. VERIFIED |
| Branch "1/2" on a card | Filmstrip "ways": a dot per way, "Way n of m" readout, ↑/↓ chevrons, `references.nextWay`/`previousWay` on ↓/↑ (`shortcuts.ts:449`) | extract / prop | The interface is the same; the meaning differs (a way swaps one card, a branch swaps every later card). INFERRED |
| "Folded" and "Crease pattern" split canvases | `FoldCanvasView` on the `CpRenderer` seam (plan D8; precedent `ReferencesCpView`) | missing (Fold-local) | No workspace has two canvases in one panel. Design's box-pleat panes are two Dockview panels with a phone `DesignPaneSwitcher`. I recommend one panel with an internal split, so `ToolHintWindow`'s container is the whole canvas area and the window overhangs the Step-pane seam as drawn. A phone needs a switch pill like `DesignPaneSwitcher`'s toggle. INFERRED |
| Monospace status chips ("Folded · Step 2 · 4 layers · A2 · click…", "Crease pattern M 1 V 3") | `ViewportStatusReadout` (mono, tabular figures, top-left, no pointer events) | as-is | One per canvas. "Dashed: creases this fold adds" fits as a second field. VERIFIED |
| Floating tool window, collapsible header "Valley fold · 3 settings" | `ToolHintWindow` + `FloatingPanel` (`ui/tools/ToolHintWindow.tsx`); its `meta` is documented as "a setting count, or 'Instructions'" | as-is | Collapse state saved under a new `STORAGE_KEYS.foldToolHintCollapsed`. Copy Simulate's shape: one renderer over a React-free tool-window model (`SimulatorToolWindow.tsx`, "One renderer for every tool"). VERIFIED |
| Numbered instructions with progress (done / current / todo) | `ToolHintInstructions` on #436 (heading, intro, bullets; Simulate and Annotate use it); Edit's `CpContextToolInstructions` uses an `<ol>` with no progress (`CpContextToolPanel.tsx:346`) | prop | Add `ordered` and `current` to `ToolHintInstructions`. Edit's copy could move onto it later, in its own PR (shared `cp-context-panel`). The "Snaps to corners…" text is the instructions' note. VERIFIED / INFERRED |
| "Locate line" select inside the window | `SelectRow` (`ui/fieldRows`) | as-is | VERIFIED |
| "Moving side: ⇄ Swap S" | `Button size="sm" variant="secondary"`, key in the title | as-is | VERIFIED |
| Cross-section layer picker with flap brackets | none | **missing (Fold-local)** | Specific to fold geometry; nothing else draws a section. Rows must be focusable or listed elsewhere for keyboard users. Its colours come from tokens and the paper style, not the prototype's literals. INFERRED |
| Flap pills "Flap 1 · 2 layers" (struck through when excluded) | `Chip` with `aria-pressed` (`ui/Chip.tsx`) | as-is | The secondary text is a span Fold owns inside the chip's children. Skip the strike-through, or ask Chip for a variant; never style its internals. VERIFIED |
| Collision alert with fixes ("Include Flap 1", "Mountain fold instead") | `Notice` on #436 (`info \| warning`, `role="status"`, no actions) | prop | Add `tone="danger"` and an `actions` slot. Refusals will also come from squash, sink and tuck. Edit has no inline alert-with-fixes primitive; the existing alerts are dialog hints and `SurfaceFailure`, which is full-pane. VERIFIED / INFERRED |
| Cancel (Esc) / Commit (↵) footer | `Button` secondary and primary in the window body (Simulate puts its buttons there); Edit's `cp-context-panel__apply` is shared global | as-is | Enter and Escape go through the registry, not the buttons (§5). VERIFIED |
| Choices that can't be pointed at (O5/O6 roots, IR openings, completions, CP-import layer orders) | `CpToolOptionLayer` + `toolOptionWindow.ts` ("‹ 2 of 3 › Apply Cancel", a frame around the region) | extract | Tied to `cpOverlayViewStore`. Placement and descriptor are pure (§4.6). Choices that *can* be pointed at keep the click, as that plan says. VERIFIED |
| Bottom bar: zoom, "Step creases", "Precreases", "→ Send to Edit" | `ViewportToolbar` with `ViewportToolbarGroupSpec`; modes carry `checked`; zoom readout with presets; declared per surface like `ReferencesViewportToolbar` | as-is | Send to Edit should reuse Design's verb (§4.8). Play / Pause for D12 goes here, as in References. VERIFIED |
| Right "Step \| Paper" tabs | Side panes in `WORKSPACE_SIDE_PANES` (`store/layoutStore.ts:~170`): lead `fold-step`, `fold-paper` as `tab-of`, same as Diagram's Step/Page/Layers; the touch drawer comes free | as-is | VERIFIED |
| Step pane header "Step 2 · VALLEY", sentence | `panel-title` (shared), `Badge` | as-is | `DiagramStepHeader` doesn't fit: its N field reorders steps, and Fold steps can't be reordered. VERIFIED |
| Property rows (Operation, Line, Layers, M/V/F counts) | `FieldRow kind="static"` (`ui/fieldRows/FieldRow.tsx`; used in `InspectorPanel.tsx:131`) | as-is | VERIFIED |
| "Pending fold" section, "Adds 4 creases (2 M, 2 V)" | `CollapsibleSection` and text | as-is | VERIFIED |
| "Viewing step k of n; folding here starts a branch" / "Imported CP jump" | `Notice` info / warning (#436) | as-is | VERIFIED |
| "Crease pattern by step" grid with legend | `SheetGrid` + `sheetThumbnail` (`cp-workspace/sheets/`): crease-pattern cards in the theme's crease inks, size line, listbox | extract / prop | Numbers from 1 (`index+1`); Fold's starts at 0, so it needs a label prop. No legend component exists; keep it in Fold or drop it (the inks are the app's standard ones). VERIFIED |
| Paper tab: shape Square / Rectangle / Polygon | `SegmentedRow` | as-is (UI) | The plan's V1 is square only ("Non-square sheets" is under Later), so the control is out of scope or disabled. Changing shape "starts a new sequence", which fits the sequences array naturally. VERIFIED |
| Paper tab: colour swatches | Simulate's Paper section: `ColorField` Front / Back bound to the app's display style through `useSimulatorPaperStyle` (`SimulatorViewControlsPanel.tsx:152-168`, `simulator/useSimulatorPaperStyle.ts:102`) | extract | Fixed swatches are the wrong model; see §4.1. VERIFIED |
| Paper tab: "Start with colour side up / white side up" | `SegmentedRow`, worded "Front up / Back up" as Diagram's Show-as side and the paper style's `front`/`back` | as-is | This is sequence state (step 0's view), not paint. VERIFIED / INFERRED |
| Import CP dialog: drop zone and samples | Modals: `useModalDialog` (#436), `simple-modal` (shared). Patterns from the open document: `DiagramPatternPicker` (#436). App file plumbing: `handleFileDrop`, `loadOristudioCpDocumentFromText` | extract / prop | Don't parse `.cp`/`.fold` in Fold (the prototype's `parseCP`). Sample cards are `SheetGrid` cards. The shell's drop policy is `open-or-import` for every workspace (`WorkspaceShell.tsx:72`), so a file dropped on the Fold canvas today opens in or merges into Edit; Fold needs its own drop policy. VERIFIED |

---

## 2. What #436 owns that Fold depends on

| Primitive on `31e1d6d84` | Fold use |
|---|---|
| `ui/ToolRail.tsx` (163 lines, generic, `CpToolRail` moved onto it) | left rail |
| `ui/tools/ToolHintInstructions.tsx` (Simulate and Annotate moved onto it) | numbered steps, once it has `ordered`/`current` |
| `ToolHintWindow`'s `inside` prop | possibly, depending on where the window should sit |
| `ui/Notice.tsx` | refusals, the branch notice, the CP-jump notice |
| `ui/useModalDialog.ts` | Import CP dialog |
| `diagram` / `diagram-path` scopes, `registerArmedMode` / `escapeEndsArmedMode` | the template for the `fold` scope and the Escape order |

**Options:**
- (a) Build Fold's shell after #436 merges.
- (b) Move these primitives to `main` now, as a PR of their own.
- (c) Write Fold copies.

(c) breaks your rule. (b) duplicates work #436 already did and will conflict when it merges. **Recommendation:** (a) for the shell (plan Phase 4). Phases 1–3 (engine, bridge, document) don't depend on it. INFERRED.

---

## 3. Genuinely missing pieces

| Piece | Where it belongs | Why |
|---|---|---|
| Cross-section layer picker | `components/fold/` | Only Fold has layers through a line. Its data (U, depth choices, which layers each fold joins) comes from the engine (D15). INFERRED |
| Split canvas with phone switch | `components/fold/` | One surface. The phone toggle should copy `DesignPaneSwitcher`'s two-pane pill, not invent another. INFERRED |
| `Notice` danger tone and actions | `components/ui/Notice` (prop) | Refusals naming faces with suggested fixes will recur in every compound fold; a Fold-only alert would be a second alert look. INFERRED |
| Branch navigator | variant of the extracted step strip (§4.2) | The ways UI already exists. INFERRED |
| Steps-grid legend | Fold-local, or drop it | No legend component exists in the app. VERIFIED |

---

## 4. Share or build new, candidate by candidate

### 4.1 Paper painting — highest priority

- **What exists (VERIFIED):**
  - `PaperStyle` (`lib/paper/paperStyle.ts`): `paper.front/back`, edge, M/V fold, M/V diagram-crease, aux, arrow pens, erode, light.
  - `PaperSurface` and `PAPER_STYLE_POLICIES` (`paperStyleResolve.ts:29,82`). The `references` policy is paper + edges + aux + M/V folds + diagram creases + arrows.
  - `referencesPaperTokens` / `usePaperStyleTokens` (`usePaperStyleTokens.ts:141,241`) set `--references-paper-front/back`, `--fold-*`, `--diagram-*` and `--references-arrow` on the workspace root. So the canvas, the cards and the CSS (`theme.css:7701+`) all follow Settings → Paper. The pattern-rail cards keep the theme inks through `--sheet-thumb-*`.
  - `foldedSceneLocalGeometry(scene, effective)` paints a `PaperScene` on WebGL with `paperFaceFill`/`penForRole`, which are the SVG painter's own functions. It hard-codes `PAPER_STYLE_POLICIES['folded-3d']` (`cpFoldedToScene.ts:662`).
  - Three precedents for who owns the colours:
    - Simulate's pane edits the app display style (`useSimulatorPaperStyle`);
    - the folded figure pins per-object overrides (`foldedFigureProperties.ts:207-211`, `writeOverride('paper.front')`);
    - Diagram keeps a per-document `DiagramStyle` preset, applied through the `references` policy (`annotationPrimitives.tsx:270` on #436).
- **What Fold needs:**
  - **Folded pane:** faces in front/back colour, folds drawn as edges, aux creases.
  - **Crease-pattern pane:** creases in the M/V fold pens on the paper.
  - **Pending fold:** line and arrow in the diagram-crease and arrow pens.
  - **Thumbnails:** the same, painted small.

  That is exactly the `references` policy's field list.
- **Options:**
  - (a) Copy References' tokens into Fold. That makes a parallel copy.
  - (b) Generalise:
    1. Add `PaperSurface: 'fold'` with References' field list.
    2. Rename `usePaperStyleTokens`/`referencesPaperTokens` to a surface-neutral `usePaperSurfaceTokens({ policy, showAuxOption })` with neutral token names. Migrate References and its `theme.css` readers, which are global, so this is its own commit.
    3. Give `foldedSceneLocalGeometry` a `policy` parameter (`folded-3d` stays the default for Edit).
    4. Lift Simulate's Front/Back `ColorField` section and its binding into a shared `PaperColorsSection` / `usePaperStyleBinding(fields, source)`. Fold's Paper tab and Simulate's pane render the same component.
  - (c) Reuse the hooks as they are under References names. It works, but it's naming debt.
- **Cost / risk:** moderate. The rename touches `theme.css` rules for `step-diagram` and `references-card`; renaming a custom property inside them is "editing in place", which is allowed, but References' pixel parity needs a browser check in both themes. `PaperStyleEditSource` gains a Fold value (analytics enum).
- **Recommendation:** (b). Paint the folded pane via the D11 scene → `foldedFlatPaperScene` → `foldedSceneLocalGeometry(…, policy)` → `setFolded`. Paint thumbnails via `paperSceneSvgBody`. In V1 a sequence has no colours of its own; the Paper tab edits the display style the way Simulate's pane does.
  - **Evidence:** `foldedSceneLocalGeometry`'s doc says "the canvas and the file cannot disagree about what a style means". `references` already lists every pen Fold draws.
  - **Caveat:** `foldedSceneEpsilon` is `max(sheet,1)·1e-5` (`foldedFlatScene.ts:142`). With a unit sheet that is 1e-5, between Fold's tol (1e-6) and μ (1e-3). It should be fine, but it's a constant to check.
  - VERIFIED for the code, INFERRED for the recommendation.

### 4.2 Step strip, caption and branches

- **Exists:** `ReferencesStepFilmstrip` (378 lines) + `referencesFilmstrip.ts`.
  - Windowed: measured at "2.66 s at p99" before windowing.
  - Number, badge, kind classes, caption, note.
  - Ways (dots, readout, chevrons, vertical swipe), phone mode with no chevrons.
  - Styled by the global `references-filmstrip` / `references-card` block (`theme.css:7267+`), which is on the shared list.
  - Lookups by class: `querySelector('button.references-card[aria-current="step"]')` and `closest('.references-filmstrip__item')` in `swipedCard`; `ReferencesPanel.test.tsx:272,296` queries `.references-filmstrip`. VERIFIED
- **Fold needs:** the same strip with a folded-state thumbnail slot, preview / blocked / new-branch / imported card states, a caption tag (NEXT / JUMP), and branches in place of ways.
- **Options:**
  - (a) Fold writes its own strip.
  - (b) Extract `components/steps/StepFilmstrip` (or `ui/`) with `renderThumbnail`, `state` and `tag` props; move the block into its module; turn the class lookups into data attributes; migrate References.
  - (c) Reuse it by importing from `cp-workspace/references`. That imports across concerns, and the thumbnail is fixed to `StepDiagram`.
- **Cost / risk:** (b) is a shared-block move, so its own PR plus your answer. Gates: References' tests, and a before/after computed-style check in both themes and under a coarse pointer.
- **Recommendation:** (b). The windowing and touch work is too valuable to copy, and a second strip would drift. INFERRED

### 4.3 Crease-pattern cards (steps grid, import samples, picking a pattern from the document)

- **Exists:**
  - `SheetGrid` + `sheetThumbnail`, shared by References and Simulate (`sheet-grid`/`sheet-card` on the shared list).
  - #436 adds `DiagramPatternPicker` + `DiagramSheetThumbnail`, which its own doc calls "The Diagram's own… the rails' SheetGrid keeps its cards". That's already a second copy. VERIFIED
- **Fold needs:** cards numbered from 0 for the steps grid, sample cards, and picking from the open Edit document's patterns (Phase 6, "start from this Edit crease pattern").
- **Recommendation:** one card component with variants for rail column, grid and compact picker, plus a label prop. Fold uses it; References, Simulate and Diagram move onto it. Its own PR after #436 merges. Until then, Fold can use `SheetGrid` as it is and ignore the 0/1 numbering. INFERRED

### 4.4 Tool rail and phone tool sheet

Reuse `ui/ToolRail` and `ui/tools/ToolPicker*` as they are, with one `foldRailGroups()` read by both (the `cpRailActions.ts` pattern). Fold glyphs go in `components/fold/FoldToolGlyph`. Prerequisite: §2. VERIFIED

### 4.5 Tool window content

- `ToolHintWindow` as-is.
- Content from a React-free `foldToolWindowModel` with one renderer, the shape of Simulate's `tools/actions.ts` → `SimulatorToolWindow`.
- Add `ordered` + `current` to `ToolHintInstructions` rather than a Fold list.
- The fold-kind segmented control, swap button, section picker, pills, notice and footer are composed inside the window body.

INFERRED

### 4.6 The candidate chooser

- **Exists:** `CpToolOptionLayer`, a pure descriptor plus pure placement (`toolOptionPlacement.ts`), a frame around the region, "‹ n of m › Apply Cancel". The layer reads `cpOverlayViewStore` (a CP singleton). Plan `on-canvas-tool-option-window.md:210` still has "A second tool's descriptor sketched in a test — the honest check" unticked. Edit's folded figure offers "Another solution" / "Back to first solution" (`foldedFigureActions.ts:627`). VERIFIED
- **Fold needs:** O5/O6 roots (shown as gray candidates; the canvas can point at those, so they keep the click); IR openings, squash and rabbit-ear completions and CP-import layer orders (often not pointable).
- **Recommendation:** extract the layer so it takes a projection function or camera instead of the store; Fold becomes the second descriptor the plan asked for. Small and low risk. INFERRED

### 4.7 Refusal notice

Extend `Notice` (§3). Refusals arrive as codes and are turned into text by i18n helpers inside Fold. The two fix buttons map to actions in the catalog. INFERRED

### 4.8 Send to Edit

- **Exists:**
  - `sendToEditPrimary` / `sendToEditVariants` (`designKinds/sendToEditActions.ts:45`): label "Send to Edit", key `common:toolbar.sendToEdit`, `Send` icon, a `SplitButton` for variants such as "include circles".
  - The store path `ensureEditCreasePattern()` → `importAddOristudioCpText(payload)` → activate Edit (`creasePatternSlice.ts:1585-1630`), with a `track…SentToEdit` event. VERIFIED
- **Fold needs:** the same verb; variants for precreases as F or aux (Phase 6 open preference).
- **Recommendation:** reuse the verb, i18n key, icon and `SplitButton` model, and build the payload as FOLD text through `importAddOristudioCpText`. Generalising `sendToEditActions` from a kind-keyed module to a "source" one is small. Placement (bottom bar as drawn, or the header as Design has it) is your call. INFERRED

### 4.9 Import CP

- Reuse the app's parsers, not the prototype's.
- Offer the open document's patterns through the shared card picker (§4.3).
- Choose the layer order with the candidate chooser (§4.6).
- Give the Fold canvas its own drop policy instead of the shell-wide `open-or-import`.

A CP jump in the middle of a sequence, which the design has ("Adds a step after step 2"), goes beyond the plan's Phase 6, which only starts a sequence from a CP. VERIFIED (code), INFERRED (scope)

### 4.10 Keyboard — see §5

### 4.11 Instruction sentences

- **Exists:**
  - `referencesStepSentences.ts` (742 lines).
  - Exported `referenceName` (compass names: "the bottom edge", "the top-left corner"; `:77`).
  - Per-axiom clauses in `stepSentence` (`:127`) and `witnessClause`, both tied to ReferenceFinder slot order (O7's swap) or planner letters.
  - `describeAxiom` (`:712`).
  - On #436, a source's sentence becomes the Diagram step's text until edited (`diagramDocument.ts:1426-1482`, `source.sentence`). VERIFIED
- **Fold needs:** "Valley fold [in half diagonally], bringing the bottom-right corner to the top-left, through all layers / the top flap (2 layers)". That is the verb, the axiom clause, references named in the current view's frame plus provenance, and the layer scope.
- **Options:**
  - (a) Fold writes its own sentence module, a third.
  - (b) Extract the reusable parts (compass names, axiom phrases, the role-named clause templates "bringing {{p0}} onto {{p1}}") into a neutral module (e.g. `lib/foldSentences/`). References keeps its wire-specific slot reading. Move the i18n keys out of `panels:references.*` in one i18n-only commit across all 9 locales.
  - (c) Import the References functions as they are.
- **Recommendation:** (b), but only the vocabulary.
  - Fold's sentence builder is a pure function in `fold/`, so the Phase 7 `fold-step` source can store `sentence` exactly as `references-step` does.
  - Fold V1 doesn't edit sentences; the Diagram is where instructions are edited.

  INFERRED

### 4.12 Letter marks (small)

`CpLineTypeMark` is a letter in the fold inks, typed to CP actions. A generic `ui/LetterMark` that `CpLineTypeMark` wraps is cheap. Fold could also write its own 15-line mark. It's the lowest priority here. VERIFIED / INFERRED

### 4.13 Undo affordances (minor)

The global Undo and Redo, plus `CanvasHistoryPills` on touch, as Edit has. No Fold-specific buttons. VERIFIED (components exist), INFERRED (fit)

---

## 5. Keyboard: the design's keys against the registry

**Approach (VERIFIED):** conditional scopes are pushed only while their panel holds an executor (`CONDITIONAL_SCOPES`, `shortcuts.ts:1128`; `shortcutRuntime.ts:195-205`). They come ahead of `viewport` and `global`, and are never stacked together with `crease-pattern`. #436 adds `diagram` and `diagram-path` the same way, with bare letters. So a conditional `fold-sequence` scope can use bare letters freely.

**Abstraction worth doing:** each conditional scope is plumbed by hand (its own executor variable, register function and stack push; the Diagram copies it a third and fourth time). A keyed `registerConditionalScopeExecutor(scope, executor)` would make Fold's scope data rather than a fifth copy. Do it after #436 merges, as a refactor of its own; it edits the same lines. INFERRED

| Key (design) | Meaning in design | Clashes with | Verdict |
|---|---|---|---|
| V, M, P | Valley, mountain, precrease | Diagram V/M arrows, P push arrow; Simulate P pin (never stacked together) | Fine. V/M mean the same kind of thing as in the Diagram. |
| R | Inside reverse | Simulate R restart (not stacked); global Mod+R Optimize Scale (different chord) | Fine |
| D | Divide line | Diagram D Equal Divisions (same meaning) | Fine |
| T | Turn over | none found | Fine |
| `]` | Rotate 90° (adds a step) | **Diagram `[`/`]` = previous/next step** | **Inconsistent across workspaces.** Recommend `[`/`]` and ←/→ for previous/next step, as Diagram and References use them, and give Rotate another key (Q10). |
| S | Swap moving side | Diagram S solid arrow (not stacked); viewport Shift+S simulate selection (different chord) | Fine |
| 0, 1–7 | Free line, axioms 1–7 | **Viewport-scope bare digits:** `1` pan, `3`/`4` rotate view, `5`/`6` zoom (`shortcuts.ts:543-559`). `0` is reset view in Simulate and References. | A fold scope ahead of `viewport` would shadow pan, rotate-view and digit zoom in Fold. Either accept that (zoom stays on Mod+=/−), or move the axioms to Shift+digits. Q9. |
| Enter | Commit | `viewport.solveAnglesApply` (declines); Diagram Enter declines for a focused control | Copy the Diagram's decline, so Enter on a focused Cancel button doesn't commit. |
| Esc | Cancel ladder | `viewport.cancel` | Not a fold-scope key. Fold's viewport executor runs one cancel ladder (preview → picks → tool), as the Diagram does; register an armed mode so the touch View sheet doesn't take Escape first (`registerArmedMode` on #436). |
| Alt | Place a point freely | none; `keyboard/heldModifiers.ts` is the primitive | Read `readHeldModifiers().alt`, never a `keydown` listener on the panel. |
| X, ↑/↓ | Include or exclude flap; x-ray depth (alternative pickers) | References ↑/↓ = ways | Only if those pickers ship. Then ↑/↓ can't also walk branches. |
| Space (not in design) | — | Simulate play/pause, References play fold | Use it for Fold's step animation (D12), for parity. |

---

## Recommendations, ranked

1. **Paint the paper through the existing style system** (§4.1). Add a `fold` paper surface with References' fields, a neutral `usePaperSurfaceTokens`, a policy parameter on `foldedSceneLocalGeometry`, and a shared Paper colours section with Simulate. No colours specific to Fold.
2. **Sequence the shell after #436 merges**, and build the engine, bridge and document now (§2).
3. **Extract the step strip** from References, with a thumbnail slot, card states, a caption tag and branches as ways (§4.2). Its own PR, with your go-ahead (shared block).
4. **Generalise `CpToolOptionLayer`** for choices that can't be pointed at; Fold is its second descriptor (§4.6).
5. **Build the tool window as a React-free model plus one renderer** (Simulate's pattern), with `ordered`/`current` added to `ToolHintInstructions` (§4.5).
6. **Use `ui/ToolRail` + the `ToolPicker*` sheet** from one `foldRailGroups()`. Fold kind is a segmented `{control}`; shortcuts go in tooltips (§4.4).
7. **Reuse Send to Edit**: the verb, label, `SplitButton` and `importAddOristudioCpText` path (§4.8).
8. **Add a conditional `fold-sequence` scope**: `[`/`]` for steps, Rotate on another key, settle the digit clash, Escape through the viewport ladder. Later, a keyed conditional-scope registry (§5).
9. **Extend `Notice`** with a danger tone and actions for refusals (§4.7).
10. **One crease-pattern card component** for SheetGrid, the Diagram's picker and Fold's grid and samples. Its own PR after #436 merges (§4.3).
11. **Shared sentence vocabulary** (compass names, axiom phrases), with Fold's sentence builder pure for the Diagram link (§4.11).
12. **Keep the layer picker and split canvas inside Fold** (§3). `LetterMark` is optional (§4.12).

## Open questions

1. **#436 primitives:** wait for the merge (recommended), or land them on `main` first as their own PR?
2. **Shared-block moves:** OK to move `references-card`/`references-filmstrip` (step strip) and `sheet-card`/`sheet-grid` (cards) in PRs of their own? AGENTS.md needs your answer.
3. **Paper colours:** V1 reads and edits the app display style, as Simulate does (recommended). Should a sequence ever pin its own colours, as the folded figure does, or have its own preset, as the Diagram does?
4. **Token rename:** rename References' paper tokens to neutral names (one migration commit), or have Fold reuse `--references-*` names?
5. **Paper shape:** the design has Rectangle and Polygon; the plan's V1 is square only. Hide the control, or disable it with "planned"?
6. **IR in the V/M/P segmented control:** IR is an operation with different inputs, and eight more compound folds are coming. Recommend V/M/P as the direction control and operations as rail tools.
7. **"Planned" list:** show it in the product, collapsed and disabled, or leave it out?
8. **Branches and the sequences array:** the design's steps form a tree. Persist branches as tree nodes inside a sequence, or as sequences that fork from another (`forkOf: {sequenceId, stepId}`) inside the agreed array? The second makes "several sequences" and "branches" one structure. D6/D7 need updating either way.
9. **Axiom keys:** accept that bare 1–7 shadow pan, rotate-view and digit zoom inside Fold, or use Shift+digits?
10. **Rotate 90° key:** free `]` for next step (Diagram parity) and bind Rotate to what?
11. **Send to Edit placement:** bottom bar (design) or header (Design's place)? And the precrease variants: F, aux, or both behind the caret?
12. **Mid-sequence "CP jump":** in scope? The plan's Phase 6 only starts a sequence from a crease pattern.
13. **Layer picker:** which of the three (cross-section, click to cycle, hover x-ray)? It decides whether X and ↑/↓ are taken.
