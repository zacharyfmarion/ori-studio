# Connected spread triangulation precision

## Goal

Allow Chipmunk step 13 to use Default spread without rejecting a valid pose or
losing vertices along shared creases.

## Approach

The failure comes from an almost collinear Earcut triangle, made nonzero by
Float32 coordinate conversion, followed by height rounding that amplifies its
computed slope. Preserve the original material topology: restore any boundary
vertices Earcut omits and flip an internal diagonal when it replaces a sliver
with better conditioned triangles. Keep well conditioned triangulations intact.
Retain solved heights in double precision through validation and projection;
only the renderer needs Float32 buffers. Keep the objective and acceptance
limits unchanged.

## Affected Areas

- Canonical spread source triangulation, shared by solve and rendering.
- Rust spread solve output precision and regression tests.
- External Chipmunk step 13 reproduction; no corpus files committed.

## Checklist

- [x] Reproduce the exact failure with the production WASM and saved file.
- [x] Preserve crease boundary vertices while repairing degenerate triangulation.
- [x] Preserve solved height precision and add numerical regression coverage.
- [x] Rebuild WASM and verify the saved step through the production path.
- [ ] Run relevant checks and update the existing PR.

The exact saved step now solves in about 7 ms in the rebuilt WASM, keeping all
20 material vertices and 22 triangles. Its maximum slope is 0.133 (limit 0.351)
and relative warp 0.0309 (limit 0.051). Canary's actual Pose screen successfully
switches Affine to Default and finishes capture as “Up to date.” The local test
loader substitutes only the file picker; project import and subsequent UI are
the production app. The original OSF is untouched.

Synthetic regressions cover internal diagonal repair, boundary-chain restoration
in both orientations, concavity, ordinary triangulation stability, legitimate
narrow faces, and rejection of fully collinear faces. A separate Rust book-fold
test reproduces the old rounded-height slope rejection (0.699); keeping doubles
produces a valid 0.182 slope without weakening acceptance limits.
