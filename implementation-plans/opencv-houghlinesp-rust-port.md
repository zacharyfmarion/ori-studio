# OpenCV HoughLinesP Rust Port Plan

## Goal

Port OpenCV's CPU `HoughLinesP` behavior to Rust closely enough that the Rust
output is identical to Python OpenCV's `cv2.HoughLinesP` output for the same
binary masks and parameters.

This is a decoder-quality project, not a product shortcut. The Rust port should
not be wired into the browser CP detector until the oracle tests pass.

## Source Of Truth

Target OpenCV source:

- `modules/imgproc/src/hough.cpp`
- Public wrapper: `HoughLinesP`
- CPU implementation: `HoughLinesProbabilistic`
- Helper behavior: `computeNumangle`, trig-table construction, `cvRound`, and
  `cv::RNG::uniform`

Primary references:

- OpenCV `computeNumangle` and trig table:
  https://codebrowser.dev/opencv/opencv/modules/imgproc/src/hough.cpp.html#72
- OpenCV `HoughLinesProbabilistic` entry:
  https://codebrowser.dev/opencv/opencv/modules/imgproc/src/hough.cpp.html#490
- OpenCV CPU accumulator/mask/nonzero collection:
  https://codebrowser.dev/opencv/opencv/modules/imgproc/src/hough.cpp.html#536
- OpenCV random point processing and accumulator voting:
  https://codebrowser.dev/opencv/opencv/modules/imgproc/src/hough.cpp.html#568
- OpenCV fixed-point line walking, clearing, and output:
  https://codebrowser.dev/opencv/opencv/modules/imgproc/src/hough.cpp.html#608
- OpenCV public `HoughLinesP` wrapper:
  https://codebrowser.dev/opencv/opencv/modules/imgproc/src/hough.cpp.html#946
- OpenCV license:
  https://github.com/opencv/opencv/blob/4.x/LICENSE

## Scope

Implement the CPU `Mat` path that Python uses for NumPy-backed `cv2.HoughLinesP`
calls. Do not implement OpenCV's OpenCL `UMat` path or IPP path for browser
runtime. Those branches are backend acceleration paths, not the browser-safe
target.

The target API should live in a new Rust module, likely:

```text
crates/oristudio-cp-detect/src/opencv_hough_lines_p.rs
```

Proposed public surface after parity:

```rust
pub struct HoughLinesPConfig {
    pub rho: f32,
    pub theta: f32,
    pub threshold: i32,
    pub min_line_length: f64,
    pub max_line_gap: f64,
    pub lines_max: i32,
}

pub struct HoughSegment {
    pub x1: i32,
    pub y1: i32,
    pub x2: i32,
    pub y2: i32,
}

pub fn hough_lines_p_opencv_cpu(
    image: &[u8],
    width: usize,
    height: usize,
    config: &HoughLinesPConfig,
) -> Result<Vec<HoughSegment>, HoughError>;
```

Do not expose this as the detector default until the exact oracle gate passes.

## Porting Rules

- Preserve OpenCV license attribution in the Rust module header.
- Port the algorithmic behavior, not a simplified approximation.
- If a dependency behavior is unknown, stop and mark it as not implemented. Do
  not fill the gap with a plausible local sketch.
- Keep the implementation private or test-only until complete.
- Do not remove the current imageproc/custom spike until the OpenCV-port module
  has passed oracle tests and graph metrics.
- Do not tune CP graph thresholds to hide Hough mismatches.

## Required 1:1 Functionality

Status legend:

- `Not implemented`: no code should claim this behavior yet.
- `In progress`: code exists but oracle parity is not proven.
- `Complete`: exact oracle parity is proven for the relevant fixture set.

