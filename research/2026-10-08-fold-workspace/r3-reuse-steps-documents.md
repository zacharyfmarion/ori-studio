# Fold workspace: reuse report on the step model, the document, history and cross-workspace steps

All repo paths are relative to `/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/fold-workspace-research-c52ced`. A path written `@436:` is read with `git show 31e1d6d84:<path>`.

**Scratch measurement:** `/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/fold-workspace-research-c52ced/artifacts/fold-spike/reuse/step-model/embed-size.mjs`. Run it with `node artifacts/fold-spike/reuse/step-model/embed-size.mjs`.

## Summary

1. **Share the envelope, not the step model.** Fold should share the parts the Diagram half-built:
   - the lenient reader rules, `formatVersion` and read-only mode;
   - carrying unknown kinds verbatim;
   - id factories;
   - the scoped-reset keys;
   - commit and undo over `snapshotHistory`;
   - the save/load/discard wiring.

   It should **not** share a generic "step sequence" model:
   - the Diagram's linear, freely reordered list;
   - Fold's tree of steps that is never reordered;
   - References' derived plan.

   These three have different rules, and forcing one shape onto all of them would be worse than three shapes.
2. **The project file has a cheaper option than raising the reader version.**
   - Every release since v0.2.0 already carries the file-level `extensions` bag through load and save unchanged.
   - Storing fold sequences under a typed key there gives forward compatibility with releases already shipped.
   - It needs no reader-version bump, and it avoids racing #436 for "reader 9".
   - It contradicts the wording of a house rule (`superset-features.md`), so it needs your decision.
3. **One digest of the steps along a path can serve three jobs:**
   - the key for the in-memory state cache;
   - the Diagram link's staleness check;
   - drift detection.

   This copies References, whose plan-cache key already doubles as the Diagram's provenance.

---

## 1. The persisted step model

### 1.1 What the design actually does (VERIFIED, read in `design-script.js`)

- **Nodes.** `addNode` (line 92) stores `{id, parent, children, st, op, text, cp, diff}`.
  - Committing at the cursor adds a child and sets `active[cursor] = child` (line 229).
  - `path()` (line 192) follows `active[id] || lastChild`.
  - The "1/2" branch control cycles `active[id]` (lines 324–325).
- **Ops** are `{type: V|M|P|IRF|T|R|CP, ax, L, ms, sel}`.
  - `sel` holds **flap indices** into the current analysis (lines 90, 229). Those do not survive replay.
- **Divide-line marks** are stored in **sheet coordinates** with `from: nodeId`. They are visible on that node's descendants only (lines 195, 219).
- **Import CP** (lines 233–237):
  - into an empty sequence, it replaces the root;
  - otherwise it adds a `CP` node after the cursor;
  - it is refused when the sheet shape differs ("Import it into a new sequence instead").
- **Turn over and Rotate are nodes**, numbered like folds (line 230).
- **Click order is not the axiom's input order** (the `AX` table, lines 139–147):
  - A4 is clicked `[edge, pt]`;
  - A5 is clicked `[pt, pivot, edge]`;
  - the crate's order is O4 `[p, m]` and O5 `[pivot, p, m1]` (`crates/oristudio-precrease/src/predicates.rs:97-99`).

### 1.2 Proposed shape (INFERRED design, grounded in the precedents cited)

