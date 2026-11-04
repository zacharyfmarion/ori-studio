# Layer order constraints: product spec

Revised 2026-10-20 after the design phase. Research came first (2026-10-19).
Then three design rounds on the
[Layer order dialog canvas](https://claude.ai/artifact/48ECv5vgTcaKZTCHwxwFbu),
and the owner approved round 3. The engineering plan is
[implementation-plans/layer-order-dialog.md](../../implementation-plans/layer-order-dialog.md).

The evidence behind every claim is in these reports in this folder:

- [apps-survey.md](apps-survey.md): how other origami software lets people see,
  choose and constrain layer orders.
- [theory.md](theory.md): the formal model, what is computable, and how each
  user intent becomes a solver constraint.
- [engines.md](engines.md): our three layer-order solvers, where constraints
  could enter each, and measurements on real fixtures.
- [surfaces.md](surfaces.md): where people meet layer order in the app today,
  what is saved, and ten weeks of usage data.
- [fold-solver-profile.md](fold-solver-profile.md): how fast the Fold branch's
  solver runs the dialog's operations, and what would make it faster.

---

## 1. Summary

A crease pattern with its mountains and valleys fixed usually folds flat in
more than one way: the same outline, with the layers stacked differently.
Today Ori Studio shows the first stacking its solver finds and lets you page
forward, with "Another solution" in Edit and "Layer order n of m+" in the
Diagram. That works for two or three orders and breaks down at hundreds:

- the total is never known;
- most pages look identical;
- the page you settle on is saved as a number, which points at a different
  order after the next edit.

This spec proposes a **Layer order dialog**, shared by Edit, Diagram steps and
Pose. It shows the crease pattern on the left and the folded figure on the
right. You state what the figure should look like as short sentences, built by
clicking faces on either pane: "C in front of D", "C behind E". The dialog:

- offers only faces that still have a choice, and only the objects a subject
  can actually be ordered against;
- previews each sentence before you add it, and says plainly when it can't
  fit;
- says how many solutions (distinct pictures) still fit, once it has had time
  to count;
- saves your constraints and the order you chose, never a number, so both
  survive refolds and edits.

No shipped origami tool lets you click faces to set the layer order.
Oriedita's maintainers specified the core of it in 2021 (issue #187: pick a
point, see the faces stacked there, click them in order), shipped only a
colour-at-a-point subset, and left the issue open.

---

## 2. The problem

### 2.1 How layer order works today

