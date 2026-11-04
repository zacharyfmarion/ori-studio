# Layer order design data

Real geometry and real layer orders for the Layer order dialog prototypes.

| File | Model | Faces | Spots (cells) | Deepest stack | Orders | Parts | Looks (front / back) | Size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `kabuto.json` | Kabuto (traditional; the repo's Flat-Folder test fixture) | 18 | 23 | 12 | 9 (3 × 3) | 2 | 9 / 1 | 12 KB |
| `cheems.json` | Cheems by Birb (cpoogle) | 75 | 198 | 30 | 24 (2 × 2 × 2 × 3) | 4 | 12 / 2 | 209 KB |

What each part can change from the front:

- **Kabuto:** two parts of 3 orders, each changing the top face of 7 spots.
  Every order looks different from the front (9 looks); from the back all 9
  look the same.
- **Cheems:** parts of 2, 2, 2 and 3 orders. They change the top face of 17,
  0, 1 and 15 spots. The second part changes only hidden layers, which is the
  spec's "only hidden layers changed" case. 24 orders give 12 looks from the
  front and 2 from the back.

Every number comes from the Fold workspace's engine at PR #476
(`claude/fold-solver-perf`, commit `eb4b51c54`). The pattern is loaded the
way the app's Import CP loads it: the CP kernel's loader, the wasm bridge's
`input_of_model`, then `ImportedPattern::new(…, Empty { start: Front })`.
Faces, folded images and cells are the engine's own (`Unordered::view`, the
overlay of `ConstraintProblem`). Orders are the engine's exact enumeration
(`Completions::picks` → `Completions::order`). `forced` and `first` come from
`ImportedPattern::session` (`CompletionSession::forced`, `first_order`).
Only `edges` is computed outside the engine (below), because the folded
figure's line drawing is done in TypeScript, not in Rust.

The generator is a scratch example,
`design-snap/crates/oristudio-fold/examples/design_data.rs`, not in the
repository. Do not commit `cheems.json`: it is a designer's crease pattern
from the private cpoogle corpus.

## Frame

`frame` in each file says it in one sentence:

> Front is the side Edit shows by default: the crease pattern folded with its
> centre face fixed and the sheet's front (coloured) side up, seen from above.
> Every stack is listed top first as seen from the front.

- **Front.** The face that holds the sheet's centre (`root`) stays where it
  is on the crease pattern and shows the sheet's front. The folded figure is
  drawn as seen from the front.
- **Back.** Turning the figure over mirrors the picture left to right and
  reverses every stack. Nothing in the files is pre-flipped: a back view
  mirrors `x` (`1000 − x`) and reads each stack bottom first.
- **Coordinates.** `cp` and `fold` coordinates are each normalised into
  their own 0–1000 box, aspect ratio kept, **y pointing down** (SVG), and
  rounded to 1 decimal. The crease pattern is drawn as Edit draws it.

## Fields

Ids are array positions: face `f` is `faces[f]`, cell `c` is `cells[c]`.