```ts
interface FoldSequenceDocument {          // one per entry of foldSequences[]
  formatVersion: 1;                       // per sequence, so a newer one opens read-only on its own
  id: string;                             // 'fold-<uuid>'
  title: string;
  paper: {
    shape: { kind: 'square' } | { kind: 'rectangle'; aspect: [number, number] } | { kind: 'polygon'; points: [number, number][] };
    startSide: 'front' | 'back';          // "Color side up / White side up": changes what V/M mean, so it is in the document
    style?: PaperStyleOverrides;          // optional (folded-figure `appearance` precedent); colours otherwise from the app PaperStyle
  };
  steps: FoldStepNode[];                  // flat, parent-linked; siblings kept in creation order
}
interface FoldStepNode {
  id: string;                             // 'fstep-<uuid>'
  parent: string | null;                  // null = folded from the flat sheet (no synthetic root node)
  op: FoldOp;                             // kind-tagged
  choices?: FoldChoices;                  // resolved choices, stored as RESULTS (see 1.4)
  expect?: string;                        // 'fs1:…' of the state produced at commit (drift detection)
  marks?: FoldMark[];                     // Divide-line points made here, visible to descendants
  note?: string;                          // the author's words; the sentence itself is generated
  unknown?: Record<string, unknown>;      // a newer build's node: locked, and so is its subtree
}
type FoldOp =
  | { kind: 'valley' | 'mountain' | 'precrease'; line: FoldLine; moving: FoldPoint; seed: FoldSeed;
      extent?: { kind: 'full' } | { kind: 'pinches'; spans: [[number,number],[number,number]][] } } // extent reserved (C9)
  | { kind: 'turn'; turn: TurnKind }      // = DiagramTurnKind (C12)
  | { kind: 'cp-jump'; cpJson: string; orderJson: string; source: { format: 'cp'|'fold'|'edit'|'sample'; name?: string } }
  | /* Phase 8: 'inside-reverse', … each its own kind */ never;
interface FoldLine { axiom: 0|1|2|3|4|5|6|7; inputs: FoldRef[]; root: number; line: { n: [number, number]; d: number } }
// inputs are in the crate's axiom order; `line` is the target that certify() matches the nearest root against
type FoldRef = { kind: 'corner' | 'point'; at: [number, number] }
             | { kind: 'edge' | 'crease'; a: [number, number]; b: [number, number]; madeAt?: string }
             | { kind: 'mark'; id: string };
type FoldSeed = { scope: 'all' } | { scope: 'depth'; at: [number, number]; depth: number } | { scope: 'flaps'; at: [number, number][] };
```

The reader's state, which is never part of undo, is a separate record: `{ v: 1, sequenceId, cursor, activeChild: Record<nodeId | '', childId> }`. It follows References' `ReferencesReaderStateV1` (`cp-workspace/references/referencesReaderState.ts:54`) and Diagram D14 ("view state lives in the slice, outside history").

**Why a flat list with parent links, not nested children.**
- The lenient reader can judge each node on its own:
  - duplicate ids: the first wins (Diagram rule, `@436:diagram/document/diagramFile.ts:160-191`);
  - an orphan whose parent is missing is dropped;
  - a cycle is dropped.
- A nested shape loses a whole subtree to one bad object.

**Why no synthetic root node.** "Import CP into an empty sequence" is simply the first node, a `cp-jump` with `parent: null`. Several top-level nodes are branches at the flat sheet.

**Why seeds and references are sheet anchors, not flap or face indices.**
- Face ids are renumbered on every step (research §10).
- The design's `sel` flap indices are worse still, because they index a per-preview analysis.

### 1.3 Replay, broken steps, branches

- A node's state is fixed by its single path from the sheet. **A node id is therefore a complete link target**, which is what the Diagram should reference (C13).
- **Broken steps (derived, never stored).** This follows Diagram link status, which is "Derived, never stored" (`@436:diagram/capture/linkStatus.ts:1-14`).
  - A node whose inputs no longer resolve is broken, and so is its **subtree**.
  - Sibling branches are unaffected.
  - An `expect` mismatch (same steps, a different state, typically after an engine change) is a distinct "changed" mark, not "broken".
  - An unknown op kind locks its node and subtree. Locked nodes can be deleted but not edited.
- **Lenient reading for a tree (INFERRED).**
  - Diagram drops a malformed step. In a tree that would silently take the whole subtree with it.
  - Recommendation:
    - a node with a malformed **structure** (id or parent) is dropped with its subtree;
    - a node with a malformed **op** is kept verbatim and locked.
- **No in-place editing of a middle step in V0.** "Fold differently here" makes a branch, which is the design's own model. Committing is append-only, so nothing downstream breaks from an edit.
- **No race on commit.** The preview is validated in the worker before Enter, so the commit itself is synchronous and needs no Diagram-style `revision`.
  - A `loadId` is still needed so a replay still running after New or Open is thrown away (Diagram D1, `diagramLoadId`, VERIFIED).