| Area | Status | Required behavior |
| --- | --- | --- |
| License attribution | Not implemented | Add OpenCV copyright/license notice to the Rust module. |
| Public wrapper rounding | Not implemented | Match `HoughLinesP` conversion of `minLineLength` and `maxGap` through OpenCV `cvRound`. |
| Argument validation | Not implemented | Match required constraints for 8-bit single-channel input, positive `rho`, positive `theta`, and sensible dimensions. |
| `computeNumangle` | Not implemented | Match OpenCV angle-bin count and the duplicate-PI-bin removal rule. |
| Trig table | Not implemented | Use `cos(n * theta) * irho` and `sin(n * theta) * irho`, stored as `f32`, matching OpenCV's table shape. |
| `numrho` | Not implemented | Match `cvRound(((width + height) * 2 + 1) / rho)`. |
| Accumulator layout | Not implemented | Use `numangle * numrho` signed integer storage and OpenCV's `r + (numrho - 1) / 2` indexing. |
| Mask layout | Not implemented | Build a mutable `width * height` byte mask with `1` for nonzero source pixels and `0` otherwise. |
| Nonzero point order | Not implemented | Collect points in row-major `(x, y)` order exactly as OpenCV does. |
| OpenCV RNG | Not implemented | Port `cv::RNG((uint64)-1)` and `uniform(0, count)` exactly. This is mandatory because line order and suppression depend on it. |
| Random point removal | Not implemented | Match OpenCV's swap-with-last removal from `nzloc` before processing the point. |
| Cleared-point skip | Not implemented | Skip a selected point if its mask cell has already been cleared by an accepted line. |
| Per-point voting | Not implemented | Increment accumulator votes for all angles from the selected point, track `max_val` and `max_n`, and continue if `max_val < threshold`. |
| Fixed-point walker | Not implemented | Port the `shift = 16` line walker exactly, including x-major/y-major branch, signed `dx0/dy0`, and `>> shift` behavior. |
| Endpoint discovery | Not implemented | Walk both directions from the seed point, stop at image bounds or when gap exceeds `lineGap`, and record the last nonzero endpoint per direction. |
| Good-line test | Not implemented | Accept when x-span or y-span is at least `lineLength`, matching OpenCV's `||` condition. |
| Mask clearing pass | Not implemented | Walk both directions again; clear every encountered nonzero mask pixel. |
| Accumulator decrement | Not implemented | Only for accepted lines, decrement every angle accumulator bucket for each cleared nonzero pixel. |
| Output order | Not implemented | Push `Vec4i(x1, y1, x2, y2)` in OpenCV's accepted order and stop at `linesMax`. |
| Degenerate cases | Not implemented | Match empty masks, weak masks, short segments, one-pixel noise, dense masks, and line gaps. |
| No OpenCL/IPP branch | Complete | Explicitly out of browser-runtime scope; oracle calls must force normal CPU/Mat behavior. |

## Oracle Strategy

Python OpenCV is the oracle. The Rust port is correct only when it matches the
oracle's raw segment output.

### Oracle Script

Add:

```text
scripts/cp-detect/export-houghlinesp-oracle.py
```

The script should:

- read one or more binary mask images or PGM files;
- call `cv2.HoughLinesP(mask, rho, theta, threshold, minLineLength, maxLineGap)`;
- force CPU-style usage by passing NumPy arrays, not `UMat`;
- call `cv2.ocl.setUseOpenCL(False)` defensively;
- write ordered `[[x1, y1, x2, y2], ...]` JSON;
- record OpenCV version and build information relevant to OpenCL/IPP.

### Exactness Levels

Use three comparison modes, but only one release gate:

| Mode | Purpose | Pass condition |
| --- | --- | --- |
| Exact ordered | True parity target | Same segment count, same order, same integer endpoints. |
| Exact unordered | Debug only | Same endpoints but different order; indicates RNG/order mismatch. |
| Geometry-equivalent | Debug only | Similar lines but different endpoints; indicates algorithm mismatch. |

The release gate is exact ordered parity. The looser modes are diagnostic tools,
not acceptance criteria.

### Fixture Sets

Add deterministic fixtures in increasing difficulty:

- tiny masks:
  - empty image;
  - single point;
  - short line below `minLineLength`;
  - one horizontal line;
  - one vertical line;
  - one diagonal line;
  - one line with a gap just below `maxLineGap`;
  - one line with a gap just above `maxLineGap`;
- interaction masks:
  - crossing diagonals;
  - parallel close lines;
  - T-junction;
  - border-touching segments;
  - line plus isolated noise;
  - dense grid;