| Key | Shape | Meaning |
| --- | --- | --- |
| `name` | string | Model name. |
| `credit` | string | Designer credit, for example `"Cheems by Birb"`. |
| `stats` | object | `faces`, `cells` (spots), `maxPly` (deepest stack), `orders` (every layer order), `parts` (independent parts), `frontLooks` and `backLooks` (distinct pictures: the top face of every spot from the front, the bottom face from the back). |
| `frame` | string | The sentence above, plus the coordinate convention. |
| `root` | face id | The face that stays put and shows the front (the face at the sheet's centre). *Extra, not in the brief.* |
| `sheet` | `[[x,y]…]` | The paper outline, crease-pattern coordinates. |
| `creases` | `[[x1,y1,x2,y2,kind]…]` | Crease-pattern segments, crease-pattern coordinates. `kind`: `M` mountain, `V` valley (as seen on the front), `B` border, `F` flat (an unfolded crease, a precrease or an aux line kept as a crease mark). `U` would be a folded crease with no letter; neither file has one. The engine's segments: a file's line is split where it meets other creases. |
| `faces` | `[{id, cp, fold, up}]` | `cp`: the face on the crease pattern. `fold`: its image on the folded figure (as seen from the front). `up`: true when the face shows the paper's front (coloured) side to a viewer looking at the front. `cp[i]` and `fold[i]` are the **same vertex of the paper**: `fold` is the `cp` ring through the face's isometry (checked against the engine's folded view: every face matches within 10⁻⁶). So a face with `up: false` has its `fold` ring wound the other way from its `cp` ring. |
| `cells` | `[{id, poly, faces}]` | The spots: convex polygons in folded coordinates, each covered by one fixed set of faces (`faces`, ascending ids, not a stack). Neighbouring cells can have the same face set: the engine cuts along whole edge lines. |
| `edges` | `[[x1,y1,x2,y2,left,right]…]` | Every cell boundary, split so each piece borders exactly one cell on each side, or the outside (`-1`). `left` is the cell on your left as you walk from `(x1,y1)` to `(x2,y2)` on screen (y down: the side of the normal `(dy, −dx)`). **Drawing rule:** draw a piece when one side is `-1` or the two cells' top faces differ in the order shown. |
| `orders` | `[order…]` | Every layer order, exactly. An order is an array over cells (index = cell id) of face-id stacks, **top first as seen from the front**. |
| `picks` | `[[k₀,k₁,…]…]` | Per order, which of each part's orders it uses (`picks[o][p]` indexes part `p`'s orders). Orders are listed with the first part stepping slowest. *Extra.* |
| `first` | int | Index into `orders` of the order the engine returns first (the session's `first_order`, also `complete`'s first pick). Show it when the dialog opens. It is `0` in both files. |
| `forced` | `{"<cell>": {"<face>": aboveFace}}` | Before any user constraint: for each face in a cell that the creases alone force some other face of that cell above, one such face (the lowest of them in the `first` order, so the nearest). A face missing from a cell's map has nothing forced above it there; a cell missing from the map has no such face. This is what greys out "On top here" with a reason ("always under X: set by the creases"). |
| `parts` | `[{orders, cells, faces}]` | The independent parts, in the engine's order (smallest first). `orders`: how many orders it allows; the total is their product. `cells`: the cells whose top face (from the front) this part can change, found by exhaustive comparison (two orders that differ only in this part). `faces`: the faces of the pairs this part decides. *`faces` is extra.* |

### Using it in a prototype

- **Draw an order.** Fill each cell by its top face (`up` → coloured, else
  white), then draw `edges` with the drawing rule. The back view uses each
  stack's last face, mirrors x, and a face shows the front when `up` is false.
- **Filter as constraints are added.** "On top here: X at cell c" keeps the
  orders whose `orders[o][c][0] == X`. "A above B" keeps the orders where A
  comes before B in every cell holding both (pairs are consistent across
  cells, so checking one shared cell is enough).
- **Greying out.** X can't be put on top at cell c when `forced[c][X]` exists;
  its row can say "always under `forced[c][X]`". Anything else is a real
  choice; with constraints added, a choice that no remaining order allows is
  the "refused, conflict" case.
- **Open spots.** A cell is open when its top face differs among the
  remaining orders. `parts[p].cells` gives the cells each part can change.
- **Looks.** Group the remaining orders by their array of top faces.

## Checks run

Both files, on the data as written:

- The number of orders equals the engine's exact count, and the product of
  the parts' counts.
- In every order, a pair of faces is ordered the same way in every cell
  they share, and every order passes the engine's own checker
  (`check_problem`, every constraint).
- Every forced pair of the session holds in every order, and so does every
  entry of `forced`.
- The first order's stacks equal those of the engine's own scene for that
  order (`State::scene().subfaces`).
- `edges`: every piece has a cell on at least one side, none has two cells on
  one side, and every piece with `-1` on a side really has no paper there
  (probed 10⁻⁵ of the sheet's size off the piece). Kabuto: 45 pieces (30 interior). Cheems: 386
  pieces (355 interior).
- Drawn from the JSON with the rule above, the first order and the order that
  differs from it at the most spots both look like a clean flat folded figure.
