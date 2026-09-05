import { createFinder } from "./rf.mjs";
const lines = (n) => Array.from({length:n}, (_, i) => { const t = (i + 1) / (n + 1); return i % 2 ? [[t, 0], [t, 1]] : [[0, t], [1, t]]; });
const marks = (n) => Array.from({length:n}, (_, i) => [((i * 7) % 11 + 1) / 12, ((i * 5) % 13 + 1) / 14]);
for (const n of [0, 5, 10]) { const f = await createFinder({ rank: 6, seedLines: lines(n) }); console.log(`seed lines=${n}: build ${(f.buildMs/1000).toFixed(1)} s`, f.dbInfo); }
for (const n of [20, 50]) { const f = await createFinder({ rank: 6, seedMarks: marks(n) }); console.log(`seed marks=${n}: build ${(f.buildMs/1000).toFixed(1)} s`, f.dbInfo); }
process.exit(0);
