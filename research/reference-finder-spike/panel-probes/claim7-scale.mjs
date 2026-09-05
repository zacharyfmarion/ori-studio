// Extend cand9 (A via v, B via {h,x'}) with a third line A2 that costs 1 via d or d' only, is enabled by {h,x',B,A},
// and does not make B cheaper. Then verify with RF (claim7-verify machinery) by writing a spec file.
import { writeFileSync } from "node:fs";
import { lineFromPoints, lineKey, State, construct } from "./spike-lib.mjs";
const src = await import("./claim7-search-lib.mjs");
const { forward, mk, desc, U1 } = src;
const A = lineFromPoints([0, 0.625], [1, 0.125]), B = lineFromPoints([0, 0.5], [0.875, 1]);
const v = lineFromPoints([0.5, 0], [0.5, 1]), h = lineFromPoints([0, 0.5], [1, 0.5]), xp = lineFromPoints([0.375, 0], [0.875, 1]);
const d = lineFromPoints([0, 0], [1, 1]), dp = lineFromPoints([0, 1], [1, 0]);
const stAlt = mk([h, xp, B, A]);
const stG = mk([v, A]);
const fwdG = forward(stG);
const out = [];
for (const alpha2 of [d, dp]) {
  const c1 = forward(mk([alpha2]));
  for (const [k, A2] of c1) {
    if (U1.has(k)) continue;
    // unique aux: not constructible with v, h, or the other diagonal alone, nor from (v, A)
    if ([v, h, alpha2 === d ? dp : d].some(a => forward(mk([a])).has(k))) continue;
    if (fwdG.has(k)) continue;
    if (!construct(stAlt, A2)) continue;
    // B must still cost >= 2 given (v, A, alpha2, A2)
    const stG2 = mk([v, A, alpha2, A2]);
    const f2 = forward(stG2);
    if (f2.has(lineKey(B))) continue;
    let cheap = false;
    for (const [, y] of f2) if (forward(mk([v, A, alpha2, A2, y])).has(lineKey(B))) { cheap = true; break; }
    if (cheap) continue;
    out.push({ A2: desc(A2), alpha2: desc(alpha2), line: A2 });
  }
}
console.log(out.length, "A2 candidates"); for (const o of out.slice(0, 20)) console.log(JSON.stringify({ A2: o.A2, alpha2: o.alpha2 }));
writeFileSync("./claim7-scale.json", JSON.stringify(out.map(o => o.line)));
