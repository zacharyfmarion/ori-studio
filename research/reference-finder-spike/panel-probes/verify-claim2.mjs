import { lineFromPoints as LP, lineKey, ptKey, onLine, reflectPt, reflectLine, intersect, State, construct, qk } from "./verify-geom.mjs";
const show = (t) => `${t.n[0].toFixed(4)},${t.n[1].toFixed(4)} d=${t.d.toFixed(4)}`;
function clip(st, l) { // in-paper segment endpoints of l
  const edges = [...st.L.values()].filter(m => m.tag === "edge");
  const pts = []; for (const e of edges) { const p = intersect(l, e); if (p && st.inPaper(p)) pts.push(p); }
  // dedupe
  const out = []; for (const p of pts) if (!out.some(q => Math.hypot(q[0]-p[0], q[1]-p[1]) < 1e-9)) out.push(p); return out;
}
const side = (l, p) => Math.sign(l.n[0]*p[0] + l.n[1]*p[1] - l.d);

console.log("=== A: O4 with fold∩m outside the paper (box-pleat corner diagonals) ===");
{
  const st = new State(1, 1);
  const m = LP([0, 0.9], [0.1, 1]);      // top-left corner diagonal, slope +1
  st.addLine(m, "cp");
  st.addLine(LP([0.1, 0], [0.1, 1]), "cp"); // grid line x=0.1 -> gives point (0.1,0)
  const l = LP([0, 0.1], [0.1, 0]);      // target: bottom-left corner diagonal, slope -1
  const X = intersect(l, m);
  console.log("construct ->", construct(st, l), "| l⟂m:", Math.abs(l.n[0]*m.n[0]+l.n[1]*m.n[1]) < 1e-9, "| fold∩m =", X, "inPaper:", st.inPaper(X));
  console.log("points on l:", [...st.P.values()].filter(p => onLine(l, p)));
  console.log("RF RefLine_L2L_C2P would return early: !Encloses(p1p) where p1p=projection of p onto m =", X);
}

console.log("\n=== B: O7 reported although fold∩m is outside the paper (line is O5-constructible) ===");
{
  const st = new State(1, 1);
  const m = LP([0, 0.9], [0.1, 1]);  st.addLine(m, "cp");
  st.addLine(LP([0.3, 0], [0.3, 1]), "cp"); // x=0.3
  const l = LP([0, 0.3], [0.3, 0]);
  const X = intersect(l, m);
  console.log("construct ->", construct(st, l), "| fold∩m =", X, "inPaper:", st.inPaper(X));
  console.log("lander corner (0,0) ->", reflectPt(l, [0,0]), "(on x=0.3) ; pivot (0.3,0) on l -> genuine O5 exists");
}

console.log("\n=== C: O3 with intersection off-paper and both in-paper segments on the same side of the fold ===");
{
  const st = new State(1, 1);
  const X = [-0.1, 0.5];
  const m = LP(X, [1, 0]); const r = LP(X, [0.2, 1]);
  st.addLine(m, "cp"); st.addLine(r, "cp");
  // the two bisectors
  const u1 = m.n, u2 = r.n;
  for (const sgn of [1, -1]) {
    let a = u1[0] + sgn*u2[0], b = u1[1] + sgn*u2[1]; const len = Math.hypot(a,b); a/=len; b/=len;
    const l0 = { n: [a, b], d: a*X[0] + b*X[1] };
    const l = LP([l0.n[0]*l0.d, l0.n[1]*l0.d], [l0.n[0]*l0.d - l0.n[1], l0.n[1]*l0.d + l0.n[0]]);
    const seg = clip(st, l);
    if (seg.length < 2) { console.log("bisector", show(l), "does not cross the paper"); continue; }
    const sm = clip(st, m), sr = clip(st, r);
    const sidesM = sm.map(p => side(l, p)), sidesR = sr.map(p => side(l, p));
    const rr = reflectLine(l, m);
    console.log("bisector", show(l), "crosses paper at", seg.map(p => p.map(v => +v.toFixed(3))));
    console.log("  reflect(m)==r:", lineKey(rr) === lineKey(r), "| construct ->", construct(st, l));
    console.log("  m segment sides:", sidesM, "r segment sides:", sidesR, "| image of m's segment:", sm.map(p => reflectPt(l, p).map(v => +v.toFixed(3))), "inPaper:", sm.map(p => st.inPaper(reflectPt(l, p))));
  }
}

