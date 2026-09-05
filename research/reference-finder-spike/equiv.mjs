import { createFinder } from "./rf.mjs";
const f = await createFinder({ rank: 6 });
const targets = [[0.5,0.5],[1/3,1/3],[0.4,0.7],[1/Math.sqrt(2),0.25],[0.123,0.789],[2/5,3/7],[0.618034,0.381966],[0.05,0.95]];
const lines = [[[0,0.25],[1,0.75]],[[0.2,0],[0.9,1]],[[0,1/3],[1,1/3]]];
const out = { build: Math.round(f.buildMs), db: f.dbInfo, points: [], lines: [] };
for (const [x,y] of targets) { const r = await f.solvePoint(x,y,{count:5}); out.points.push(r.solutions.map(s=>[s.err,s.rank,s.steps.length,JSON.stringify(s.steps)])); }
for (const [a,b] of lines) { const r = await f.solveLine(a,b,{count:5}); out.lines.push(r.solutions.map(s=>[s.err,s.rank,s.steps.length,JSON.stringify(s.steps)])); }
console.log(JSON.stringify(out));
process.exit(0);
