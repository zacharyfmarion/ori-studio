#!/usr/bin/env python3
"""Build API-shaped ExplOri fixtures from the local tiling databases, offline.

For each database this rebuilds a few tilings exactly as the search server does
— `load_frozen_blob → build_crease_pattern → add_hinges → cp_to_fold →
get_tree_and_packing → fold_to_cp` — and serializes them with the server's own
`interface/serialization.py`, so a fixture is the shape the API sends rather
than a hand-written imitation of it. Two fields the query endpoint carries are
left out because nothing of ours reads them: `topology` and `solved_tiling`.
`distance` is 0 as on the single-tiling endpoint; the dev mock assigns one.

Tilings are chosen by the mirror classification of the tree the server would
send (`mirror.py`), smallest trees first, so the set covers strict, tilted,
crossing and rigid trees and stays legible at thumbnail size. Must run with the
SEARCH-22.5 venv, from anywhere:

    ~/Documents/code/SEARCH-22.5/.venv/bin/python scripts/explori/build-fixtures.py

Writes one query-response bundle per database to
`artifacts/explori/local-tilings/{N}{s}.json`. **That directory is ignored and
must stay so: the archive's tiling data is private and lives only on the machine
that holds its database files.** The dev mock and the local-only tests read it
from there. Nothing here touches the network.
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
sys.path.insert(0, HERE)
from mirror import analyze, graph_to_lists  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_UPSTREAM = os.path.expanduser("~/Documents/code/SEARCH-22.5")
DEFAULT_DBS = [
    os.path.expanduser(f"~/Documents/open source/origami-designer/explori_db/tilings_{combo}.db")
    for combo in ("2_book", "2_diag", "2_none", "3_book", "6_book")
] + [os.path.expanduser("~/Downloads/tilings_3_diag.db")]
SYMMETRY_LETTER = {"book": "b", "diag": "d", "none": "n"}
DEFAULT_PICK = "strict:1,tilted:2,crossing:1,rigid:1"


def combo_of(db_path: str) -> tuple[int, str]:
    stem = os.path.basename(db_path)[len("tilings_") : -len(".db")]
    n, symmetry = stem.split("_", 1)
    return int(n), symmetry


def parse_pick(text: str) -> dict[str, int]:
    picks = {}
    for part in text.split(","):
        kind, count = part.split(":")
        picks[kind.strip()] = int(count)
    return picks


def choose(tagged: list[dict], picks: dict[str, int]) -> list[dict]:
    """`tagged` rows carry `mirror`; smallest trees first within a kind."""
    chosen: list[dict] = []
    for kind, count in picks.items():
        candidates = sorted(
            (row for row in tagged if row["mirror"]["kind"] == kind),
            key=lambda row: (row["mirror"]["nodeCount"], row["id"]),
        )
        if kind == "tilted" and candidates:
            # The least- and the most-tilted tree, so the fixture spans the
            # compromise; smallest tree among equals.
            least = min(candidates, key=lambda row: (row["mirror"]["tiltedCount"], row["mirror"]["nodeCount"], row["id"]))
            most = max(candidates, key=lambda row: (row["mirror"]["tiltedCount"], -row["mirror"]["nodeCount"], -row["id"]))
            candidates = [least] + ([most] if most is not least else []) + [
                row for row in candidates if row is not least and row is not most
            ]
        for row in candidates[:count]:
            if row not in chosen:
                chosen.append(row)
    chosen.sort(key=lambda row: row["id"])
    return chosen


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--upstream", default=DEFAULT_UPSTREAM, help="SEARCH-22.5 checkout")
    parser.add_argument("--db", nargs="*", default=DEFAULT_DBS)
    parser.add_argument("--out", default=os.path.join(REPO_ROOT, "artifacts", "explori", "local-tilings"))
    parser.add_argument("--pick", default=DEFAULT_PICK, help="kind:count pairs applied to every database")
    parser.add_argument("--ids", nargs="*", default=[], help="explicit N_symmetry:id picks, added to the automatic ones")
    args = parser.parse_args()

    sys.path.insert(0, args.upstream)
    os.chdir(args.upstream)
    from interface.serialization import serialize_cp, serialize_fold, serialize_graph  # noqa: E402
    from src.engine.fold225 import cp_to_fold, fold_to_cp  # noqa: E402
    from src.engine.tiling2cp import add_hinges, build_crease_pattern, load_frozen_blob  # noqa: E402

    picks = parse_pick(args.pick)
    explicit: dict[str, set[int]] = {}
    for entry in args.ids:
        combo, tiling_id = entry.split(":")
        explicit.setdefault(combo, set()).add(int(tiling_id))

    os.makedirs(args.out, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    for db_path in args.db:
        if not os.path.exists(db_path):
            print(f"skipping missing {db_path}", file=sys.stderr)
            continue
        n, symmetry = combo_of(db_path)
        combo = f"{n}_{symmetry}"
        connection = sqlite3.connect(db_path)
        rows = connection.execute("SELECT id, topology_id, tiling_blob, embedding FROM tilings ORDER BY id").fetchall()
        connection.close()

        # Classify from the stored tree, which is the served tree up to
        # relabelling and costs nothing to read; the served tree is rebuilt
        # for the chosen few and re-tagged below.
        tagged = []
        for tiling_id, topology_id, tiling_blob, embedding in rows:
            mirror = analyze(*graph_to_lists(pickle.loads(embedding)))
            if mirror.kind == "empty":
                continue
            tagged.append({"id": tiling_id, "topology_id": topology_id, "blob": tiling_blob, "mirror": mirror.as_dict()})
        chosen = choose(tagged, picks)
        for row in tagged:
            if row["id"] in explicit.get(combo, set()) and row not in chosen:
                chosen.append(row)
        chosen.sort(key=lambda row: row["id"])

        results = []
        kinds = {}
        for rank, row in enumerate(chosen, start=1):
            graph, positions, faces = load_frozen_blob(pickle.loads(row["blob"]))
            cp = add_hinges(build_crease_pattern(graph, positions, faces, N=n, verbose=False))
            fold = cp_to_fold(cp)
            tree, packing = fold.get_tree_and_packing(include_packing=True)
            served = analyze(*graph_to_lists(tree))
            if served.as_dict() != row["mirror"]:
                print(f"  note: {combo} #{row['id']}: served tree classifies as {served.kind}, stored as {row['mirror']['kind']}", file=sys.stderr)
            res_packing = fold_to_cp(packing[0], inst_graph=packing[1], mv_reference=cp)
            results.append(
                {
                    "rank": rank,
                    "distance": 0.0,
                    "N": n,
                    "symmetry": symmetry,
                    "topology_id": row["topology_id"],
                    "tiling_id": row["id"],
                    "cp": serialize_cp(cp),
                    "fold": serialize_fold(fold),
                    "tree": serialize_graph(tree),
                    "packing": serialize_cp(res_packing),
                    "comp_map": {},
                    "refs": {},
                }
            )
            kinds[str(row["id"])] = served.as_dict()
        bundle = {
            "query_id": f"local-fixture:{n}{SYMMETRY_LETTER[symmetry]}",
            "db_configs": [{"N": n, "symmetry": symmetry}],
            "results": results,
            "fixture": {
                "generatedAt": stamp,
                "generator": "scripts/explori/build-fixtures.py",
                "source": os.path.basename(db_path),
                "mirror": kinds,
            },
        }
        text = json.dumps(bundle, separators=(",", ":"))
        path = os.path.join(args.out, f"{n}{SYMMETRY_LETTER[symmetry]}.json")
        with open(path + ".tmp", "w") as handle:
            handle.write(text)
        os.replace(path + ".tmp", path)
        print(f"{combo}: {[(row['id'], kinds[str(row['id'])]['kind'], kinds[str(row['id'])]['tiltedCount']) for row in chosen]} -> {os.path.relpath(path, REPO_ROOT)} ({len(text)} bytes)")


if __name__ == "__main__":
    main()