| Where | What you can do | What is saved |
| --- | --- | --- |
| Edit, flat folded figure | "Another solution" on the figure's toolbar and context menu. Forward only; wraps to the first at the end. No count, no previous, no jump to a number. Properties shows "Case N". | The case number and a picture. A refold goes back to case 1. A reopened figure cannot step until it is refolded, because it has no live fold. |
| Edit, 3D folded figure | "Another solution", over a different, incomplete search | The case number, replayed on load (up to 32 steps) and kept only if it still matches |
| Diagram step and Pose | "Layer order n of m+" with previous and next, flat steps only. 3D steps always show the first order. | `foldCase`, a number. Refresh after a crease edit replays the same number into the new fold. |
| Crease-pattern export | A "Fold case" number with "n found so far" | Nothing |
| Fold workspace (PR #475) | An order chooser on the canvas (‹ Order n of m ›); a "Layer order n of m" stepper on compound folds | The result: faces named by points on the sheet, plus face-pair orders. Never an index. |

Nothing in the app lets you point at a face, on the crease pattern or on a
folded figure, and say anything about its layer.

### 2.2 Why that fails

1. **There are often too many orders to page through.**
   - Ten weeks of analytics: 42 people pressed "Another solution" 1,399 times;
     131 people made a flat figure in that time. The median person pressed it
     about 5 times. Five went past solution 20, one past 100, and one pressed
     it 720 times. Ten paged to the end and wrapped around.
   - Flat-Folder's published table of 366 real designs: the median design has
     about 260 flat layer orders, and one in five has more than a million.
     Kamiya's Ryujin 2.1 has more than 9·10⁸⁴.
2. **Most pages look the same.** An opaque flat figure shows only the top layer
   at each spot, so orders that differ underneath draw identical pictures. A
   note in our code records 8 solutions of a penguin that draw 8 identical
   pictures in the opaque styles. Measured on fixtures:

   | Fixture | Layer orders | Different pictures from the front | From the back |
   | --- | --- | --- | --- |
   | `solution_sample_1.cp` | 16 | 1 | 16 |
   | `kabuto.fold` | 9 | 9 | 1 |
   | Oriedita's `colorconstrainttest.cp` | 22 | 12 | 2 |
   | iguana fragment (`iguana-split-crease.fold`) | 12 | 2 | 2 (3 counting both sides) |
   | `squash-local.fold` | 3 | 1 | 1 |
   | `treemaker-triad-base.fold` | 2 | 1 | 1 |

3. **You can't aim.** Edit's solver (the Oriedita port) enumerates lazily,
   forward only, with no total. To get "the arm in front", you page and look.
4. **A saved number is not a saved choice.** A layer order is saved as its
   position in the solver's enumeration. A crease edit, an added constraint or
   a change to the solver can renumber the orders. The Diagram's Refresh then
   shows whichever order now has that number.
5. **A naive "bring to front" would mostly fail.** For every spot and every
   face on two fixtures, putting that face on top contradicts a relation the
   creases already force 79% of the time (kabuto) and 88% of the time (the
   iguana fragment). A tool has to rule out what the creases already force
   before it offers a choice.

### 2.3 What people actually know

People know local facts about the model in their hands: which flap is in
front, which colour shows at a spot, what is tucked inside what. Those facts
are exactly what the solvers take as input (§4.2), and no tool lets anyone
state them.

---

## 3. Goals and non-goals

**Goals**

- **G1. Steer by intent.** Get the order you want by stating facts about
  faces, clicking on the crease pattern or on the folded figure.
- **G2. Rule out what is already decided; check the rest.** Choices that the
  creases and your constraints already force are unavailable at once, with
  the reason, without enumerating any orders. Any other choice is checked when
  you make it: the dialog searches for one order that fits, and if none exists
  it says so and names the conflict. (Decided 2026-10-19.)
- **G3. Show what is left.** Where the figure is still undecided, and, once a
  background count has run, how many orders still fit and how many different
  pictures that is. Counting never blocks input. A conflict names the
  constraints that clash.
- **G4. Don't count what you can't see.** Orders that differ only in hidden
  layers count as one solution, for the way the figure is drawn.
- **G5. One dialog everywhere.** Edit (a folded figure, or a crease pattern
  before folding), Diagram steps and Pose; later the Fold workspace.
- **G6. Save intent and result, never a position.** The choice survives
  reopening, refolding and crease edits wherever its faces still exist, and
  says so plainly when they don't.

**Non-goals for the first version**

- Changing mountain/valley assignment, or repairing patterns that don't fold
  flat. The 681 flat "contradiction" verdicts in analytics are a separate
  problem.
- 3D folded figures and Diagram 3D steps (§7.6).
- Drawing orders that cannot fold. There is no free-form manual override.
- Ranking orders automatically ("show as much colour as possible", "fewest
  visible creases"). These are later work (§11).
- Changing Edit's default first solution when a figure has no constraints.

---

## 4. What exists elsewhere, and what is possible

### 4.1 Other tools

| What you can do | Who has it | Limits |
| --- | --- | --- |
| Page through orders | Oriedita (next only, "found so far"); ORIPA (previous/next, `i/n`) | Useless at scale |
| Pick a state per independent part | Flat-Folder (type 1…n per component); Rabbit Ear (API only) | Bare numbers, no preview. Large models collapse into one giant part. |
| Filter by the stack at one spot | ORIPA (pick a spot by number, then one of its stack orders by number) | The most expressive shipped tool, and entirely numeric |
| Set the colour that shows at a point | Oriedita, "Add Color Constraints" | Driven by clicks, but needs a re-fold. No feedback when impossible. Not saved, not undoable, and lost on any crease edit. |
| Click faces in order at a point | Oriedita issue #187, a maintainer's design from 2021 | Never built; this feature |
| "A above B" | Native input of every solver, the same mechanism as an M/V crease. FOLD `faceOrders`. Rabbit Ear accepts it as seed orders. | No UI anywhere |
| See which faces overlap, and a spot's stack | Flat-Folder: click a crease-pattern face to light its overlapping faces; click a cell to log its stack as text | No graphical stack view anywhere |
| Visible regions painted on the crease pattern | Flat-Folder's "Visible" | Oriedita issue #134 asks for it |
| Conflict shown on faces | Flat-Folder (red), ORIPA (pink) | Nothing explains a conflict among user constraints |

Outside origami:

- **CAD sketchers** are the closest model for feedback. They report under-,
  fully or over-constrained, give a degrees-of-freedom count, and offer a
  clickable list of conflicting constraints.
- **Figma's "Select layer" menu**, which lists every layer under the cursor,
  is the closest model for a stack at a point.
- **One difference matters.** In origami most reorders at a point are
  impossible, and one change forces others elsewhere. A z-order verb has to
  become a constraint plus a re-solve, never a direct edit.

### 4.2 What is possible

- **One model underneath.** Every pair of overlapping faces gets one
  above/below relation. Creases constrain those relations, and the stack at
  each spot must be a consistent total order. FOLD `faceOrders`, Flat-Folder
  and Oriedita are three encodings of the same thing. An M/V crease is one of
  these relations, fixed by the pattern.
- **Most intents are exact sets of fixed relations**, which makes them cheap
  to apply and easy to explain:

  | Intent | As a constraint |
  | --- | --- |
  | A is above B | One relation |
  | X is on top here | X above every other face at that spot |
  | The stack here, in this order | One relation per neighbouring pair |
  | This flap in front of that flap | Every overlapping pair, flap P above flap Q |
  | Tucked inside a pocket | Above one wall, below the other |
  | Keep everything outside this region | The current relations, pinned |
  | This colour shows here | An "or": the top face is one of those showing that side. Exact, but needs solver support. This is Oriedita's shipped constraint. |
  | Least white showing; fewest visible creases; closest to before | Rankings, not constraints |
  | Side facing the viewer; fixed face; M/V; pose | Not layer-order questions |

- **Hard in theory, small in practice.**
  - Finding a layer order is NP-hard in the worst case, and constraints do not
    change that.
  - On real designs the free choices split into independent parts. In 58% of
    the 366 designs the largest part has 10 or fewer orders, and in 80% it has
    100 or fewer.
  - Constraints that pin relations only shrink or split those parts, so they
    make solving cheaper.
- **Large models are the exception.**
  - One of our fixtures, an 850-face iguana, is a single free part with at
    least 5,000 orders.
  - Ryujin's largest part has 633,184.
  - On models like these, choosing "a state per part" means nothing; only
    constraints narrow the space.
- **Feedback is honest only on a complete solver.**
  - Edit's search, the Oriedita port, is incomplete. In the Fold branch's
    random-state experiment it missed about a fifth of the valid orders it was
    checked against, and sometimes reported "no solution" when one existed. "No order fits your constraints" from it is not a proof,
    and conflict explanations built on it are meaningless.
  - Flat-Folder-style search is complete over its constraints. The unmerged
    Fold branch already exposes one (§9).
- **What you see depends only on the top face of each spot**, for an opaque
  flat drawing, from the side shown. Pictures can therefore be counted part by
  part. Spread layers and X-ray expose hidden layers, so more orders count as
  different there.

---

## 5. Concepts

These are the words the dialog uses. The design phase settled them.

- **Face**: a piece of paper between creases. It is one region on the crease
  pattern and one polygon on the folded figure.
- **Spot**: a region of the folded figure where the same set of faces overlaps
  (a "cell" or "subface" in the solvers). Its **stack** is those faces, from
  front to back as seen from the side shown.
- **Layer order**: a stack for every spot, consistent across spots and with
  every crease.
- **Solution**: what the user can tell apart. For an opaque flat figure, it is
  the face in front at every spot, from the side shown. Several layer orders
  that differ only in hidden layers are one solution.
- **Constraint**: a sentence with a subject, a verb and an object, such as "C
  in front of D": wherever C and D overlap, C is nearer the viewer. It is
  stored relative to the paper, so flipping the view never changes it; seen
  from the back, it reads "C behind D".
- **Decided**: the order of a pair follows from the creases, the user's
  constraints, and what those imply within shared spots. It can't change
  without removing a constraint.
- **Open faces** of a face C: the faces that overlap C and whose order with C
  is not yet decided. They are the only valid objects for C.
- **Fits**: the layer orders that satisfy every constraint.

---

## 6. The dialog

The design is on the canvas
([Layer order dialog](https://claude.ai/artifact/48ECv5vgTcaKZTCHwxwFbu)).
Round 3, "A3 · Constraint builder", is the approved one. It runs live on real
engine output for Kabuto and for a real design from the cpoogle corpus.

### 6.1 Opening

A host opens the dialog (§7) and hands it:

- the crease pattern for the fold (the figure's source region, the step's
  linked region, or the selection);
- the fold settings: starting face and side;
- the constraints already saved;
- the order currently shown.

The dialog reuses the host's fold when the host has a live one, and folds
otherwise. It analyses the layer orders before anything becomes interactive.
While it works it says so, and the work can be cancelled.

### 6.2 Layout

- **Header.** "Layer order", the figure's name, and a close button.
- **Panes.**
  - The crease pattern is on the left and the folded figure on the right.
  - Each pane has a zoom toolbar at the bottom. Each pans and zooms on its
    own, and Fit frames both.
  - The folded figure is drawn the way its host draws it, using the paper
    style.
- **Switches.** Front/Back side, X-ray, and Open spots. Open spots tints the
  spots whose front face isn't decided yet; it is off by default.
- **Nothing floats on the panes.** No readouts or titles sit over them.
- **Inspector column** (304 px), top to bottom:
  1. **Status:** "N solutions", with a ‹ n of N › stepper (§6.6).
  2. **Add a constraint:** the builder (§6.4).
  3. **Constraints:** the list (§6.5), directly under the builder.
- **Footer.** Cancel and Apply.

### 6.3 Picking faces

- **On the crease pattern**, a click picks that face. This is the only way to
  reach a face that is hidden on the folded figure.
- **On the folded figure**, a click picks the face in front at that point.
- **Hover.** A face under the pointer lights on both panes, including the
  parts hidden under other layers. This only happens if the face can be picked
  in the current step.

### 6.4 The constraint builder

A constraint is built as a sentence, like a query filter:
`[subject] [in front of ▾] [object]`, followed by Add constraint.

1. **Subject.**
   - Only faces that still have at least one open face can be picked.
   - While the subject slot is empty, those faces are faintly tinted on the
     crease pattern, where faces never overlap. Every other face is inert.
   - Hovering any face updates the hint line under the sentence: "C · 3 faces
     to choose from", or "C · nothing left to choose: everything it overlaps
     is settled".
   - With nothing hovered, the hint reads "Pick a face · N faces have
     choices".
2. **Verb.** A dropdown with "in front of" (the default) and "behind". The
   verbs come from one list, so later verbs (§6.10) add entries, not UI.
3. **Object.**
   - Once the subject is set, its open faces get letter labels on both panes
     and a faint tint. A face that is hidden on the folded figure gets a
     smaller, quieter label there.
   - Every other face is inert. Clicking one does nothing and shows no
     message.
   - The hint reads "Pick one of the N labelled faces".
4. **Preview.**
   - With the sentence complete, the folded pane shows the fitting order
     closest to the one on screen, and marks the spots that would change.
   - If no order fits, Add constraint is disabled. The hint line gives the
     reason in the danger tone, naming the smallest clashing set, e.g. "Can't
     fit: with the creases, C in front of F clashes with C behind E".
5. **Add constraint.**
   - It applies the sentence, moves to the closest fitting order, and briefly
     flashes the spots that changed.
   - It then **clears the sentence**: the subject, the object and their labels
     go, the verb returns to "in front of", and the subject slot is active
     again.
6. **Editing the sentence.**
   - Each slot has a small × that clears it.
   - Clicking a filled slot makes it active again, so the next pick replaces
     its face.
   - Clear empties the sentence.

Which faces are "open" comes from deduction, not from a search. So an offered
object can occasionally have no fitting order. The preview catches that before
Add, and Add stays disabled. It happened on about a tenth of the offered
choices in the prototype, which used simpler deduction than the engine does.

### 6.5 The constraints list

- **Rows** read the way the sentence was built, as `[C] in front of [D]` or
  `[C] behind [E]`, from the side shown.
- **Hovering a row** lights both faces and shows their letter labels on both
  panes.
- **Clicking a row** puts its subject into the builder.
- **Removing.** A trash button removes a row. The header holds Undo, Redo and
  Clear all, which work on the dialog's own history.
- **Constraints that stop fitting.** Saved constraints can stop fitting after
  a crease edit (§8.2). The clashing rows are marked, and Apply waits until
  one is removed. Nothing is ever dropped silently.

### 6.6 Solutions

- **Status.** "N solutions" counts the distinct pictures that fit, from the
  side shown.
  - A tooltip gives the layer-order count when it is larger, e.g. "24 layer
    orders fit; 12 differ only in hidden layers".
  - The count comes from a background job that never blocks input. On large
    figures it reads "at least N", or doesn't appear.
- **Stepper.** ‹ n of N › steps through the solutions. It adds no
  constraints, and the order on screen at Apply is the one kept.
- **Hidden-layer variants.** Layer orders that differ only in hidden layers
  have no step of their own. Whether X-ray should step through every layer
  order is decision 7.

### 6.7 What the dialog says

Text appears only when something blocks the user:
- why Add can't apply;
- that a subject has nothing left to choose;
- that a check couldn't finish in time, offering to keep trying. A timeout is
  never reported as "impossible".

There are no routine status notes. The preview and the flash of changed spots
show what happened.

### 6.8 Apply and Cancel

- **Apply** hands the host the constraints and the order on screen. The host
  commits them as one undo step.
- **Cancel** leaves the host untouched.

### 6.9 Size and speed

- **What interaction needs.**
  - Opening needs one deduction pass, which drawing any order needs anyway.
  - The preview of a complete sentence needs one search for one order.
  - Counting solutions runs in the background.
- **Targets**, to be confirmed in Phase 0:
  - the dialog interactive within about a second on typical figures of a few
    hundred faces;
  - each preview within about 200 ms;
  - every analysis cancellable.
- **Evidence:**
  - Flat-Folder solved the median of its 366 designs in 3 ms on its authors'
    machine; the 90th percentile took 3.7 s.
  - The Fold branch's solver as first profiled
    ([fold-solver-profile.md](fold-solver-profile.md)): the 850-face,
    250-layer iguana took 13 s to open and 13 s or more per check.
  - With PR #476 (a faster search and the check session the dialog uses),
    measured natively on 471 real designs from the cpoogle corpus:
    - opening takes 11 ms at the median and 0.74 s at p95;
    - a check takes 0.08 ms at the median and 5.7 ms at p95;
    - the iguana opens in 1.08 s (1.53 s in wasm), a check that fits takes
      0.45 s (0.66 s in wasm), and proving "no order" takes 0.7 s;
    - the slowest admitted design takes 5.6 s to open in wasm.
- **Large figures.**
  - The subject and object offers still work, because they come from
    deduction.
  - A preview whose search runs long says so (§6.7).
  - Counts read "at least", or don't appear.

### 6.10 Later verbs

Between two faces there are only two relations, and "C behind D" is the same
fact as "D in front of C". Further verbs need a different kind of object, and
they slot into the same builder:

| Sentence | Object | Meaning |
| --- | --- | --- |
| C **in front of** D / C **behind** D | a face | v1 |
| C **in front of everything** | none | C covers every face it overlaps, so it is fully visible |
| C **in front at** [a spot] | a place on the figure | C in front of every face stacked there |
| C **between** D **and** E | two faces | tucked into a pocket |
| [a spot] **shows** colour / white | the spot is the subject | Oriedita's colour constraint |
| [flap] **in front of** [flap] | groups of faces | the same verbs, with flaps as subject and object |

### 6.11 Keyboard, touch, phones

- **Keyboard.** Keys go through the app's shortcut registry, with no
  `keydown` listener on the dialog. The verb menu and the lists are keyboard
  operable.
- **Touch.** Every interaction works by tap, at coarse-pointer sizes.
- **Narrow screens.** The dialog goes full screen below 720 px, and the panes
  switch, as the app's other modals do.
- **Visual language.**
  - Every string is translated.
  - Type sizes, weights and button heights are the app's own.
  - Every state colour is a theme token.
  - Delete is the app's trash icon.
  - No dashed line marks a state, because dashes mean valley folds.

---

## 7. Where it opens

### 7.1 Edit: a flat folded figure

- "Layer order…" sits on the figure's toolbar and context menu, beside
  "Another solution". It is one entry in the figure's action catalog.
- After Apply, the figure shows the chosen order. Properties summarises it,
  for example "3 constraints · decided" or "1 of 4 that fit".
- "Another solution" keeps working, through the orders that fit the
  constraints (decision 4).
- A reopened figure has no live fold today, so the dialog refolds it first.

### 7.2 Edit: a crease pattern before folding

- "Fold with layer order…" sits next to Fold and acts on the selection, or on
  the whole sheet.
- Apply creates the folded figure with its constraints.

### 7.3 Diagram: a step

- The Step pane's "Layer order" row gains a way to open the dialog on the
  step's linked region.
- Apply re-captures the step as one "Adjust pose" undo step.

### 7.4 Pose

- "Layer order…" sits beside Pose's layer-order pager.
- The dialog uses the fold Pose already holds.
- Pose's own keys stand down while the dialog is open.

### 7.5 The Fold workspace, once merged

- Its order chooser on the canvas (‹ Order n of m ›, which replaced the Import
  dialog's order cards) and its compound-fold "Layer order n of m" stepper are
  the same problem, and should open the same dialog (decision 6).
- This spec adopts its representation: faces named by points on the sheet,
  plus pair orders.

### 7.6 3D figures and 3D Diagram steps: later

In 3D, layer order exists only between coplanar faces. A constraint that holds
when flat can fail once the paper opens slightly, so constraints have to be
re-checked for every pose. Our 3D search is also the least complete. The entry
point shows disabled, with the reason.

---

## 8. Saving

### 8.1 What is saved

- **The constraints.** Each names its faces by a point on the paper, in
  crease-pattern coordinates inside the face. Relations are stored relative to the
  paper, in FOLD's `faceOrders` convention, so flipping the view never
  changes them.
- **The order on screen at Apply.** Faces by paper points, plus their pairwise
  orders. This is the Fold workspace's format, whose rule is "choices are
  results, never indices".
- **Never a case number.**

### 8.2 After refold, reopen or a crease edit

1. Each constraint's faces are found again by their paper points. Each one
   comes out intact, ambiguous (a face was split) or gone.
2. The figure is solved with the constraints that still resolve.
3. The fitting order closest to the saved one is shown.
4. If anything broke, the figure or step says so, e.g. "2 layer constraints
   need attention", and the dialog opens on them. A re-solve that finds
   nothing keeps the old picture, as refolds already do.

### 8.3 Old files

Existing `current_fold_case` and `foldCase` keep working as they do today.
The first Apply writes the new fields.

### 8.4 File-format risks

- **Edit figures.** The reader keeps only fields it names, so an older build
  silently drops the constraints and saves the file without them.
- **Diagram steps.** An unknown field locks the step in an older build, by
  design.
- **Reader version 10** is claimed by both main and the Fold branch. Whichever
  lands second must renumber.

---

## 9. What the engine has to do

### 9.1 Capabilities

1. **Decided relations** from one deduction pass, updated as constraints are
   added. They give, instantly, the faces that still have a choice and the
   open faces of a subject, and they draw the open spots.
2. A **search for one order** under the constraints that is complete over
   them, so its "no order" is a proof. In v1 it takes pair relations; later
   verbs (§6.10) add other forms.
3. **Background counts**, exact or at least: layer orders, and solutions
   (distinct pictures) per side.
4. **The fitting order closest to a given order.**
5. **The smallest set of constraints that conflict.** This is sound only over
   a complete solver.
6. **A budget and cancellation** for every query.
7. **A face bridge**: paper points mapped to and from the faces of each engine
   (Edit's Oriedita faces, the Fold engine's faces).
8. **Display of a given order** in Edit's and the Diagram's renderers.

### 9.2 Where it runs

These options come from [engines.md](engines.md) §6.

- **A. Inside the Oriedita port.** This wires upstream's colour constraint and
  adds pair seeds to Edit's existing search. It is the easiest route for
  display, but has no count, no parts, weak conflicts and an incomplete search.
  It cannot meet 9.1's items 2, 3 or 5 honestly.
- **B. The Fold branch's stack everywhere.** It already covers most of items
  1–3 and 6 (`complete_layer_order`, `oristudio-layer-order`,
  `oristudio-fold::complete`): pair constraints in; forced pairs, orders,
  counts and budgets out. Its conflicts name the faces involved, and it saves
  results by sheet points. Because it is complete, item 5 can be built on it
  soundly; Colour here's "or" constraint is not there yet. Edit's and the
  Diagram's displays would move off Oriedita, which breaks parity for
  "Another solution".
- **C. One shared representation, two searches (recommended).**
  - The dialog's analysis (items 1–6) runs on the Fold branch's complete
    solver, extended where it falls short.
  - Edit and the Diagram keep Oriedita for their default order, so parity is
    untouched.
  - A chosen order is displayed through a new, additive "show this order"
    entry in the Oriedita port. Both solvers describe an order the same way,
    one above/below per overlapping pair, so Oriedita is seeded with every pair
    of the chosen order and its search lands on exactly that order. The Fold
    branch measured this on 1,685 of 1,685 states, with faces matched by their
    centres and Oriedita's sign convention calibrated: its "upper" face is the
    one toward the viewer of the starting face's front.
  - The risks are in §13: sheet shapes the Fold import refuses, tolerances
    on real files, and the seeded entry's fidelity.

### 9.3 Porting discipline

- **No constraints, no change.** With no constraints, Edit's and the Diagram's
  results stay byte-identical to today. The Oriedita folding oracle and the
  render oracle gate this.
- **Our own code.** Pair constraints, counts, solutions and conflict explanations
  are additions. They live in our own crate, behind additive entry points, with
  PORTING.md entries.
- **Oriedita's colour constraint.** Porting its "Add Color Constraints" tool
  into Edit is separate parity work (PORTING.md, "Not ported"). The dialog's
  Colour here uses the same meaning, so the two agree when both exist.

---

## 10. Analytics and success measures

**Events.** These use the central analytics layer, with enums and buckets only.

- `layer order dialog opened`: `surface` (edit_figure, edit_pattern,
  diagram_step, pose), `face_count_bucket`, `solutions_bucket`.
- `layer constraint added`: `verb` (in_front_of, behind), `subject_origin`
  and `object_origin` (pattern, folded).
- `layer constraint blocked`: `constraint_count_bucket`. Fired when a complete
  sentence can't fit and Add is disabled.
- `layer order dialog closed`: `outcome` (applied or cancelled),
  `constraint_count_bucket`, `solutions_bucket`, `elapsed_ms_bucket`.
- `layer constraints need attention`: `surface`, `broken_count_bucket`. Fired
  after a refold or edit.

**What success looks like**

- People who page now use the dialog instead. "Another solution" presses per
  figure drop, and the tail past 20 shrinks.
- Most dialog sessions end in Apply, quickly.
- Saved constraints rarely need attention after edits.
- Diagram steps carry constraints rather than case numbers.

---

## 11. Phases

The engineering plan
([implementation-plans/layer-order-dialog.md](../../implementation-plans/layer-order-dialog.md))
breaks these into PRs.

| Phase | Scope | Done when |
| --- | --- | --- |
| **0. Foundations** | On a branch off PR #476 (decision 2); solver speed and the check session are already done there. The import of Edit's and the Diagram's folds, following Edit's rules for unassigned and F lines, for any sheet shape. The paper-point face bridge. Queries: open faces of a subject, a one-order check with the closest order, the smallest clashing set, and a background count of solutions. The Oriedita "show this order" entry. The saved format. | Measured on our fixtures and the cpoogle corpus: every chosen order displays through Oriedita; previews and opening meet §6.9. |
| **1. Edit** | The dialog as designed (§6): panes, the builder, the constraints list, solutions, Apply and Cancel. Entry from a flat figure and from a crease-pattern selection. Save, reload and refold. "Another solution" within constraints. Analytics. | Browser-verified on Kabuto, a cpoogle design and the 850-face iguana |
| **2. Diagram and Pose** | Both entry points. Step storage and legacy `foldCase`. Refresh re-solves. | Diagram files round-trip, with older builds locking as designed |
| **3. More verbs** | From §6.10, most likely "in front of everything" first | |
| **Later** | Fold workspace adoption, 3D, flaps as subjects and objects, ranking ("show as much colour as possible"), carrying constraints between Diagram steps | |

---

## 12. Decisions

**Decided:**

- **Choices are checked, not computed in advance** (G2, 2026-10-19). In your
  words: "use your recs for that".
- **Sequencing** (decision 2, 2026-10-19). In your words: "get the fold
  workspace on latest main and fix the reader version to 11. Then we will
  likely branch off of it so that we can use its machinery." Concretely
  (2026-10-20), the base is PR #476 (`claude/fold-solver-perf`, the faster
  solver and the check session), stacked on the Fold workspace launch, #475.
- **The design** (2026-10-20), as §5–§6 describe:
  - **Direction A, the inspector column:** "I like A better, lets do it."
  - **Faces and options.** Constraints are made by picking faces, and you are
    only shown options that are actually possible. No stack list ("Layers
    here"), no above/below/either groups, no dots, no floating readouts on
    the panes.
  - **A subject–verb–object builder.** "C in front of D", with "in front of"
    as the default and "behind" as the other verb, then Add constraint.
  - **Inspector order:** status at the top, then the builder, with the
    constraints list directly under it.
  - **Wording:** "Solutions", not "looks". "In front of / behind", not
    "above/below".
  - **Copy and icons:** only blocking messages, the app's type scale, and the
    trash icon for delete.
  - **Add constraint clears the sentence.**

**Still yours to decide**, each with a recommendation:

1. **Engine route (§9.2).** Recommended: **C**. The dialog analyses with the
   Fold solver's session; Edit and the Diagram keep Oriedita's default and
   display a chosen order through a seeded entry. A trades honesty for speed
   of delivery; B trades Oriedita parity. The engineering plan assumes C.
3. **First-version scope.** Recommended:
   - flat figures only;
   - the two verbs "in front of" and "behind";
   - later verbs (§6.10) follow, then 3D.
4. **The existing pagers once a figure has constraints.** Recommended:
   - "Another solution" and the Diagram's pager step through the orders that
     fit the constraints.
   - With no constraints they behave exactly as today, which is Oriedita
     parity.
   - With constraints, the fits come from the Fold solver and are drawn
     through the seeded entry. Oriedita's own enumeration can miss orders the
     dialog counted: it missed the real order in 28 of 1,685 states in the
     Fold branch's experiment.
5. **Diagram constraints across steps.** Recommended: constraints belong to one
   step, and the dialog offers "copy from the previous step".
6. **The Fold workspace.** Recommended: once both exist, its order chooser
   opens this dialog.
7. **Hidden-layer variants.** Solutions count distinct pictures, so layer
   orders that differ only in hidden layers can't be stepped to. Recommended:
   while X-ray is on, the stepper steps through every layer order, because
   hidden layers are then visible. The alternative is that "solution" always
   means every layer order, the same as Edit's "Another solution".

**Calls I've made** (say if you disagree):

- Save the constraints and the chosen order; never a case number.
- Name faces by paper points.
- Store relations paper-relative.
- Never drop a constraint silently.
- A sentence that can't fit can't be added; Apply waits on a conflict among
  saved constraints.
- The preview changes as little as possible.
- The dialog draws the figure the way its host does, with X-ray available.
- There is no manual override for impossible orders.
- List rows read the way they were built ("C behind E"), not normalised.

---

## 13. Risks and unknowns

- **Showing a chosen order in Edit.**
  - It relies on seeding Oriedita with the whole order. That reproduced 1,685
    of 1,685 orders in the Fold branch's experiment, on Fold's own generated
    states.
  - The seeded path there was assembled from public pieces and skipped one of
    the shipped fold's deduction steps; the real entry must include it.
  - Oriedita merges faces across F lines, so it can't draw an order that
    differs across one. Fold's import already treats Edit's F lines the same
    way, so orders chosen for Edit figures shouldn't hit this.
- **Edit figures the Fold import can't take yet.** It accepts square and
  rectangular sheets only, so a figure folded from another paper shape, or
  from an odd-shaped selection, is refused until the import handles polygons.
  It also folds unassigned lines, which Edit doesn't; an import for Edit must
  follow Edit's rules.
- **Tolerances differ** between the two engines. Faces matched on every one
  of 2,752 generated states; real Edit files are untested.
- **Deep stacks are still slow.**
  - With PR #476, checks meet the ~200 ms target on every cpoogle design
    except the deepest stacks.
  - The 250-layer iguana takes about 0.45 s natively and 0.66 s in wasm, and
    an admitted design can take up to 5.6 s to open in wasm.
  - The search can still run out of budget. #476 reports that as its own
    "undecided" outcome, so the dialog's "couldn't check in time" state will
    really be used.
  - Clause learning, the likely fix, is not built.
- **Oriedita refuses some patterns the Fold solver folds.** Two of the five
  real trial exports, Crane and Heart, fail in Oriedita with
  `SameParityAdjacentFaces` but fold in the Fold solver. Edit couldn't draw a
  chosen order for them through Oriedita. Not yet explained.
- **An offered object can still turn out impossible.** "Open" comes from
  deduction, so some complete sentences preview as "can't fit" (about a tenth
  in the prototype). That is the intended split of cost, not a bug, but it
  must read as a normal outcome.
- **Hidden faces on the folded pane.** Many valid objects are hidden from the
  side shown. Cheems from the front shows 3 of one face's 11. They get only a
  small label there, and are picked on the crease pattern.
- **Face identity after edits.** A paper point picks one piece after a face is
  split. The dialog must surface that as ambiguous, never guess silently.
- **What counts as a solution depends on the drawing.** With spread layers or
  X-ray, almost every order looks different.
- **Large non-convex faces** (a vertex with only unfolded creases) and holes
  weaken "one relation per pair". Both are rare and inherited from the solvers.

---

## 14. Design: what is settled and what is left

**Settled** on the canvas
([Layer order dialog](https://claude.ai/artifact/48ECv5vgTcaKZTCHwxwFbu),
"A3 · Constraint builder"):
- layout;
- picking;
- the builder;
- the list;
- solutions and the stepper;
- messages;
- type, tokens and icons.

**Still to mock before or during Phase 1:**
- the entry points (Edit's figure toolbar and context menu, Fold with layer
  order…, the Diagram Step pane row, Pose's toolbar);
- the opening and counting states ("at least N", couldn't check in time);
- saved constraints that stop fitting after an edit;
- the phone layout;
- the Horizon theme, where the accent and danger colours are the same.

The design inputs (the app's visual language, the Fold sharing study and the
prototype data schema) are in [design/](design/). The artboards and their
data are in this worktree's gitignored `artifacts/layer-order-design/`.