console.log("\n=== D: linesThrough hash false negative on the line x+y=0.5 ===");
{
  const st = new State(1, 1);
  const m1 = LP([0.5, 0], [0, 0.5]); st.addLine(m1, "cp");
  console.log("line x+y=0.5:", show(m1), "key", lineKey(m1));
  for (const p of [[0.25,0.25],[0.2,0.3],[0.1,0.4],[0.5,0],[0,0.5]]) {
    const a = qk(m1.n[0])/1e6, b = qk(m1.n[1])/1e6; const d = a*p[0]+b*p[1];
    console.log(" p", p, "onLine:", onLine(m1, p), "linesThrough finds it:", st.linesThrough(p).some(x => lineKey(x) === lineKey(m1)), `| qk(d') = ${qk(d)} vs qk(l.d) = ${qk(m1.d)}`);
  }
  // A genuine O7: fold the left edge onto itself so that (0.2,0) lands on x+y=0.5  =>  y = 0.15
  st.addLine(LP([0.2, 0], [0, 0.2]), "cp"); // x+y = 0.2, gives point (0.2,0) without creating a P point on m1 at the landing spot
  const l = LP([0, 0.15], [1, 0.15]);
  const r = reflectPt(l, [0.2, 0]);
  console.log("target y=0.15: reflect((0.2,0)) =", r, "on x+y=0.5:", onLine(m1, r), "in P:", st.hasPoint(r), "fold∩left-edge in paper: yes");
  console.log("construct ->", construct(st, l), "(expected 7: a valid O7 / RF RefLine_L2L_P2L)");
}

console.log("\n=== E: other probes ===");
{
  // O5 with pivot ON the landing line (RF rejects: l1.Intersects(p2)); spike accepts
  const st = new State(1, 1);
  st.addLine(LP([0.5,0],[0.5,1]), "cp"); // x=0.5 -> pivot (0.5,0) on bottom edge
  // fold corner (0,0)... choose p=(0,1)? reflect must land on bottom edge with crease through (0.5,0): circle radius |p-(0.5,0)|
  // p = (0,0): |p - pivot| = 0.5 -> lands at (1,0) which is in P -> O2. use p=(0.5,1)?? on x=0.5 . use p = (0,1): radius sqrt(1.25)>1 -> lands off paper.
  // Instead pivot on landing line = x=0.5 : pivot (0.5,0.5)? need it in P: add y=0.5.
  st.addLine(LP([0,0.5],[1,0.5]), "cp");
  // p = (0,0), pivot (0.5,0.5), landing line x=0.5: radius sqrt(0.5) -> lands at (0.5, 0.5±0.7071): (0.5,1.207) out, (0.5,-0.207) out. p=(0,0.5)? on landing? no, on y=0.5. radius 0.5 -> (0.5,1) or (0.5,0): both in P -> O2.
  // p=(1,0)? radius sqrt(0.5) -> out. So use a rectangle-free generic: pivot (0.5,0.5), landing y=0.5, p=(0.25,0)?? need P point: add x=0.25
  st.addLine(LP([0.25,0],[0.25,1]), "cp");
  // p=(0.25,0), pivot (0.5,0.5), landing y=0.5: radius sqrt(0.0625+0.25)=0.559 -> landing (0.5±0.559, 0.5): (1.059) out, (-0.059) out. meh.
  // p=(0.25,1): same. p=(0.25,0.5) on landing. Use landing x=0.5 with pivot (0.5,0.5): p=(0.25,0): radius .559 -> (0.5, 0.5±0.559): (0.5,1.059) out,( 0.5,-0.059) out.
  // pivot (0.5,0), landing x=0.5? pivot on landing. p=(0.25,0.5)? radius sqrt(.0625+.25)=.559 -> (0.5, ±0.559): (0.5,0.559) in paper, not in P.
  const l = (() => { const p=[0.25,0.5], r=[0.5,Math.sqrt(0.0625+0.25)]; const mid=[(p[0]+r[0])/2,(p[1]+r[1])/2]; const d=[r[0]-p[0], r[1]-p[1]]; return LP(mid, [mid[0]-d[1], mid[1]+d[0]]); })();
  console.log("O5 pivot-on-landing-line: construct ->", construct(st, l), "| pivot (0.5,0) on l:", onLine(l,[0.5,0]), "| RF RefLine_P2L_C2P rejects because l1.Intersects(p2)");
}