- CP masks:
  - the 5 exported real-world V2 line masks;
  - at least 20 synthetic CP masks from the detector dataset;
  - dark/faint/dashed issue masks if available from the V2 evidence exporter.

Small fixture masks and oracle JSON may be committed only if they are tiny and
deterministic. Large real-world evidence stays under ignored `artifacts/`.

## Checkpoints

Each checkpoint ends with a commit.

### Checkpoint 0: Plan

- Add this plan.
- Link it from the broader Rust CP detector parity roadmap.
- No implementation code.

### Checkpoint 1: Oracle Harness

- Add `export-houghlinesp-oracle.py`.
- Add Rust comparison CLI or test helper:

```text
cargo run -p oristudio-cp-detect --bin compare_houghlinesp_oracle -- ...
```

- Generate tiny deterministic oracle fixtures.
- Confirm the current custom Rust spike fails exact parity, so the harness can
  catch non-parity.
- Commit.

### Checkpoint 2: OpenCV Primitive Helpers

Implement only helper primitives with unit tests:

- `cv_round`;
- `compute_numangle`;
- trig table;
- accumulator indexing;
- row-major nonzero collection;
- fixed-point coordinate conversion helpers;
- OpenCV RNG and `uniform(0, count)`.

All helper behavior must be covered by tests derived from OpenCV oracle outputs
or direct known values. Do not implement the full detector in this checkpoint.
Commit.

### Checkpoint 3: Private CPU Port

- Add the private `hough_lines_p_opencv_cpu` implementation.
- Keep it unused by the product decoder.
- Add exact oracle tests for tiny fixtures.
- Fix helper behavior until tiny fixtures are exact ordered matches.
- Commit only after tiny fixture parity passes.

### Checkpoint 4: Real Mask Segment Parity

- Run exact ordered parity against exported V2 line masks.
- Add diagnostics for any mismatch:
  - first divergent segment index;
  - ordered vs unordered match result;
  - endpoint delta summary;
  - OpenCV/Rust line counts;
  - optional rendered mismatch PNG under ignored `artifacts/`.
- Do not wire into graph decoding unless exact ordered parity passes or a
  carefully documented platform-level source of non-identical `libm` behavior is
  isolated and accepted.
- Commit.

### Checkpoint 5: Replace Segment Evidence In Decoder

Only after Checkpoint 4 passes:

- Replace current Rust Hough segment extraction with the OpenCV-compatible port.
- Keep a config flag for temporary A/B testing, but make the OpenCV-compatible
  path the only candidate for browser parity.
- Re-run:
  - segment parity;
  - browser-vs-Python real-smoke metrics;
  - named duck image visual comparison;
  - WASM/native equivalence.
- Commit.

### Checkpoint 6: Product Gate

- If graph metrics improve materially and visual output is coherent, continue
  with topology parity work.
- If segment parity is exact but graph metrics remain poor, the blocker moved
  downstream; update the roadmap with the new evidence.
- If exact segment parity cannot be reached without unacceptable browser cost,
  stop and evaluate OpenCV.js or model-output changes explicitly.

## Acceptance Criteria

Before the port can be considered complete:

- Exact ordered parity on all tiny deterministic masks.
- Exact ordered parity on the 5 real-world V2 evidence masks.
- At least 95% exact ordered parity on a larger synthetic CP mask set, with every
  mismatch triaged and documented.
- No product-runtime dependency on Python or native OpenCV.
- Browser WASM build still succeeds.
- Full graph metrics improve or the remaining blocker is clearly downstream of
  segment extraction.

## Current State

Checkpoint 1 is complete:

- added `export-houghlinesp-oracle.py`;
- added `compare_houghlinesp_oracle`;
- generated committed tiny OpenCV oracle fixtures;
- confirmed the existing `segments.rs` custom Hough spike fails exact ordered
  parity on the tiny oracle set, as expected.

Everything in the 1:1 functionality table is currently `Not implemented` except
the explicit decision to exclude OpenCL/IPP runtime branches. The existing
`segments.rs` custom Hough spike is diagnostic only and should not be treated as
an OpenCV port.
