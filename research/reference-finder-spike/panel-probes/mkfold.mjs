// write a .fold whose edges are the given lines clipped to the unit square (+ 4 border edges)
import { writeFileSync } from "node:fs";
import { V, H, T } from "./probe.mjs";
import { intersect } from "./geom.mjs";
const clip = (l) => { const E=[{n:[1,0],d:0},{n:[1,0],d:1},{n:[0,1],d:0},{n:[0,1],d:1}]; const ps=[]; for (const e of E){const p=intersect(l,e); if(p&&p[0]>-1e-9&&p[0]<1+1e-9&&p[1]>-1e-9&&p[1]<1+1e-9&&!ps.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<1e-9)) ps.push(p);} return ps.slice(0,2); };
const D1 = T([0,0],[1,1]), D2 = T([0,1],[1,0]);
const sets = { g3d_x19: [V(1/3), V(2/3), H(1/3), H(2/3), D1, D2, V(1/9)], x13_x38: [V(1/3), V(3/8)], x13_diag_pair: [V(1/3), T([0,0],[1,1/3])], g3d_x112: [V(1/3), V(2/3), H(1/3), H(2/3), D1, D2, V(1/12)] };
for (const [name, ls] of Object.entries(sets)) {
  const vc = [[0,0],[1,0],[1,1],[0,1]], ev = [[0,1],[1,2],[2,3],[3,0]], ea = ["B","B","B","B"];
  for (const l of ls) { const [a,b] = clip(l); vc.push(a,b); ev.push([vc.length-2, vc.length-1]); ea.push("M"); }
  writeFileSync(`${name}.fold`, JSON.stringify({ file_spec: 1.1, vertices_coords: vc, edges_vertices: ev, edges_assignment: ea }));
}
