# @treemaker/origami-simulator

Standalone FOLD-in origami simulation library for browser applications.

The package boundary is intentionally clean:

- no React dependency
- no Tauri or file-system behavior
- no TreeMaker model dependency
- a WebGL2 GPU solver (`WebglSolver`) and mesh renderer that draws straight
  from the position texture, alongside the CPU `ReferenceSolver`

The dynamic solver is a modern TypeScript CPU port of Amanda Ghassaei's
[Origami Simulator](https://github.com/amandaghassaei/OrigamiSimulator)
MIT implementation, with the app/UI layer removed and the public API reshaped
into a reusable module. This is not an independent physics approximation: the
solver keeps Origami Simulator's relative-position state model and mirrors the
original dynamic shader pass order (`normalCalc`, `thetaCalc`,
`updateCreaseGeo`, `velocityCalc`, `positionCalc`) from upstream commit
`7855983a613c879c171b2b1557f8cd102d2640cf`.

The port follows the original dynamic solver equations for model
centering/scaling, adaptive timestep from beam natural frequency, beam
spring/damping forces, crease-angle forces, triangular face-angle forces,
continuous crease angle unwrapping, and dynamic crease geometry updates.

The original WebGL shader solver remains the algorithmic source of truth for
this package. Any future GPU path should preserve the same public API and
fixture behavior.

License: MIT.
