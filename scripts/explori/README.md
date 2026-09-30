# ExplOri, offline

Tooling for working on the ExplOri design kind without sending a single request
to `225.designorigami.net`. That server is one person's machine, and every
search from a dev server lands on it; these scripts and the dev mock exist so
that developing the surface does not.

Everything here reads the archive's own SQLite files, which are not in this
repository. **The tiling data is private**: it came from the archive's author
for local use, and nothing derived from it — no bundle, tree sample or corpus
— is committed. Every output below lands under the ignored `artifacts/explori/`,
and every test over it skips where it is absent. On Zach's machine the files
are:

| file | where |
| --- | --- |
| `tilings_2_book.db`, `tilings_2_diag.db`, `tilings_2_none.db`, `tilings_3_book.db`, `tilings_6_book.db` | `~/Documents/open source/origami-designer/explori_db/` |
| `tilings_3_diag.db` | `~/Downloads/` |

Both scripts default to those paths and take `--db` to point elsewhere. The
`embedding` column of a `tilings` row is the pickled networkx tree the API
serves as a result's `tree`; `tiling_blob` is what the crease pattern is
rebuilt from.

## The tree corpus

```bash
~/Documents/code/SEARCH-22.5/.venv/bin/python scripts/explori/export-local-trees.py
```

Needs only a Python with `networkx` (to unpickle). Writes, both ignored:

- `artifacts/explori/local-trees.json` — every tree, compact, tagged with its
  mirror classification by `mirror.py`. When it exists,
  `apps/web/src/explori/treeLayout.corpus.test.ts` runs the mirror fan over all
  of it and asserts the TypeScript layout agrees with the Python classifier on
  every tree.
- `artifacts/explori/local-trees-sample.json` — a small sample covering every
  classification in every database, for the unit tests that skip without it.

`mirror.py` is the Python twin of `apps/web/src/explori/treeLayout.ts`. A change
to the pairing or the axis rule has to land in both.

## Packings for the paper-position check

```bash
~/Documents/code/SEARCH-22.5/.venv/bin/python scripts/explori/export-local-packings.py
```

Needs the SEARCH-22.5 venv. Writes `artifacts/explori/local-packings.json`
(ignored): crease pattern, packing and tree for the first forty tilings of
every database (twelve for `6 book`), plus any `--extra N_symmetry:id` —
by default `6 book` #1673, a book tiling whose pattern mirrors across nothing.
When it exists, `apps/web/src/explori/paperTree.corpus.test.ts` refolds every
packing, checks that the recovered tree is the served one, and checks that a
mirror is found in every book and diag pattern except that one.

## API-shaped fixtures

```bash
~/Documents/code/SEARCH-22.5/.venv/bin/python scripts/explori/build-fixtures.py
```

Needs the SEARCH-22.5 venv (compiled `math225_core`, `py_straight_skeleton`).
Rebuilds a few tilings per database exactly as the server does and serializes
them with the server's own `interface/serialization.py`, so a bundle has the
API's shape. Bundles land in `artifacts/explori/local-tilings/` (ignored); the
dev mock and the local-only tests read them from there.

## Searching without upstream

```bash
EXPLORI_MOCK=1 scripts/dev-server.sh start
```

The dev server then answers `/api/explori/query` and `/api/explori/tiling` from
the fixture bundles and drops the upstream proxy entirely
(`apps/web/vite/exploriMock.ts`). Results are ranked by how alike the trees are
in size, not by any embedding — enough to exercise every rendering state, and
not a search.

To develop against a *real* search that is still offline, run the archive's own
server on the local databases and point the proxy at it:

```bash
EXPLORI_DEV_ORIGIN=http://127.0.0.1:8000 scripts/dev-server.sh start
```

Standing that server up is not scripted here, because it needs changes to the
SEARCH-22.5 venv: install `faiss-cpu` (in its `requirements.txt`, not in the
venv), link the six `.db` files into `database/tilings/storage/`, build the
FAISS caches for those six with `build_wks_index_for_db`, and supply a
`PYTHONPATH` shim for `gspread`, `oauth2client.service_account` and a
`credentials.json`, because `interface/server.py` authenticates to Google Sheets
at import time. Only `/api/query` would work — `/api/fetch_tiling` also needs the
refs databases, which are not present — and that is all the dev loop needs.
