#!/usr/bin/env python3
"""Export every tree in the local ExplOri tiling databases, classified.

The archive's `tilings_{N}_{symmetry}.db` files store each tiling's tree in the
`embedding` column as a pickled networkx graph — the very object the search
API serves as a result's `tree` — so a corpus of real result trees needs no
network, no crease-pattern reconstruction and no FAISS. Only `networkx` has to
be importable, to unpickle; the SEARCH-22.5 venv has it:

    ~/Documents/code/SEARCH-22.5/.venv/bin/python scripts/explori/export-local-trees.py

Writes two files, both under the ignored `artifacts/explori/` — **the archive's
tiling data is private and lives only on the machine that holds its database
files; none of it is committed**:

- `local-trees.json`: every tree, compact, tagged with its mirror
  classification from `mirror.py`. The web corpus test
  (`treeLayout.corpus.test.ts`) runs when it exists.
- `local-trees-sample.json`: a small sample covering every classification in
  every database, for the unit tests that skip where it is absent.

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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mirror import analyze, graph_to_lists  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_DBS = [
    os.path.expanduser(f"~/Documents/open source/origami-designer/explori_db/tilings_{combo}.db")
    for combo in ("2_book", "2_diag", "2_none", "3_book", "6_book")
] + [os.path.expanduser("~/Downloads/tilings_3_diag.db")]

# The sample: how many of each kind per database, first by id. Tilted trees
# are picked for variety instead — see `pick_sample`.
SAMPLE_PER_KIND = {"strict": 3, "tilted": 4, "crossing": 2, "rigid": 2}
# Trees the plan discusses by name; always in the sample when present.
ALWAYS = {"2_book": [2], "2_diag": [4], "3_book": [46, 55, 114], "6_book": [6, 7, 10]}


def combo_of(db_path: str) -> tuple[int, str]:
    stem = os.path.basename(db_path)
    stem = stem[len("tilings_") : -len(".db")]
    n, symmetry = stem.split("_", 1)
    return int(n), symmetry


def export_db(db_path: str) -> list[dict]:
    n, symmetry = combo_of(db_path)
    connection = sqlite3.connect(db_path)
    rows = connection.execute("SELECT id, topology_id, embedding FROM tilings ORDER BY id").fetchall()
    connection.close()
    trees = []
    for tiling_id, topology_id, blob in rows:
        graph = pickle.loads(blob)
        nodes, edges = graph_to_lists(graph)
        mirror = analyze(nodes, edges)
        trees.append(
            {
                "N": n,
                "symmetry": symmetry,
                "tilingId": tiling_id,
                "topologyId": topology_id,
                "tree": {"nodes": nodes, "edges": [[u, v, length] for u, v, length in edges]},
                "mirror": mirror.as_dict(),
            }
        )
    return trees


def pick_sample(trees: list[dict]) -> list[dict]:
    by_db: dict[str, list[dict]] = {}
    for tree in trees:
        by_db.setdefault(f"{tree['N']}_{tree['symmetry']}", []).append(tree)
    sample = []
    for combo, group in by_db.items():
        chosen: dict[int, dict] = {}
        for tiling_id in ALWAYS.get(combo, []):
            for tree in group:
                if tree["tilingId"] == tiling_id and tree["mirror"]["kind"] != "empty":
                    chosen[tiling_id] = tree
        for kind, count in SAMPLE_PER_KIND.items():
            candidates = [tree for tree in group if tree["mirror"]["kind"] == kind]
            if kind == "tilted":
                # One of each tilt count first, smallest to largest, then the
                # most-tilted tree, so the sample spans the compromise.
                by_tilt: dict[int, dict] = {}
                for tree in candidates:
                    by_tilt.setdefault(tree["mirror"]["tiltedCount"], tree)
                ordered = [by_tilt[key] for key in sorted(by_tilt)]
                if candidates:
                    ordered.append(max(candidates, key=lambda tree: tree["mirror"]["tiltedCount"]))
                candidates = ordered
            taken = 0
            for tree in candidates:
                if taken >= count:
                    break
                if tree["tilingId"] in chosen:
                    continue
                chosen[tree["tilingId"]] = tree
                taken += 1
        sample.extend(sorted(chosen.values(), key=lambda tree: tree["tilingId"]))
    return sample


def write_json(path: str, payload: dict, one_tree_per_line: bool) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as handle:
        if not one_tree_per_line:
            json.dump(payload, handle, separators=(",", ":"))
        else:
            head = {key: value for key, value in payload.items() if key != "trees"}
            handle.write("{\n")
            for key, value in head.items():
                handle.write(f"  {json.dumps(key)}: {json.dumps(value)},\n")
            handle.write('  "trees": [\n')
            for index, tree in enumerate(payload["trees"]):
                comma = "," if index < len(payload["trees"]) - 1 else ""
                handle.write("    " + json.dumps(tree, separators=(",", ":")) + comma + "\n")
            handle.write("  ]\n}\n")
    os.replace(tmp, path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", nargs="*", default=DEFAULT_DBS, help="tilings_{N}_{symmetry}.db files")
    parser.add_argument("--out", default=os.path.join(REPO_ROOT, "artifacts", "explori", "local-trees.json"))
    parser.add_argument(
        "--sample-out",
        default=os.path.join(REPO_ROOT, "artifacts", "explori", "local-trees-sample.json"),
    )
    args = parser.parse_args()

    trees: list[dict] = []
    sources = []
    for db_path in args.db:
        if not os.path.exists(db_path):
            print(f"skipping missing {db_path}", file=sys.stderr)
            continue
        exported = export_db(db_path)
        n, symmetry = combo_of(db_path)
        kinds = {}
        for tree in exported:
            kinds[tree["mirror"]["kind"]] = kinds.get(tree["mirror"]["kind"], 0) + 1
        sources.append({"file": os.path.basename(db_path), "N": n, "symmetry": symmetry, "count": len(exported), "kinds": kinds})
        print(f"{os.path.basename(db_path)}: {len(exported)} trees {kinds}")
        trees.extend(exported)

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    write_json(args.out, {"generatedAt": stamp, "generator": "scripts/explori/export-local-trees.py", "sources": sources, "trees": trees}, False)
    print(f"wrote {len(trees)} trees to {args.out}")

    sample = pick_sample([tree for tree in trees if tree["mirror"]["kind"] != "empty"])
    write_json(
        args.sample_out,
        {
            "generatedAt": stamp,
            "generator": "scripts/explori/export-local-trees.py",
            "note": "A sample of real ExplOri result trees from the local tiling databases, each tagged by scripts/explori/mirror.py. Private data: keep under artifacts/, never commit. Regenerate rather than edit.",
            "trees": sample,
        },
        True,
    )
    print(f"wrote {len(sample)} sample trees to {args.sample_out}")


if __name__ == "__main__":
    main()
