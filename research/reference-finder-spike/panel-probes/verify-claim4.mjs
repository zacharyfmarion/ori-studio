import { createFinder } from "./rf.mjs";
const show = (label, r) => {
  console.log(`\n## ${label}  (${r.ms.toFixed(0)}ms, ${r.solutions.length} sols)`);
  for (const s of r.solutions.slice(0, 3)) {
    console.log(`  rank=${s.rank} err=${s.err} steps=${JSON.stringify(s.steps)} diagrams=${s.diagrams?.length}`);
    if (s.steps.length === 0) console.log("    diagram0 lines:", JSON.stringify((s.diagrams?.[0] ?? []).filter(e => e && e.type === 1)));
  }
};
{
  const f = await createFinder({ rank: 4 });
  console.log("SQUARE built", f.buildMs.toFixed(0), "ms", f.dbInfo);
  show("diagonal sw_ne target", await f.solveLine([0,0],[1,1]));
  show("edge y=0 target", await f.solveLine([0,0],[1,0]));
  show("midline x=0.5", await f.solveLine([0.5,0],[0.5,1]));
  show("center point", await f.solvePoint(0.5,0.5));
  show("edge midpoint (0.5,0)", await f.solvePoint(0.5,0));
  show("corner (0,0)", await f.solvePoint(0,0));
  show("point (0.25,0.25) on diagonal", await f.solvePoint(0.25,0.25));
  show("line perpendicular to diagonal through (0.25,0.25)", await f.solveLine([0.25,0.25],[0,0.5]));
}
{
  const W = 0.866, H = 1;
  const f = await createFinder({ rank: 4, width: W, height: H });
  console.log("\nRECT 0.866x1 built", f.buildMs.toFixed(0), "ms", f.dbInfo);
  show("corner diagonal (0,0)-(W,H)", await f.solveLine([0,0],[W,H]));
  show("45deg line from (0,0)", await f.solveLine([0,0],[W,W]));
  show("center (W/2,H/2)", await f.solvePoint(W/2,H/2));
  show("center via 45?: point (W/2, W/2)", await f.solvePoint(W/2,W/2));
}
{
  const f = await createFinder({ rank: 3, seedMarks: [[0.3,0.3]], seedLines: [[[0,0.2],[1,0.2]]] });
  console.log("\nSEEDED built", f.buildMs.toFixed(0), "ms", f.dbInfo);
  show("seeded mark itself (0.3,0.3)", await f.solvePoint(0.3,0.3));
  show("seeded line y=0.2", await f.solveLine([0,0.2],[1,0.2]));
  show("intersection of seeded line & diagonal (0.2,0.2)", await f.solvePoint(0.2,0.2));
  show("intersection of seeded line & left edge (0,0.2)", await f.solvePoint(0,0.2));
  show("line through seeded mark and corner", await f.solveLine([0,0],[0.3,0.3]));
  show("line through seeded mark perpendicular to seeded line", await f.solveLine([0.3,0.3],[0.3,1]));
}
process.exit(0);
