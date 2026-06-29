#!/bin/zsh
# Product-faithful refiner benchmark over the native-cp-v1 set.
#
# Mirrors the dense-cache flow but for the vertex refiner: the geometry
# (proposals -> crop tensors, decode -> merge) is shared Rust
# (`oristudio_cp_detect::refinement`); only the forward pass runs in PyTorch/MPS.
#
#   per bucket:  refiner_cache plan -> infer-native-cp-refined-vertices.py (Torch)
#                -> refiner_cache merge -> {P0, refined, oracle-J} benchmark
#
# Produces a P0 / refined / J(oracle-vertices) topology-ceiling readout per bucket,
# showing where the shipped refiner lands in [dense-head, GT-vertices].
#
# Env (with defaults):
#   DENSE_DIR  dense cache dir holding manifest.{easy,medium,hard}.json
#   DETECTOR_PY  python with torch + the detector repo importable (its .venv)
#   OUT_DIR    output/scratch dir
#   ROOT       tree-maker-rust worktree root (defaults to this script's repo)
set -e

ROOT=${ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}
DENSE_DIR=${DENSE_DIR:-$ROOT/artifacts/cp-detect-correctness/dense-cache/native-cp-v1-pytorch-mps-v3-tess15-weighted}
DETECTOR_PY=${DETECTOR_PY:-$HOME/Documents/code/create-pattern-detector/.venv/bin/python}
OUT_DIR=${OUT_DIR:-$ROOT/artifacts/cp-detect-correctness/refiner-matrix}
PROFILE=${PROFILE:-release}

RC=$ROOT/target/$PROFILE/refiner_cache
BM=$ROOT/target/$PROFILE/compare_exact_solve_benchmark
mkdir -p "$OUT_DIR"
cd "$ROOT"

# Product config (junction-first + source-image lines + parity); --skip-exact-solve
# measures the topology ceiling (the solver is not a confound).
C=(--candidate-source junction-first-v1 --line-evidence-source source-image
   --parity-repair --skip-flat-folder --skip-exact-solve)

for bucket in easy medium hard; do
  MAN=$DENSE_DIR/manifest.$bucket.json
  echo "[$bucket] plan -> torch -> merge" >&2
  "$RC" plan --manifest "$MAN" --out "$OUT_DIR/$bucket-crops" >/dev/null
  "$DETECTOR_PY" scripts/cp-detect/infer-native-cp-refined-vertices.py \
      --crops "$OUT_DIR/$bucket-crops" --out "$OUT_DIR/$bucket-outs" >/dev/null
  "$RC" merge --crops "$OUT_DIR/$bucket-crops" --outputs "$OUT_DIR/$bucket-outs" \
      --out "$OUT_DIR/$bucket-refined.json" >/dev/null
  echo "[$bucket] benchmark P0 / refined / J" >&2
  "$BM" --manifest "$MAN" $C --out "$OUT_DIR/$bucket-p0" >/dev/null 2>&1
  "$BM" --manifest "$MAN" $C --refined-vertices "$OUT_DIR/$bucket-refined.json" \
      --out "$OUT_DIR/$bucket-refined" >/dev/null 2>&1
  "$BM" --manifest "$MAN" $C --oracle-vertices --out "$OUT_DIR/$bucket-J" >/dev/null 2>&1
done

python3 - "$OUT_DIR" <<'PY'
import json, os, sys
out = sys.argv[1]
def summ(d):
    rs = [json.loads(l) for l in open(os.path.join(d, "per_sample.jsonl"))]
    s = lambda k: sum(r["attribution"][k] for r in rs)
    ex = sum(1 for r in rs if r["attribution"]["exact_topology"])
    return ex, len(rs), s("detector_miss"), s("selection_miss"), s("spurious")
print(f"{'bucket':8}{'cfg':10}{'exact':>9}{'det_miss':>9}{'sel_miss':>9}{'spurious':>9}")
for bucket in ("easy", "medium", "hard"):
    for cfg, tag in (("p0", "P0"), ("refined", "refined"), ("J", "J(oracle)")):
        d = os.path.join(out, f"{bucket}-{cfg}")
        if not os.path.exists(os.path.join(d, "per_sample.jsonl")):
            continue
        ex, n, dm, sm, sp = summ(d)
        print(f"{bucket:8}{tag:10}{f'{ex}/{n}':>9}{dm:>9}{sm:>9}{sp:>9}")
PY
echo "MATRIX DONE" >&2
