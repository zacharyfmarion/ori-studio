#!/usr/bin/env python3
"""Export crease pattern, packing and tree for a slice of the local archive.

For the paper-position recovery in `apps/web/src/explori/paperTree.ts`, which
refolds the packing and must reproduce the served tree. This writes the three
fields the recovery reads — `cp`, `packing`, `tree` — for the first few
tilings of every local database, serialized by upstream's own functions, so
the web corpus test (`paperTree.corpus.test.ts`) can run the recovery over a
few hundred real patterns. Must run with the SEARCH-22.5 venv:

    ~/Documents/code/SEARCH-22.5/.venv/bin/python scripts/explori/export-local-packings.py

Writes `artifacts/explori/local-packings.json` (ignored; a few megabytes).
Nothing here touches the network.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pickle
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_UPSTREAM = os.path.expanduser("~/Documents/code/SEARCH-22.5")
DEFAULT_DBS = [
    os.path.expanduser(f"~/Documents/open source/origami-designer/explori_db/tilings_{combo}.db")
    for combo in ("2_book", "2_diag", "2_none", "3_book", "6_book")
] + [os.path.expanduser("~/Downloads/tilings_3_diag.db")]


def combo_of(db_path: str) -> tuple[int, str]:
    stem = os.path.basename(db_path)[len("tilings_") : -len(".db")]
    n, symmetry = stem.split("_", 1)
    return int(n), symmetry


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--upstream", default=DEFAULT_UPSTREAM)
    parser.add_argument("--db", nargs="*", default=DEFAULT_DBS)
    parser.add_argument("--per-db", type=int, default=40, help="tilings per database, from the first id")
    parser.add_argument("--dense-per-db", type=int, default=12, help="for the 6 book database, whose patterns are large")
    parser.add_argument("--out", default=os.path.join(REPO_ROOT, "artifacts", "explori", "local-packings.json"))
    parser.add_argument(
        "--extra",
        nargs="*",
        default=["6_book:1673"],
        help="N_symmetry:id tilings to include beyond the first few; the default is a book tiling whose pattern has no mirror",
    )
    args = parser.parse_args()
    extra: dict[str, list[int]] = {}
    for entry in args.extra:
        combo, tiling_id = entry.split(":")
        extra.setdefault(combo, []).append(int(tiling_id))

    sys.path.insert(0, args.upstream)
    os.chdir(args.upstream)
    from interface.serialization import serialize_cp, serialize_graph  # noqa: E402
    from src.engine.fold225 import cp_to_fold, fold_to_cp  # noqa: E402
    from src.engine.tiling2cp import add_hinges, build_crease_pattern, load_frozen_blob  # noqa: E402

    entries = []
    for db_path in args.db:
        if not os.path.exists(db_path):
            print(f"skipping missing {db_path}", file=sys.stderr)
            continue
        n, symmetry = combo_of(db_path)
        limit = args.dense_per_db if n >= 6 else args.per_db
        connection = sqlite3.connect(db_path)
        rows = connection.execute("SELECT id, tiling_blob FROM tilings ORDER BY id LIMIT ?", (limit,)).fetchall()
        for tiling_id in extra.get(f"{n}_{symmetry}", []):
            if all(row[0] != tiling_id for row in rows):
                rows += connection.execute("SELECT id, tiling_blob FROM tilings WHERE id = ?", (tiling_id,)).fetchall()
        connection.close()
        for tiling_id, blob in rows:
            graph, positions, faces = load_frozen_blob(pickle.loads(blob))
            cp = add_hinges(build_crease_pattern(graph, positions, faces, N=n, verbose=False))
            if not cp.vertices:
                continue
            fold = cp_to_fold(cp)
            tree, packing = fold.get_tree_and_packing(include_packing=True)
            res_packing = fold_to_cp(packing[0], inst_graph=packing[1], mv_reference=cp)
            entries.append(
                {
                    "N": n,
                    "symmetry": symmetry,
                    "tilingId": tiling_id,
                    "cp": serialize_cp(cp),
                    "packing": serialize_cp(res_packing),
                    "tree": serialize_graph(tree),
                }
            )
        print(f"{n}_{symmetry}: {len(rows)} tilings")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out + ".tmp", "w") as handle:
        json.dump(
            {
                "generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d"),
                "generator": "scripts/explori/export-local-packings.py",
                "entries": entries,
            },
            handle,
            separators=(",", ":"),
        )
    os.replace(args.out + ".tmp", args.out)
    print(f"wrote {len(entries)} entries to {args.out} ({os.path.getsize(args.out)} bytes)")


if __name__ == "__main__":
    main()