### 1.4 Store resolved choices as results, never as enumeration indices

- **Why indices are unsafe.**
  - The Diagram stores `foldCase: number` (`@436:diagram/document/diagramDocument.ts:138`). That works there only because Refresh and link status exist to catch a change.
  - In Fold, every later step builds on the choice. An index that maps to a different solution after a solver change would silently corrupt the whole subtree.
  - References measured exactly this kind of instability: plans "are not reproducible" under wall-clock budgets (`implementation-plans/references-persistence.md:21-26`, VERIFIED).
- **Recommendation (INFERRED):**
  - **axiom root:** store the resulting `line`, and on replay take the nearest root through `Construction::certify(target)` (`crates/oristudio-precrease/src/construct.rs:142-154`, VERIFIED). This reuses the crate as it is.
  - **completion, CP-jump layer order, sink pocket:** store the chosen order as data, or its `fs1` fingerprint plus an index as a hint. If no enumerated solution matches on replay, the node is broken; nothing is guessed (D6).

### 1.5 History

- **Reuse `snapshotHistory.ts` as it is** (VERIFIED, 86 lines, generic over `S`; used by BP, `designContent` and, on #436, the Diagram).
- Snapshot the whole `foldSequences[]` array. Immutable updates share unchanged nodes between snapshots.
- A byte cap like `trimDiagramHistory` (`@436:store/workspaceStore/diagramState.ts:319`) is not needed until CP-jumps get large (C19).
- **What is undoable:** committing a node, deleting a subtree, changing the paper, importing a CP, renaming.
- **What is not:** moving the cursor, switching branches, tool state. This follows Diagram D14 and `superset-features.md` §6.
- **Routing:** one `if (context === 'fold')` branch in `historySlice`, which is exactly what #436 added for the Diagram (`@436:…/historySlice.ts:468-477`, VERIFIED).

---

## 2. Candidates

### C1. The lenient envelope kit: extract it (high value, low cost)

**What exists (VERIFIED):**
- `@436:diagram/document/diagramFile.ts`:
  - `readDiagram` returns `{document, readOnly, raw}`, with read-only on a newer version (`:160-191`);
  - `writeDiagram` returns the raw value when read-only (`:274-278`);
  - `unknownDocumentField` (`:241`), `hasNewerKey` (`:518`), the `NEWER` sentinel (`:1046`), and carrying a step verbatim (`writeStep`, `:315-322`);
  - id dedup with the first one winning (`:166-175`).
- `DiagramIdFactory` / `randomDiagramId` (`@436:diagramDocument.ts:1035-1037`).
- `function isRecord` is copied in **13** non-test files on `main` and **20** at #436; `finiteNumber` in 7 (counted with `git grep`).
- `NEWER` and `hasNewerKey` exist only in `diagramFile.ts`.

**What Fold needs:** all of it, on day one (D7).

**Options:**
- (a) copy it into a `foldSequenceFile.ts`;
- (b) extract `lib/documentFile/` with `isRecord`, `finiteNumber`, `NEWER`, `hasNewerKey`, `readEntries(values, readOne)` (dedup and unknown-carry), `readVersioned`/`writeVersioned` and `IdFactory<P>`. Fold uses it; the Diagram migrates after #436 merges.

**Cost and risk:** about one day (INFERRED). It is a pure module and a new file on `main`, so it does not conflict with frozen #436. The Diagram's migration is gated by its existing `diagramFile.test.ts`.

**Recommendation: (b).** Each document keeps its own per-field validation. Only the "is this a newer build's?" logic is shared, one predicate per question (AGENTS.md).

### C2. The store kit (scoped keys, commit, travel, install): extract it, after #436

**What exists (VERIFIED, @436):**
- `DIAGRAM_SCOPED_KEYS` plus `discardDiagramState` (`store/workspaceStore/diagramState.ts:29-48, :235`), spread at **7** project-replacing sites.
- `commit` (`slices/diagramSlice.ts:147-181`):
  - read-only gate;
  - an edit that returns the same object records nothing;
  - `recordSnapshot` plus trim;
  - `extend` to coalesce edits.
- `travel` (`:223-249`) and `installDiagram` (`:324-333`).

**What Fold needs:** the same semantics, plus a `foldSequenceLoadId`.

**Options:**
- (a) a parallel copy in a `FoldSlice`;
- (b) a generic `createProjectDocumentHistory<D>({get, set, keys, beforeCommit?, trim?})`. Diagram-specific steps (`settlePlaces`, `withReferencedAssets`, `trimDiagramHistory`) stay as Diagram hooks.

**Cost and risk:** 1–2 days plus the Diagram's migration (INFERRED). The Diagram's 900+ lines of `store.test.ts` additions are the gate.

**Recommendation: (b), but not inside frozen #436.**
- If Fold's Phase 3 starts before #436 merges, write Fold's slice against this generic shape.
- Migrate the Diagram in a follow-up, behaviour-preserving PR.

### C3. The project-document registry in `projectSlice` and `nativeProjectFile`: extract it

**What exists (VERIFIED, @436):**
- `projectSlice` has 53 added lines naming the Diagram:
  - `loadDiagramOnlyProject` (`:1406`);
  - `currentDiagramFileValue` (`:1579`);
  - `diagramChangedSince` (`:1603`);
  - `keepsOriedita = !forceSaveAs && get().diagram === null` (`:1993`);
  - `diagramOnly` save routing (`:2117`).
- `nativeProjectFile` computes `minimumReaderSchemaVersion` in **three** places (`:610, :686, :1145`).
- `historyCountForContext` already follows the descriptor pattern for design kinds ("Nothing here should know the kinds", `@436:store/workspaceStore/capabilities.ts`).

**A concrete data-loss trap (VERIFIED code, INFERRED consequence).** If Fold does not join `keepsOriedita`, then pressing Cmd+S in a project opened from `.cp`/`.ori` with a fold sequence keeps the Oriedita format, which has nowhere to put the sequence.

**Options:**
- (a) add `|| foldSequences.length > 0` at each site;
- (b) a small registry. Each project document supplies `{read, write, isPresent, changedSince, discard, install, dataBytes}`, and `projectSlice` loops over the registry. "Diagram-only" becomes "project-documents-only".

**Cost and risk:** 2–3 days (INFERRED). This is high-traffic save/open code, so a mistake means data loss. It is gated by the store entry-point tests D1 already requires.

**Recommendation: (b), after #436 merges.** It also makes a later `diagrams[]` cheap. Until then, Fold must at least join `keepsOriedita`, the save routing and landing.

### C4. A generic "step sequence" model across Diagram, Fold and References: do not build it

Each of the three has its own rules (VERIFIED):

- **Diagram:**
  - an ordered list numbered by position (`stepNumbers`);
  - freely reordered;
  - turns are entries (D22).
- **Fold:**
  - an append-only tree;
  - a node means its path.
- **References:**
  - a derived plan, never edited;
  - keyed by the planner's own `line_id`s, and its ways stored "by line, not step" (`references-step-ways.md:190-195`).

A shared type would need either the union of their rules or none of them. Share the envelope (C1–C3) and a few small vocabularies (C8, C12) instead.

### C5. Caching and version policy: reuse it as written

**What exists (VERIFIED):**
- `REFERENCES_PLAN_VERSION` and its bump rule (`cp-workspace/references/referencesPlanCache.ts:31-52`):
  - a hand-bumped number;
  - bumped only when old output would now be read wrong;
  - an app-version or source-digest key was tried and rejected (`references-persistence.md:130-147`).
- `keyDigest` (`lib/keyDigest.ts:19`) is already shared by the `cs1:` and `ps1:` fingerprints.

**Recommendation:**
- `FOLD_ENGINE_VERSION` follows that bump rule.
- Define `fh1 = keyDigest(engine version + canonical ops along the path)`. It is the D6 state-cache key, the Diagram link's staleness digest and the prefix of replay caching, all at once. References already does this: `referencesPlanCacheKeyId` is both the cache key and the Diagram's `plan` provenance (`@436:diagramDocument.ts:458`, VERIFIED).
- `fs1` is the canonical-state digest, stored in `expect` and in the link.
- If states are ever persisted (Q5), use References' disposable `artifacts.<x>` slot and its gzip/base64 codec. Today that codec is private in `referencesPlanCache.ts:317-346`; lift it then.

### C6. Where the reader's state lives

**What exists (VERIFIED):**
- `workspace.viewState` is read (`lib/nativeProjectFile.ts:1292`), never consumed, and written as `{}` by both writers (`:601, :677`). The slot is unused.
- References puts its reader state in `creasePattern.viewState.references`, which does not fit a project-level document.

**Recommendation:**
- Put Fold's reader state in the same record as the sequences (see C18), or in `workspace.viewState.fold`.
- Do not put it in the document: cursor moves would then break the "an edit that changes nothing records nothing" check that undo relies on.

---

## 3. References and Fold

### C8. A shared vocabulary for the fold line: yes, at the crate's construction level

**What exists (VERIFIED):**
- `Construction::{O1..O7}` takes **geometric** inputs only, plus `Root` (`construct.rs:59-82`). This is a neutral type and exactly what the Q3 lift moves out.
- `Witness {axiom, inputs: Ref[], root, who_moves, hard, visible, skinny, ease, err}` (`predicates.rs:96-123`):
  - its `Ref`s are ids into the planner's own `State`, which is temporary and differs per plan;
  - its scoring fields are planner-only.
- The enums: `Direction` mountain/valley/unassigned is the **finished pattern's** letter, `Side` front/back (`direction.rs:43-60`), and `Extent` full/pinches (`pinch.rs:34`).

**What Fold needs:**
- a persisted, stable reference (`FoldRef`, as sheet anchors);
- a viewer-relative valley or mountain;
- `extent`, reserved for pinches.

**Recommendation:**
- `FoldLine` is shaped like a witness: same axiom numbering, **same input order** and `root`, with the certificate target `line`. Click order is mapped to axiom slots in the input model, never in the file.
- Keep the letter as folded (relative to the viewer) separate from the pattern letter. When converting from References: on the front, the folded letter is `direction`; on the back, it is flipped (`Side::direction()`).
- Reserve `extent` now, so a References import later is a converter, not a format change.
- Reuse the kind codes from `ways::kind` (`O2:cc` …) for `fold step added`'s `axiom`/`inputs` properties, so References' and Fold's analytics can be compared. These are enum codes that have already passed privacy review (`references-step-ways.md:340-351`).

### C9. Opening a References plan as a Fold sequence: feasible later; shape the vocabulary for it now

**Feasibility (VERIFIED fields, INFERRED converter):**
- Every witness input resolves to coordinates:
  - `Point{id}` through `sequence.points[].p`;
  - `Line{id}` through the step whose `line_id` matches;
  - edges and corners from the sheet.
- So `cp`/`aux` cards map to `precrease` nodes, and side changes map to `turn` nodes.

**What blocks it in V0:**
- pinches, presses and `Extent::Pinches`. Fold V0 has no partial crease, and pinches are listed as "Later" in the plan;
- grid steps, which would need expanding into individual folds;
- the References sheet must be the whole sheet.

**Value:** high. References plans the precreases, Fold collapses them. Cost: about 1–2 days of pure TypeScript once precrease nodes and pinches exist.

**The reverse direction:**
- "Other ways" for Fold's flat-sheet precreases would need `ways::for_construction`. It is not built: `grep` finds no matches, and it is Phase 2 of the ways plan.
- "Explain a free line" could reuse References' Find mode (ReferenceFinder) on a flat sheet (INFERRED).
- Both are later work.

### C10. Sentences: reuse the naming and the mover-first ordering, not whole strings

**What exists (VERIFIED):**
- `referencesStepSentences.ts`:
  - `witnessClause` (`:418-538`);
  - `referenceName` (`:77`, "the bottom edge" …);
  - mover-first ordering through `pairOrder`/`movingInputs`;
  - the axiom keys exist in all **9** locales (`axiom7LineMoves` is present in 9 `panels.json` files).
- These helpers are coupled to `PrecreaseSequence`/`PrecreaseStep`.

**Fold needs:** "Valley fold P onto Q, through all layers." That is verb × axiom × scope.

**Honest assessment:**
- Building Fold's sentence by concatenating "Valley fold" with the References clause would break word order in ja/ko.
- Recommendation: extract `referenceName`, the letter scheme (`inputLetters`) and the mover rule behind an interface that takes `{axiom, names, moving}`. Give Fold its own full-sentence keys.
- Moderate value. The rule that the caption names the mover first, the same one the arrow moves, is the part worth sharing.

---

## 4. Diagram and Fold

### C13. One bespoke kind, or a generic "linked step source"? Two small seams instead

The three kinds compare as follows (VERIFIED, @436):

| | `cp` | `references-step` | `fold-step` (proposed) |
|---|---|---|---|
| Where it came from | an Edit CP region plus a fingerprint | an Edit CP sheet plus a fingerprint | sequence id, node id |
| What its status is computed from | segmentation | segmentation | the Fold document alone (fh1), synchronously |
| Picture | scene from `render` (CP, flat, 3D, simulated) plus `remembered` | `step-diagram` model plus `mirrored` | **the same as `cp`**: a scene from `render` |
| Can be refreshed? | yes (deterministic capture) | no (a replan is not reproducible) | yes (deterministic replay) |

- `linkStatus` branches on `source.kind === 'references-step'` (`@436:diagram/capture/linkStatus.ts:79-90, :115`).
- `'references-step'` appears in 17 non-test files, and `kind === 'cp'` gates appear in 25 files.

**Recommendation:**
1. A **`posedRenderOf(source)`** seam, already planned for Phase 7, covering `cp` and `fold-step`.
   - `fold-step` carries `render: DiagramCpRender`, with `foldCase` fixed at 1 because layer order is not a choice there, plus `remembered`.
   - It reuses `renderToShowAs` and `withRememberedPoses` and the `scene`/`paperFaces` capture.
   - "Show as Crease pattern" covers the design's "Crease pattern by step" view for free.
2. A **link descriptor keyed by kind**: `{statusOf, openSource, originLabel}`, replacing the ternaries.
3. Not a third kind that copies `cp`'s render handling, and not a new `cp` scope. Research §11's reason holds: `cp` means "a region of the Edit CP".

Proposed source:

```ts
{ kind: 'fold-step', sequence, step, moment: 'after' /* Q6 */, path: 'fh1:…', state: 'fs1:…', engine,
  render, remembered?, thumbnail, sentence? }
```

`sentence?` follows the References rule (`@436:diagramDocument.ts:464-471`): it stays the step's own while the instruction still equals it.

**Also reuse:**
- the D20 pull browser (rail, card grid, ranges, "Add N steps after step 6"), generalized to take a Fold provider;
- turn nodes pulled as `DiagramTurn` entries, as References turn-overs are (`@436:diagram/references/referencesPulledSteps.ts:113-117`);
- automatic marks from `FoldActionGeometry` lifted as annotations carrying the planned `imported: untouched|edited` tag, so Refresh swaps them under RM6 (`@436:implementation-plans/diagram-references-annotations.md:493`; planned, not built);
- count-mode Divide-line marks map onto the Diagram's existing `divisions` annotation (`parts` 2–32, VERIFIED);
- the Diagram's equal-divisions mark.

### C12. Turns: one type, and unnumbered

- `DiagramTurnKind = turn-over {axis} | rotate {amount, direction}` (`@436:diagramDocument.ts:982`, VERIFIED).
- Lift it to a neutral module and use it for Fold's `turn` op. A pulled turn then maps to a `DiagramTurn` entry with nothing to translate.
- The design numbers turn nodes. References (`foldCardNumbers`, `referencesSequenceView.ts:156`) and Diagram D22 do not. **Recommend unnumbered**, which is your call (open question 2).
- A shared numbering helper would replace the second copy of the rule (there will be a third).

---

## 5. The project file and its lifecycle

### C18. Where `foldSequences[]` goes, and the reader version

**What exists (VERIFIED):**
- `main` has `minimumReaderSchemaVersion: 1 | 8`.
- #436 adds `NATIVE_PROJECT_READER_VERSION = 9`, set only when `workspace.diagram` is present (`@436:lib/nativeProjectFile.ts:74, 610, 686, 1145`).
- Older builds then **refuse the whole file** (`project_file_too_new`).
- The #436 on-disk contract is "provisional until the branch merges" (`@436:implementation-plans/diagram-workspace.md`, Contracts).
- D1 says "Widening to `diagrams[]` later is a two-line migration."
- **The file-level `extensions` bag is carried unchanged by every release since v0.2.0:**
  - added in `af6248937`;
  - at v0.5.2: load `projectSlice.ts:1324`, both writers `:1595`/`:1693`, reader `nativeProjectFile.ts:1240`;
  - on `main`: `nativeProjectFile.ts:604, 690, 1295`.
- `superset-features.md` §2 and its anti-patterns forbid persisting a typed feature through `extensions`. The stated reason is typing and validation.

**Options:**

| | What it is | Older builds | Conflicts with #436 | Cost |
|---|---|---|---|---|
| **B** | `workspace.foldSequences` with reader **10**, after #436 merges | refuse the file | none; whichever lands second takes the next number | low |
| **A** | before #436 merges, make reader 9 mean "carries unknown project documents verbatim" (the file-level analogue of `unknownDesigns`, `nativeProjectFile.ts:1236-1244`); Fold rides it with no bump | builds at reader 9 and later carry it | changes the #436 contract while it is still provisional | low–medium |
| **D** | a typed, validated key inside the carried bag, e.g. `extensions['oristudio.fold'] = {foldSequences, view}` | **v0.2.0 and later carry it, and nothing is refused** | none | low, plus amending `superset-features.md` |

**Recommendation:**
- **D for Fold**, if you accept amending the house rule. Fold sequences are self-contained (a CP-jump is a snapshot), so a carried copy can never go stale against the CP.
- Otherwise **B**. Do not take reader 9 for Fold while #436 holds it.
- D can also be offered to the Diagram before #436 merges. The Diagram's Decision 3 was made without D on the table.

**In every option:**
- Persist an **array**, with one `formatVersion` per sequence.
- Leave the key out when it is empty, so other files stay byte-identical (the #436 precedent).
- Generalize the Diagram's "diagram-only project", Oriedita-save and landing branches (C3).

### C19. What "Import CP" (a CP jump) means for the file

- **A snapshot, not a link.** The sequence must replay without the Edit document.
  - Provenance is optional and could reuse `RegionReference` plus `foldedSourceFingerprint` for a "pattern changed in Edit" notice.
  - The source name stays in the file, never in analytics.
- **Embed the CP as one compact string** (`cpJson`, a FOLD subset in sheet coordinates).
  - The `.osf` is pretty-printed (`nativeProjectFile.ts:473`, VERIFIED).
  - **Measured (ran):** nested arrays cost 3.0–3.7× a compact string field. Kabuto: 2,686 B against 722 B. Iguana-c0: 134 KB against 39 KB.
  - This follows the Diagram's `sceneJson` precedent.
- **Store the chosen layer order as data** (`orderJson`), with faces named by an interior sheet point (1.4), not "case n of m".
  - Worst case, all pairs at 350 faces, is about 794 KB (computed). Real states are much sparser.
  - Measure on real imports before choosing between pairs and subface stacks.
- **Parse through the existing importers**: `parseImportedCreasePattern` (`lib/creasePatternImport.ts:103`) for `.cp`/`.fold`. Edit's folded figure supplies the order from the kernel scene.
- Precondition (design, VERIFIED): the imported sheet shape must equal the sequence's.

### C16 and C17. Send to Edit, and the paper

- **Send to Edit (VERIFIED).** Produce a `SendToEditPayload` (`designKinds/types.ts:143-176`) and call `importAddOristudioCpText`, the path used by 4 existing callers. That reuses its undo label and merge, and the `unassignedAsAuxiliary` flag is already there if precreases go out as aux.
- **Paper.**
  - The document holds the geometry (`shape`, `startSide`) only.
  - Colours come from the app's `PaperStyle` (`paper.front/back`, `lib/paper/paperStyle.ts`), with optional `PaperStyleOverrides` per sequence, as folded figures already have (`nativeProjectFile.ts:750, 835, 986`).
  - The design's own hex swatches should not be persisted. That is what keeps the paper "painted the same way everywhere".
  - Once a step is pulled into the Diagram, the Diagram's own style applies (D9).

---

## Recommendations, ranked

1. **Adopt the §1.2 model:**
   - a flat, parent-linked node tree per sequence in an array;
   - inputs and seeds as sheet anchors in the crate's axiom order;
   - resolved choices stored as results, not indices;
   - reader state outside the document and outside undo;
   - append-only commits, so a different fold makes a branch.
2. **Decide where the sequences live (C18) before #436 merges.** Recommendation: D (a typed key in the carried `extensions` bag, no refusal by v0.2.0 and later); otherwise B (reader 10). In every case, generalize `keepsOriedita`, the save routing and landing so Fold cannot be dropped on Cmd+S.
3. **Extract the lenient envelope kit (C1)** on `main` now, with Fold as its first user and the Diagram migrated after #436.
4. **Reuse `snapshotHistory` as it is (§1.5).** Write Fold's slice against a generic commit/travel/scoped-keys kit (C2). Do the projectSlice registry (C3) after #436, as behaviour-preserving PRs.
5. **One digest per path (C5):** `fh1` serves as the cache key, the Diagram link digest and drift detection, with `fs1` per node through `keyDigest` and a hand-bumped `FOLD_ENGINE_VERSION` under References' rule.
6. **Make the line vocabulary the lifted `Construction` plus the witness input order (C8)**, reserve `extent`, and reuse the `ways::kind` codes in analytics.
7. **Diagram link (C13):**
   - `fold-step` shares `cp`'s `render`, `remembered` and scene capture through `posedRenderOf`;
   - a link descriptor by kind;
   - a generalized pull browser;
   - RM6-tagged automatic marks;
   - turns as `DiagramTurn`.
8. **Use one turn type and leave turns unnumbered (C12).**
9. **Send to Edit through `SendToEditPayload`; paper geometry in the document, colours from `PaperStyle` (C16, C17).**
10. **CP jump (C19):** a compact `cpJson`, the order stored as data, a snapshot not a link.
11. **Later:** the References-to-Fold importer (C9), shared sentence naming (C10), "explain a free line" through ReferenceFinder.
12. **Not recommended:** a generic step-sequence model (C4), or a `fold-step` that copies `cp`'s render handling.

## Open questions

1. **File placement (C18):** may Fold use a typed key in the `extensions` bag, which means amending `superset-features.md`? If not, reader 10 after #436. And should the Diagram be offered the same option while its contract is still provisional?
2. **Turn over and Rotate in Fold's strip:** numbered, as the design has them, or unnumbered like References and Diagram D22?
3. **Changing the paper shape on a sequence that has steps:** replace it (one undo entry, asking first), or append a new sequence to the array? Appending would create a sequence nobody can see while the UI shows only one.
4. **CP jump semantics:** do the parent state's creases that are missing from the imported CP survive as F creases, or does the jump replace them? And must the imported CP contain them?
5. **Should `diagram` also become an array now,** to match `foldSequences[]`, while #436's contract is still provisional?
6. **When importing a References plan later:** which "as folded" letter does an unassigned `aux` precrease get? The planner says it is creased "on whichever side the sheet happens to be on".
7. **Sequencing:** are the Diagram-side extractions (C2, C3, C13) acceptable as follow-up PRs once #436 merges? If Fold's Phase 3 starts first, Fold builds against the generic shapes and leaves the Diagram's code untouched.
