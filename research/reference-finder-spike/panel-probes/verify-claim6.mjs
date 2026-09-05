import { createFinder } from "./rf.mjs";
const f = await createFinder({ rank: 5 });
console.log(`build ${f.buildMs.toFixed(0)}ms`);
const summarize = (s) => {
  const lineSteps = s.steps.filter(st => st.axiom > 0).length;
  const markSteps = s.steps.filter(st => st.axiom === 0).length;
  const perDgm = s.diagrams.map(d => ({
    valley: d.filter(e => e.type === 1 && e.style === 3).length,
    pinch: d.filter(e => e.type === 1 && e.style === 7).length,
    hilite: d.filter(e => e.type === 1 && e.style === 2).length,
  }));
  let consecutiveMarks = 0;
  for (let i = 1; i < s.steps.length; i++) if (s.steps[i].axiom === 0 && s.steps[i-1].axiom === 0) consecutiveMarks++;
  return { err: s.err, rank: s.rank, nSteps: s.steps.length, lineSteps, markSteps, nDgms: s.diagrams.length, perDgm, consecutiveMarks, steps: s.steps.map(st => `${st.axiom}${st.pinch ? 'p' : ''}:${st.x}`).join(' ') };
};
console.log("--- line query = main diagonal");
for (const s of (await f.solveLine([0,0],[1,1],{count:2})).solutions) console.log(JSON.stringify(summarize(s)));
console.log("--- mark query = corner (0,0)");
for (const s of (await f.solvePoint(0,0,{count:2})).solutions) console.log(JSON.stringify(summarize(s)));
console.log("--- mark query = center");
for (const s of (await f.solvePoint(0.5,0.5,{count:2})).solutions) console.log(JSON.stringify(summarize(s)));
console.log("--- mark query = (0.3, 0.7)");
for (const s of (await f.solvePoint(0.3,0.7,{count:3})).solutions) console.log(JSON.stringify(summarize(s)));
console.log("--- line query = x=1/3");
for (const s of (await f.solveLine([1/3,0],[1/3,1],{count:3})).solutions) console.log(JSON.stringify(summarize(s)));

// random sweep
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const stats = { lineSol: 0, markSol: 0, lineDgmMismatch: 0, markDgmNotPlusOne: 0, dgmValleyNot1: 0, dgmValleyPlusPinchNot1: 0, pinchStyleMismatch: 0, consecutiveMarkSol: 0, orphanFirstMark: 0, examples: [] };
for (let q = 0; q < 150; q++) {
  const isLine = q % 2 === 0;
  const res = isLine ? await f.solveLine([rnd(), rnd()], [rnd(), rnd()], { count: 5 }) : await f.solvePoint(rnd(), rnd(), { count: 5 });
  for (const s of res.solutions) {
    const lineSteps = s.steps.filter(st => st.axiom > 0);
    const nLine = lineSteps.length;
    if (isLine) { stats.lineSol++; if (s.diagrams.length !== nLine) { stats.lineDgmMismatch++; stats.examples.push(['lineDgm', summarize(s)]); } }
    else { stats.markSol++; if (s.diagrams.length !== nLine + 1) { stats.markDgmNotPlusOne++; stats.examples.push(['markDgm', summarize(s)]); } }
    // valley count per line diagram (exclude trailing mark diagram for mark queries)
    s.diagrams.slice(0, nLine).forEach((d, j) => {
      const v = d.filter(e => e.type === 1 && e.style === 3).length;
      const p = d.filter(e => e.type === 1 && e.style === 7).length;
      if (v !== 1) stats.dgmValleyNot1++;
      if (v + p !== 1) { stats.dgmValleyPlusPinchNot1++; stats.examples.push(['vp', j, summarize(s)]); }
      const step = lineSteps[j];
      if ((!!step.pinch) !== (p === 1)) { stats.pinchStyleMismatch++; stats.examples.push(['pinch', j, summarize(s)]); }
    });
    let cm = 0; for (let i = 1; i < s.steps.length; i++) if (s.steps[i].axiom === 0 && s.steps[i-1].axiom === 0) cm++;
    if (cm) { stats.consecutiveMarkSol++; if (stats.examples.length < 12) stats.examples.push(['consecutive', summarize(s)]); }
  }
}
console.log("--- sweep", JSON.stringify({ ...stats, examples: undefined }));
for (const e of stats.examples.slice(0, 8)) console.log(JSON.stringify(e));
process.exit(0);
