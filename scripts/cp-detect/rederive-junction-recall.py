"""Independent re-derivation of report §3: dense junction detection recall and
close-pair detection rate, computed in numpy directly on the dense cache.

Junction peak extraction replicates the Rust pipeline (evidence_extract.rs):
  prob = sigmoid(junction_logits); vertex_type absent -> score = prob.
  local maxima: prob >= thr AND no neighbour within radius 3 is STRICTLY greater.
  sub-pixel: refined = (x + offset_x[y,x], y + offset_y[y,x]).
Detector operating threshold = line_threshold.max(0.50) = 0.65.

GT "junctions" = interior GT vertices (not on the paper border at 32/992).
A GT junction is "detected" if some refined peak lies within 2px.
"""
import json, sys, numpy as np

DENSE = "/Users/zacharymarion/Documents/code/tree-maker-rust/artifacts/cp-detect-correctness/dense-cache/native-cp-v1-pytorch-mps-v3-tess15-weighted"
PACK_VERT = None  # gt vertices come from gt.graph.json (pack); resolve per sample
RADIUS = 3
MATCH = 2.0
SIZE = 1024
BORDER_LO, BORDER_HI = 32.0, 992.0

def gt_path(sample):
    # gt_graph is relative to the pack manifest dir
    return sample["gt_graph"]

def load_gt_junctions(sample, pack_root):
    g = json.load(open(f"{pack_root}/{sample['gt_graph']}"))
    V = np.array(g["vertices_px"], dtype=float)
    deg = np.zeros(len(V), dtype=int)
    for a, b in g["edges_vertices"]:
        deg[a] += 1; deg[b] += 1
    # A real crease junction is interior (off the paper border) AND degree >= 3.
    # (degree-1 = crease endpoint, degree-2 = collinear subdivision -> not junctions
    # the junction head targets.)
    eps = 1.0
    onborder = (np.abs(V[:,0]-BORDER_LO)<eps)|(np.abs(V[:,0]-BORDER_HI)<eps)| \
               (np.abs(V[:,1]-BORDER_LO)<eps)|(np.abs(V[:,1]-BORDER_HI)<eps)
    return V[(~onborder) & (deg >= 3)]

def peaks(jl_path, off_path, thr):
    jl = np.fromfile(jl_path, dtype=np.float32).reshape(SIZE, SIZE)
    prob = 1.0/(1.0+np.exp(-jl))
    ys, xs = np.where(prob >= thr)
    if len(ys) == 0:
        return np.zeros((0,2))
    off = np.fromfile(off_path, dtype=np.float32).reshape(2, SIZE, SIZE)
    keep = []
    for y, x in zip(ys, xs):
        v = prob[y, x]
        y0,y1 = max(0,y-RADIUS), min(SIZE,y+RADIUS+1)
        x0,x1 = max(0,x-RADIUS), min(SIZE,x+RADIUS+1)
        win = prob[y0:y1, x0:x1]
        if win.max() > v:   # a strictly greater neighbour -> not a peak
            continue
        ox = off[0, y, x]; oy = off[1, y, x]
        keep.append((x+ox, y+oy))
    return np.array(keep) if keep else np.zeros((0,2))

def nn_gap(J):
    if len(J) < 2:
        return np.full(len(J), 1e9)
    d = np.sqrt(((J[:,None,:]-J[None,:,:])**2).sum(-1))
    np.fill_diagonal(d, 1e9)
    return d.min(1)

BINS = [(0,4),(4,6),(6,8),(8,10),(10,12),(12,25),(25,1e9)]
def binidx(g):
    for i,(lo,hi) in enumerate(BINS):
        if lo<=g<hi: return i
    return len(BINS)-1

def run(bucket, thr, pack_root):
    man = json.load(open(f"{DENSE}/manifest.{bucket}.json"))
    samples = man["samples"]
    det=tot=0; junccnt=0
    binhit=[0]*len(BINS); bintot=[0]*len(BINS)
    for s in samples:
        J = load_gt_junctions(s, pack_root)
        if len(J)==0: continue
        junccnt += len(J)
        P = peaks(f"{DENSE}/{s['junction_logits_f32_path']}",
                  f"{DENSE}/{s['junction_offset_f32_path']}", thr)
        gaps = nn_gap(J)
        if len(P)==0:
            tot += len(J)
            for g in gaps: bintot[binidx(g)] += 1
            continue
        d = np.sqrt(((J[:,None,:]-P[None,:,:])**2).sum(-1))  # |J| x |P|
        mind = d.min(1)
        for k in range(len(J)):
            hit = mind[k] <= MATCH
            det += hit; tot += 1
            bi = binidx(gaps[k]); bintot[bi]+=1; binhit[bi]+=hit
    return det, tot, junccnt/len(samples), binhit, bintot

if __name__ == "__main__":
    pack_root = "/Users/zacharymarion/Documents/code/tree-maker-rust/artifacts/cp-detect-correctness/packs/native-cp-v1"
    bucket = sys.argv[1]; thr = float(sys.argv[2])
    det, tot, avgj, binhit, bintot = run(bucket, thr, pack_root)
    print(f"== {bucket} bucket, threshold {thr} ==")
    print(f"  avg interior junctions/CP: {avgj:.0f}")
    print(f"  overall recall@2px: {100*det/tot:.1f}%  ({det}/{tot})")
    print(f"  detection rate by nearest-neighbour gap:")
    for (lo,hi),h,t in zip(BINS,binhit,bintot):
        if t==0: continue
        label = f"{lo:.0f}-{hi:.0f}px" if hi<1e8 else f"{lo:.0f}+px"
        print(f"    {label:10} {100*h/t:5.1f}%  ({h}/{t})")
