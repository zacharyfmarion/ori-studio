# Flat-Folder Oracle

`oracle.mjs` wraps the vendored Flat-Folder JavaScript implementation and emits
stable JSON for Rust parity tests.

Commands:

```sh
node tools/flat-folder-oracle/oracle.mjs normalize tests/fixtures/flat-folder/kabuto.fold
node tools/flat-folder-oracle/oracle.mjs project tests/fixtures/flat-folder/kabuto.fold
node tools/flat-folder-oracle/oracle.mjs overlap tests/fixtures/flat-folder/kabuto.fold
node tools/flat-folder-oracle/oracle.mjs constraints tests/fixtures/flat-folder/kabuto.fold
node tools/flat-folder-oracle/oracle.mjs solve tests/fixtures/flat-folder/kabuto.fold --limit 10
node tools/flat-folder-oracle/oracle.mjs run-corpus tests/fixtures/flat-folder --limit 1
node tools/flat-folder-oracle/oracle.mjs verify tests/fixtures/flat-folder/r069-s07.fold tests/fixtures/flat-folder/r069-s07.missed-order.json
```

`--limit` accepts a positive integer or `all`. Set
`FLATFOLDER_ORACLE_INCLUDE_DATA=1` for debugging first-solution face-order data
in `solve` output.

## `verify`

`verify <fold> <order.json>` checks a complete layer order against
Flat-Folder's own constraints. It is the oracle for orders built elsewhere, such
as Fold's.

The order is FOLD `faceOrders`: either a bare array of `[f, g, s]` or an object
with a `faceOrders` key, so a FOLD file that carries its order works as both
arguments. Face indices refer to the FOLD's `faces_vertices`, which `verify`
keeps as given. The other commands go through Flat-Folder's file importer,
which re-sorts faces by area. `verify` needs `vertices_coords`,
`edges_vertices` and counter-clockwise `faces_vertices`, and treats a missing
`edges_assignment` as all `U`, as the importer does.

Flat-Folder builds its arrangement of the folded crease pattern at an ε chosen
by a heuristic (`conversion.js` `L_2_V_EV_EL`). On thin features that ε can give
an arrangement that is wrong without changing a single cell area. So `verify`
checks each candidate:

- no vertex image moved by more than 1e-8 of the folded extent;
- every edge is covered by its segments, so no overlap of two creases was
  handed to one of them;
- no cell boundary doubles back, which overlapping collinear segments leave;
- the cells cover each face once, by area;
- the constraints build without an exception.

A rejected arrangement is rebuilt at half the ε (`L_eps_2_V_EV_EL`) until ε
would drop below 1e-13. On the accepted one, every pair the order names is
seeded, and Flat-Folder's own propagation (`SOLVER.initial_assignment`) runs
from all of them.

Output:

- `status`: `ok`, `precision-error` (no ε passed; `arrangement.rejected` says
  why each failed) or `invalid-input`.
- `arrangement`: the accepted `eps_i` (ε is the shortest folded edge over
  2^eps_i), `retries`, and one `"<eps_i>: <reason>"` per rejected ε.
- `verify.verdict`:
  - `valid`: no conflict, every variable assigned, and the M/V letters agree;
  - `conflict`: propagation broke a constraint, named in `verify.conflict` as
    upstream reports it (`constraint_type`, `faces`, `conflict_faces`);
  - `letter-conflict`: consistent, but some M/V letters disagree with it;
  - `incomplete`: consistent, but some variables are left undecided.
- Counts: `variables`, `order_pairs`, `missing_pairs` (variables the order does
  not name), `extra_pairs` (pairs it names that Flat-Folder does not consider
  overlapping), `unassigned`, `letter_disagreements` and
  `letters_without_variable`.

On the 2,855 Fold spike states (valid by construction), `verify` against each
state's own order returned `valid` every time; 162 needed at least one retry.
The `flat_folder_verify` oracle test runs it on the committed `r271-s03` and
`r069-s07` fixtures (see `PORTING.md`, "Flat-Folder").
