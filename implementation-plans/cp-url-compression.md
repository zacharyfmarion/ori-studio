# Crease-Pattern URL Compression (share links)

## Goal

Encode an Ori Studio crease pattern into a base64url payload small enough to live in a URL
**fragment**, such that opening the link reconstructs a document whose flat-foldability
diagnostics are **identical** to the source document's — no spurious Kawasaki / Maekawa / CAMV
violations, and no accidentally *repaired* ones either.

Concrete targets:

| Target | Value |
| --- | --- |
| Transport | `https://<host>/edit#c=<base64url, unpadded>` — fragment, never query |
| Size goal | median CP under **~800 total URL chars**, p90 under **~2,000** (Discord's cap, RFC 5322's 998-octet line, the IE-heritage 2,083) |
| Correctness | diagnostic-set equality against `check4` / `check_camv_task` (`crates/oristudio-cp/src/checks.rs:224,232`) — see "Precision acceptance criterion" |
| Tail | anything that does not fit is a **server-stored short link**, not a bigger URL |
| Bundle cost | **zero** new wasm bytes for stages 1–2 (browser `CompressionStream`); ≤25 KB for stage 3 |

Non-goals: repairing a broken CP; carrying `.osf` session state (images, annotations, inline
simulations, `viewState`); desktop deep links (v1 is web-only — `apps/web/src/routing/appRouter.tsx:85-88`
uses `createMemoryRouter`, so the desktop shell has no URL at all).

---

## Approach

### The one-paragraph summary

Represent the CP as **two integer coordinate alphabets plus an integer-indexed vertex table plus an
integer-indexed edge list**, compress the resulting varint streams, and put the result in the
fragment. Every predictor in the codec operates in an exact integer space, so reconstruction is
bit-identical to the encoder's intent and no error accumulates across delta chains. The only lossy
step is the choice of coordinate quantum, and that quantum is derived **per document** from an
analytic bound on the Kawasaki residual, so the precision criterion is provable rather than merely
measured. Stage 1 ships that and already beats gzipping the `.cp` text by ~3.5×. Stage 2 replaces
the explicit edge list with a per-vertex direction bitmask over decoder-derived "next vertex along
this ray" successors, which cuts the largest stream by ~60%. Stage 3 replaces the generic deflate
with an adaptive range coder and a causal-template occupancy bitmap for the vertex table. Each stage
is a new `format_version` byte; old links keep decoding forever.

### What this design takes from the four candidate codecs, and what it drops

| Idea | Source | Verdict |
| --- | --- | --- |
| Fragment, unpadded base64url, 4-byte magic, hard reject | all four | **Keep** |
| Integer alphabets + `(xi, yi)` index-pair vertex identity + exact prefix-sum reconstruction | `generic` | **Keep — this is the skeleton** |
| Column-run vertex table, degree+gap adjacency, 1-bit M/V + escape list, derived border with the both-directions guard | `generic` | **Keep** (well-tuned, reproduced byte-for-byte by its own critic) |
| Canonicalise scalars before quantising | `lattice`, `generic`, `graph` | **Keep**, but complete-linkage and tied to the quantum, not a magic constant |
| Direction table stored as **vertex index pairs**, never as angles | `graph` | **Keep** — kills the direction-quantum failure that shattered carriers in `lattice` |
| Candidate-pruned per-vertex direction mask over decoder-derived `consec` | `graph` | **Keep (stage 2)** — 6.13 → 1.61 bits/crease measured |
| Range coder + causal-template occupancy bitmap + KT assignment hierarchy | `graph` | **Keep (stage 3)** |
| Mandatory encode-time decode-and-compare with demotion to a residual stream | `lattice` (built), `graph` (claimed, never built) | **Keep, and actually build it** |
| Algebraic `Z[√2]`/`Z[√3]` module alphabet | `lattice` | **Drop** — see Rejected alternatives |
| Carrier/constraint propagation with seeded ρ | `constraint` | **Drop** — see Rejected alternatives |
| brotli, and brotli custom dictionaries | `generic` | **Drop** — see Rejected alternatives |
| `.cp` + deflate as the correctness backstop | `constraint`, `generic` | **Drop**; the backstop is `.fold`, because `.cp` cannot represent circles/texts/aux/fold-magnitudes |

### The correction that reframes the whole precision story

`angularly_flatfoldable` computes ray directions from the segment endpoints
(`crates/oristudio-cp/src/checks.rs:1110-1124` via `crates/oristudio-cp/src/geometry/orita_calc.rs:44-66`
— `angle((a,b))` is `acos((b.x-a.x)/|b-a|)`), not from anything a codec stores. So **a stored
direction table is a pure *selector*** — it decides which pairs of vertices become creases, and it
neither costs nor buys anything on the angular bar. Stage 2's direction layer is therefore a purely
size-driven optimisation, and the coordinate quantum is the sole lever on precision *for every design
that stores coordinates literally*.

**That last clause is a real limit on the claim, and an earlier draft of this plan overstated it.**
A design that *derives* vertices — e.g. as the intersection of two exactly-directed anchored lines —
improves the endpoints themselves, and the checker then re-derives a better angle from those better
endpoints. Such a design escapes the quantum through the coordinates rather than around them, and its
precision argument is sound. See "Anchored-line construction DAG" under Open questions: it is not
rejected, it is deferred, and the reason is measured size, not broken precision.

---

## Precision acceptance criterion

### The bar

`Epsilon::FLAT = FACTOR * 1E-4 = 1e-6` (`crates/oristudio-cp/src/geometry/epsilon.rs:8,20`), used as
**degrees** at `checks.rs:930,971,1069,1078,1088,1123,1316,1352` and as **model units** at
`checks.rs:312-314`. Vertex clustering is `Epsilon::UNKNOWN_1EN4 = 1e-6` model units
(`checks.rs:1165-1166`), skipping `Cyan3` (`checks.rs:1177`). The folding face-graph merges at
`Epsilon::POINT = 2.5e-4` (`crates/oristudio-cp/src/geometry/fold_graph.rs:415`).

### The criterion the harness asserts

For every corpus document `D`:

* **P1 — Topology identity, no tolerance.** `point_line_map(decode(encode(D)))` yields the same
  number of vertices as `point_line_map(D)`, and each matched vertex has the same incident-segment
  multiset keyed by `LineColor`. This is what protects Maekawa (`checks.rs:335,452`),
  `NumberOfFolds`, and the `black != 0 && black != 2` boundary rule, all of which are combinatorial.
* **P2 — Angular non-regression, per vertex, matched by identity.** For every interior vertex whose
  source residual `R₀ < 1e-6` deg: `R₁ < 1e-7` **and** `R₁ − R₀ < 1e-7`. The per-vertex form is
  mandatory — the `generic` design's "the codec contributes ≲4.3e-8" was a difference of maxima over
  *different* vertices and its true per-vertex worst case was 2.67e-7, 2.7× over the bar.
* **P3 — Spatial closure.** `vertex_closure_residual(fan).to_degrees() < 1e-7` for every vertex under
  `CLOSURE_RESIDUAL_BAR_DEGREES` (`crates/oristudio-cp/src/lib.rs:2751`) beforehand. For a flat fan
  this is the same quantity as P2; asserted separately because the non-flat checker is separate code.
* **P4 — Positional sanity.** `max_vertex_displacement < 1e-8` model units — 100× under the CAMV
  clustering radius and 25,000× under `Epsilon::POINT`.
* **P5 — Diagnostic-set equality in *both* directions.** No violation created **and none removed**.
  Snapping toward algebraic ideals can accidentally "fix" a vertex; that is still a behaviour change
  and the criterion is equality.
* **P6 — Golden fixtures.** Byte-exact payload for a committed set of documents, asserted from both
  the Rust decoder and the TS mirror.
* **P7 — Crossing preservation.** The set of *transversal crease crossings* (pairs of creases that
  intersect at an interior point which is an endpoint of neither) is identical before and after.
  Quantisation moves vertices, and two creases that merely came close can be pushed into crossing,
  or a grazing crossing can be pulled apart. Neither shows up in P1–P5: `point_line_map`
  (`checks.rs:1165`) builds vertices from segment **endpoints only** and never computes an
  intersection, so a crossing is invisible to CAMV — but it is visible to the folding face graph
  (`crates/oristudio-cp/src/geometry/fold_graph.rs`), to `checks_spatial.rs`, and to the user.
  Cheap to assert with the existing segment-intersection primitives; omitted from every candidate
  design's criterion.

Note P2/P3 are asserted only on vertices that were **clean before the round trip**: a transport must
not fix a pre-existing violation and cannot be blamed for one.

**Two corrections, both from the measured run in "Stage-0 result" below.**

* The "~42% of vertices already fail CAMV" claim in earlier drafts was wrong. That figure
  (`lib.rs:2745-2748`) is the `CLOSURE_RESIDUAL_BAR_DEGREES` bar in `checks_spatial`, which is the
  **non-flat** regime. `spatial_vertex_reports` early-returns empty unless `has_non_classic_creases`
  (`crates/oristudio-cp/src/checks_spatial.rs:721`), so on an all-classic document — every `.cp`
  file, and every Oriedita-compatible CP — it produces **zero reports**. **P3 is therefore not
  applicable to flat crease patterns**, and a harness reporting "0 closure crossings" on this corpus
  is reporting a vacuous zero, not a pass. P3 only becomes testable once the corpus carries non-180°
  fold magnitudes (Open question 4). The stage-0 harness now emits `closure_n` so the distinction
  cannot be misread.
* Real published CPs are overwhelmingly CAMV-clean: **550 of 563** corpus documents report zero
  `check4` violations; the other 13 carry 2,071 between them. So P5's "no violation **removed**"
  direction is exercised by only 13 documents. That is a thin test for a real risk — the extended
  corpus must add deliberately-violating patterns.

### Stage-0 result — MEASURED, 2026-08-03

`cargo run --release -p oristudio-cp --example share_precision -- <corpus>` over all 563 scraped
`.cp` files, using the **real kernel** (`check4`), against payload sizes from the stage-1 prototype.
Because the codec is lossless apart from canonicalise + quantise, this measures the entire precision
question without the codec existing yet.

| `F` | CAMV violations preserved exactly | p50 chars | p90 chars | fits 2000 | **correct AND fits** |
| --- | --- | --- | --- | --- | --- |
| 20 | 117/563 · 20.8% | 750 | 2,358 | 488/563 | 106/563 · 18.8% |
| 24 | 360/563 · 63.9% | 762 | 2,378 | 488/563 | 342/563 · 60.7% |
| 28 | 561/563 · 99.6% | 780 | 2,383 | 486/563 | 486/563 · 86.3% |
| **30** | **563/563 · 100%** | **794** | **2,382** | 485/563 | **485/563 · 86.1%** |
| 32 | 563/563 · 100% | 803 | 2,395 | 483/563 | 483/563 · 85.8% |
| 36 | 563/563 · 100% | 836 | 2,615 | 471/563 | 471/563 · 83.7% |
| 40 | 563/563 · 100% | 968 | 3,038 | 455/563 | 455/563 · 80.8% |

#### Fold-angle documents — the same sweep, with the closure path actually running

The table above is all-classic, so `dispatched_camv` sent every vertex down the flat path. Injecting
a non-classic magnitude into every Nth crease (`share_precision <dir> <F-list> <stride>`) routes the
touching vertices to the **spatial closure** checker instead, at up to 130,942 closure-checked
vertices. Because the closure bar is `1e-6` *degrees*, the metric is max per-vertex `|R₁ − R₀|`:

| `F` | max &#124;ΔR&#124;, 1-in-20 creases | 1-in-5 | every crease | margin vs the 1e-6 bar (worst) |
| --- | --- | --- | --- | --- |
| 26 | 8.80e-7 | 1.73e-6 | 2.01e-6 | **over the bar** |
| 28 | 1.47e-7 | 4.39e-7 | 7.21e-7 | 1.4× — too thin |
| 30 | 8.17e-8 | 9.13e-8 | 1.35e-7 | 7.4× |
| 32 | 1.22e-8 | 5.03e-8 | 5.72e-8 | 17× |
| 36 | 7.30e-10 | 4.70e-9 | 5.21e-9 | 192× |

**This is where the analytic formula's apparent conservatism is earned.** Judged on flat documents
alone, `F = 36` looked six bits wasteful. On the closure path it is the difference between 7× and
192× margin, and `F = 28` — comfortably safe for flat CPs — leaves only 1.4×.

So `F_min` is **regime-dependent**: 30 when every crease is classic, **32 when any crease carries a
fold angle**. The encoder already knows which it is before choosing `F`.

Honest caveat on this sub-table: the injected angles are arbitrary, so the *absolute* residuals are
meaningless and the "0 bar-crossings" the harness reports is optimistic — with random large
residuals, few vertices sit near the bar to be flipped. In a real non-flat design whose vertices
*do* sit near closure, a 2e-6 shift would flip verdicts. `max |ΔR|` is the metric that transfers;
the crossing count is not. A corpus of genuine non-flat designs is still needed (Open question 4).

Findings that change the plan:

1. **`F = 30` is the knee.** 100% CAMV preservation, and the cliff below it is violent, not gradual:
   F=28 → 561/563, F=24 → 64%, F=20 → 21%. At F=20 the transform *creates* 32,992 violations across
   444 documents (worst single document +1,671). A `1e6`-style quantum is not marginally wrong, it
   is catastrophically wrong — which settles the original design question empirically.
2. **The analytic `F` formula is ~6 bits conservative** against this corpus, costing ~5% of payload
   (794 → 836) and 14 documents' worth of 2,000-char fit (485 → 471). That is affordable insurance
   and the formula stays — it is a bound covering short creases and high degrees this corpus may not
   contain — but `F_min` should be **30, not 20**: the measured floor is 30, and 20 is far below
   anything safe.
3. **Answering Open question 2:** violation-set equality *is* achievable, at 100%, from F=30 up. The
   worry that the criterion might be unsatisfiable was unfounded for the *set-equality* form. The
   per-vertex residual form (`R₁ − R₀ < 1e-7`) is still unmeasured.

### The derivation, and the quantum that follows

Let a vertex have degree `n`, shortest incident crease `L_min`, and let each endpoint be displaced by
at most `δ`. Both endpoints of a ray can move anti-parallel and perpendicular, so
`|Δθ| ≤ 2δ/L` radians. Each `θ_i` appears in exactly two alternating sectors of opposite parity, so
the Kawasaki residual obeys

```
R  ≤  2n · (2δ / L_min) · (180/π)  =  229 · n · δ / L_min      degrees
```

Requiring `R < 1e-7` gives `δ < L_min / (2.29e9 · n)`.

The codec's total per-coordinate displacement is `δ = 1.5q` where `q = 2^-F` is the quantum:
`q` from complete-linkage canonicalisation (cluster diameter ≤ `q` by construction) plus `q/2` from
rounding. Therefore

```
q  <  L_min / (3.44e9 · n)                 ⟹     F  ≥  ceil( log2( 3.44e9 · n_max / L_min ) )
```

**The encoder picks `F` per document as**

```
F = clamp(  max( 45 - ceil(log2(span)),                       # ~45 bits over the document extent
                 ceil(log2(3.44e9 * n_max / L_min)) ),        # the analytic P2 bound
            F_min = 20,
            F_max = 53 - ceil(log2(max_abs_coord)) )          # keeps i64 -> f64 exact
```

where `span` is the larger of the x- and y-extents, `n_max` is the maximum interior-vertex degree,
and `L_min` is the shortest crease incident to an interior vertex, all measured **after**
canonicalisation. If the analytic term exceeds `F_max`, the encoder abandons the binary codec and
emits the RAW fallback mode.

Worked values on the corpus:

| document shape | span | n_max | L_min | F | q | analytic R bound |
| --- | --- | --- | --- | --- | --- | --- |
| typical (400 paper) | 400 | 4 | 9.21 | 36 | 1.46e-11 | 2.2e-9 deg |
| corpus worst clean vertex | 400 | 4 | 0.368 | 36 | 1.46e-11 | 5.5e-8 deg |
| corpus worst degree | 400 | 16 | 0.368 | 38 | 3.64e-12 | 5.4e-8 deg |
| adversarial short crease | 400 | 16 | 0.100 | 40 | 9.09e-13 | 5.0e-8 deg |
| unit-square CP (no Oriedita normalisation) | 1 | 4 | 0.023 | 44 | 5.68e-14 | 8.6e-8 deg |

Three things this buys that no candidate design had:

1. **It is a bound, not a fit.** All four candidates chose a constant bit depth and then measured
   whether the corpus survived. `lattice` and `generic` both had to retune a canonicalisation
   constant after the corpus complained; `graph`'s 563/563 result came from exactly that retune.
2. **It is scale-invariant.** `q` is an absolute power of two derived from the document's own extent,
   so the `generic` critique's counterexample — a `.cp` authored at ×0.0025 scale producing 6,910 new
   violations with the encoder's self-check firing zero times — cannot occur. Only FOLD import
   normalises onto ±200 (`crates/oristudio-cp/src/io/fold.rs:295-312`); `.cp` import does not.
3. **`q` and the canonicalisation tolerance are the same number**, so there is exactly one precision
   knob. The `generic` critique showed the two terms are independent and comparable in size, and that
   spending bits on one while leaving the other loose is wasted (`B=44` at `canon 1e-9` asymptotes to
   the `canon`-only floor of 2.1e-7).

**Cost of the criterion, honestly:** at `canon = 1e-9` and 40 bits over 400 the `generic` codec
measures p50 = 752 base64 chars (deflate). Tightening to this plan's `F`/`τ_C` costs a measured +5.6%
corpus-sum / +11.9% p90 for the canonicalisation change and +1.9% for the extra coordinate bits —
about **+8% at p50 and +14% at p90**. That is the price of the 10× margin, and it is worth paying:
the worst *pre-round-trip* clean-vertex residual in the corpus is 1.88e-7 deg under the repo's own
`acos` angle formula, so a bare `R₁ < 1e-6` assertion has only ~5× headroom and will flake in CI.

### What is not on the critical path

Vertex clustering (`checks.rs:1166`, 1e-6 units), CAMV incidence (`checks.rs:312`, 1e-6 units) and
the face-graph merge (`fold_graph.rs:415`, 2.5e-4 units) are all ≥ 600× looser than the angular
constraint at any `F` this plan can produce. P4 is satisfied by ~1000× margin whenever P2 is. P1 is
satisfied **structurally**, not by tolerance: a vertex is an `(xi, yi)` index pair, so two endpoints
are identical iff their integer indices are identical, and the encoder asserts both alphabets are
strictly ascending after quantisation (bailing to a larger `F` if not).

---

## Format specification

### Transport

```
https://<host>/s#<base64url, unpadded, RFC 4648 §5 alphabet A-Za-z0-9-_>     self-contained
https://<host>/l/<opaque id>                                                 server-stored (stage 4)
```

Fragment, not query: RFC 3986 §3.5 means the payload is never sent to the server, so nginx /
Apache / IIS / Cloudflare / Tomcat request-line limits do not apply, it never appears in an access
log, and it is stripped from cross-origin `Referer`. Putting the payload in the *path* instead
(`/s/<payload>`) would hand all three back, which is why it stays in the fragment even though the
route is dedicated.

**The route is the outermost extension point**, not a fragment key: a server-stored short link is a
different path, not a different `key=`. That also means the payload needs no prefix — `/s` already
says what it is, and the format version lives in the payload's own magic bytes.

Why a dedicated route rather than a fragment on `/edit`: the route table documents that share links
exist, the handling code mounts only when one is opened, and — the load-bearing part — the redirect
to `/edit` strips the payload from the URL on arrival, so a refresh cannot re-import it over work in
progress. That last property removes the reload guard an `/edit#…` design would have needed.

base64url unpadded is 6.000 bits/char exactly, needs no escaping in either query or fragment, avoids
the `URLSearchParams` `+`-as-space trap, is double-click selectable, and survives chat-client
autolinkers. Char count is `ceil(4·bytes/3)` — the *unpadded* formula. (Three of the four candidate
designs reported `4·ceil(bytes/3)`; all their published char counts are 0–3 chars high.)

### Frame (fixed, identical for every `format_version`)

| off | size | field |
| --- | --- | --- |
| 0 | 4 | magic `0x4F 0x43 0x53 0x31` = `"OCS1"` |
| 4 | 1 | `format_version` u8 — 1, 2 or 3 (this plan's stages) |
| 5 | 1 | `compressor` u8 — `0` stored, `1` deflate-raw (RFC 1951), `2` none/body is self-entropy-coded |
| 6 | 4 | `raw_body_len` u32 LE — decompressed body length in bytes |
| 10 | 2 | `frame_flags` u16 LE — bit0 `BODY_CRC_PRESENT`; bits 1–15 reserved, MBZ |
| 12 | 4 | `body_crc32` — CRC-32/IEEE (poly `0xEDB88320`) of the **decompressed** body; present iff bit0 |
| 16.. | — | compressed body |

The decoder hard-rejects, with no partial decode, on: bad magic; unknown `format_version`; unknown
`compressor`; any reserved frame flag set; `raw_body_len > 8 MiB`; `raw_body_len > 4096 ×
compressed_len` (decompression-bomb guard — brotli/deflate compress 64 MiB of zeros to tens of
bytes, and a 72-char link must not be able to allocate 64 MiB); decompressed length ≠ `raw_body_len`;
CRC mismatch. This is the length-validation discipline `CompactGeometry::from_bytes` already applies
(`crates/oristudio-cp/src/geometry_transport.rs:159-197`), which every candidate design cited for its
magic but not for its bounds.

### Forward-compatibility contract

1. The magic is fixed forever. `format_version` selects the **body grammar**. The decoder is a
   registry `{1 => decode_v1, 2 => decode_v2, 3 => decode_v3}`.
2. **A shipped version's decoder is append-only and is never edited.** Any behavioural change —
   including a changed entropy-model context, a changed tolerance, a changed traversal order —
   requires a new `format_version`. This obligation is the real cost of stage 3 and is stated up
   front deliberately.
3. Every body ends with an **extension TLV area**: `uvarint n_ext`, then `n_ext × {uvarint tag,
   uvarint len, len bytes}`. Tags are allocated in one global registry across versions.
   * Tags `< 0x8000` are **ancillary**: an unknown tag is skipped, and the decoder returns
     `skipped_extensions: usize` so the UI can say "this link was created by a newer version of Ori
     Studio; some content was not loaded."
   * Tags `≥ 0x8000` are **critical**: an unknown tag is a hard reject with that message. Anything
     whose omission would make the geometry *wrong* rather than merely *incomplete* is critical.
4. Unknown-version rejection **must not destroy the link**. `takeSharedCpPayload()` stashes the raw
   fragment in a module singleton and in `sessionStorage` *before* calling `history.replaceState`, so
   a failed decode can still show the user their original URL. (The `constraint` critique correctly
   identified that consume-then-replaceState-then-fail-later leaves the user with a blank editor and
   no recoverable link.)

### Body, `format_version = 1` ("index")

All integers are LEB128. `uvarint` is unsigned; `svarint` is zigzag then LEB128. All bit-packed
fields are LSB-first within a byte unless stated, and byte-aligned at the start of each section.

```
HEADER
  u8       version_echo        MUST equal frame.format_version   (guards mis-framing)
  u8       flags               bit0 DERIVED_BORDER
                               bits1-7 reserved, MBZ
  i8       F                   quantum exponent; q = 2^-F ; 8 <= F <= 60
  uvarint  nx, ny, nv, ne

  Structural rejects, all checked before any allocation:
    ne == 0 ; nv < 2 ; nv > 2*ne ; nx > nv ; ny > nv ;
    nx + ny + nv + ne > 8 * remaining_body_bytes      (nothing can be sub-1-bit)

SECTION A  --  X alphabet, nx strictly-ascending i64 values in quantum units
  svarint  X[0]
  uvarint  X[i] - X[i-1]      i = 1..nx-1      MUST be >= 1  (0 => hard reject)

SECTION B  --  Y alphabet, identical shape, ny entries

SECTION C  --  vertex table; vertices ascending by (xi, yi), xi in [0,nx), yi in [0,ny)
  uvarint  ncol                              number of occupied x-indices
  uvarint  col[0]
  uvarint  col[k] - col[k-1]  k = 1..ncol-1  MUST be >= 1
  uvarint  cnt[k]             k = 0..ncol-1  MUST be >= 1 ; sum(cnt) MUST == nv
  for each column k, in order:
    uvarint  y[0]
    uvarint  y[j] - y[j-1]    MUST be >= 1
  Reject if any col >= nx or any y >= ny.

SECTION D  --  adjacency; creases as (lo, hi) vertex-index pairs with lo <= hi,
               stable-sorted lexicographically. This order is the CANONICAL CREASE ORDER
               and is the index space for every per-crease side array in SECTION F.
  uvarint  deg[v]             v = 0..nv-1    creases whose LOW endpoint is v ; sum == ne
  for each v with deg[v] > 0:
    uvarint  hi[0] - v        >= 0   (0 is legal: a degenerate zero-length crease)
    uvarint  hi[j] - hi[j-1]  >= 0   (0 is legal: a duplicate crease)
  Reject if any hi >= nv.

SECTION E  --  colours; one entry per crease in canonical order, EXCLUDING derived borders
  uvarint  nesc
  uvarint  escIdx[0]
  uvarint  escIdx[i] - escIdx[i-1]           MUST be >= 1; indices into the KEPT list
  packed   escVal[i]  4 bits each, ceil(nesc/2) bytes
  packed   MV bitmap  1 bit per non-escaped kept crease, ceil((nkept-nesc)/8) bytes, MSB-first
                      0 => LineColor::Red1 (mountain) ; 1 => LineColor::Blue2 (valley)

  Colour code = LineColor discriminant + 2, giving 0..=12 for the full enum
  (crates/oristudio-cp/src/geometry/line_color.rs:7-21):
      0 Angle(-2)  1 None(-1)  2 Black0  3 Red1  4 Blue2  5 Cyan3  6 Orange4
      7 MagentaX5  8 Green6  9 Yellow7  10 Purple8  11 Brown9  12 Grey10
  Codes 13-15 are reserved -> hard reject.
  Derived-border creases (omitted when flags.DERIVED_BORDER) decode to Black0.

SECTION F  --  extensions
  uvarint  n_ext
  n_ext ×  { uvarint tag, uvarint len, len bytes }
```

**Why 13 colour codes and not `.cp`'s four.** `line_color_to_cp_assignment`
(`crates/oristudio-cp/src/io/cp.rs:70-77`) collapses ten of the thirteen `LineColor` variants to code
`4`, which decodes to `Cyan3`. But `point_line_map` skips **only** `Cyan3` (`checks.rs:1177`), so an
`Orange4` or `None` segment today anchors a vertex, contributes no red/blue/black
(`checks.rs:304-310`), and therefore reports a Maekawa violation. Round-tripping it to `Cyan3`
deletes that vertex from the map and deletes the diagnostic — a P1/P5 failure by construction.
`Assignment::Unassigned` maps to `LineColor::None` (`crates/oristudio-cp/src/model/mod.rs:507`), so
**every CP imported from a FOLD file with `U` edges** hits this. The `.cp`-only corpus was
definitionally unable to expose it.

**DERIVED_BORDER rule.** Let `xmin/xmax` and `ymin/ymax` be the extreme *occupied* alphabet indices.
A crease is *frame-collinear* iff `xi[lo] == xi[hi] ∈ {xmin, xmax}` or `yi[lo] == yi[hi] ∈ {ymin,
ymax}`. The encoder may set the flag **only when frame-collinear ⇔ Black0, in both directions**:
`|frame-collinear| == |Black0| == |frame-collinear ∧ Black0| > 0`. Omitting the second direction
silently reassigns a mountain to a border; it did so on 1 of 563 corpus files during prototyping.

### Extension tag registry (v1)

| tag | class | contents |
| --- | --- | --- |
| `0x0001` | ancillary | `title`, UTF-8 |
| `0x0002` | ancillary | grid: `uvarint grid_size`, `uvarint base_state` (the only two fields that survive a FOLD round trip — `io/fold.rs:212-219`) |
| `0x0003` | ancillary | aux line segments: a complete nested `{HEADER, A, B, C, D, E}` block with its own counts and its own `F` |
| `0x0004` | ancillary | circles: `uvarint n`, then `n × {svarint x_q, svarint y_q, svarint r_q, u8 colour}` in the parent's quantum |
| `0x0005` | ancillary | texts: `uvarint n`, then `n × {svarint x_q, svarint y_q, uvarint len, UTF-8}` |
| `0x0006` | ancillary | standalone points: `uvarint n`, then delta-coded `(xi, yi)` alphabet indices |
| `0x8001` | **critical** | fold magnitudes — **sparse by default**, see below. Absent entirely when every crease is classic, which is every Oriedita-compatible document. |
| `0x8002` | **critical** | per-segment custom colour: `uvarint n`, delta-coded canonical-order indices, `3 × u8` RGB each |

### Fold magnitudes (tag `0x8001`) — sparse, with an angle alphabet

Ori Studio supports non-180° creases; the scraped `.cp` corpus contains none, so this is the part of
the format the corpus cannot exercise at all. The rule is **absent means classic ±180**, and only
creases that actually carry an angle cost anything:

```
uvarint  mode          0 = sparse (default), 1 = dense
uvarint  na            distinct angles in this document
uvarint  A[0]          angle in FoldMagnitude storage units (1e-7 deg), range 0..=1_800_000_000
uvarint  A[i] - A[i-1] i = 1..na-1, MUST be >= 1
mode 0:  uvarint k                          creases carrying an angle
         uvarint idx[0]                     canonical crease order, counting derived borders
         uvarint idx[i] - idx[i-1]          MUST be >= 1
         packed  ref[i]                     ceil(log2(na)) bits each, LSB-first
mode 1:  packed  ref per crease             ceil(log2(na+1)) bits each; 0 = classic, else A[ref-1]
```

Three reasons for this shape:

* **`FoldMagnitude` is already a `u32` of 1e-7-degree units** (`geometry/line_segment.rs:61-66`), so
  transmitting the stored integer is *exactly lossless* — a shared angle contributes **zero**
  reconstruction error. Only coordinates are lossy. The 1e-7 resolution is a format commitment
  already made by the kernel, and matching it means the codec adds nothing to the angular budget.
* **An angle alphabet is the same trick as the coordinate alphabets**, and for the same reason:
  real documents use a handful of distinct angles (a box uses 90°), so `na` is small and each crease
  costs 1–3 bits rather than a 5-byte varint.
* **Sparse is the common case, dense is the degenerate one.** Break-even is `k·(idx + ref)` against
  `ne·ref`; with delta-coded indices sparse wins until roughly half the creases carry an angle.
  The encoder emits both and keeps the smaller, under the same E7 mode-comparison discipline as
  everything else — so neither case is penalised and no heuristic has to guess.

The previous draft of this tag was a dense `uvarint` per crease mirroring
`geometry_transport.rs:316-331`. That is the right choice for a zero-copy typed-array transport and
the wrong one here: a single 90° crease in a 9,000-crease document paid for all 9,000.

**Never carried, in any version:** `operation_frame` (transient tool state,
`crates/oristudio-cp/src/lib.rs:55`), `metadata` (re-embeds the entire source FOLD under
`oristudio:fold:file`, `io/fold.rs:17`, plus the Oriedita camera/canvas blobs, `io/ori.rs:10-13`),
`active` (Oriedita's own `.ori` importer ignores it — `io/ori.rs:288-289`), `selected`. A share link
produces a **new document**; the UI must say so.

### Coordinate reconstruction (normative)

```
x = (X[xi[v]] as f64) * 2f64.powi(-F)
y = (Y[yi[v]] as f64) * 2f64.powi(-F)
```

Exactly two operations. `2^-F` is a power of two; the `i64 → f64` conversion is exact because the
encoder's `F_max` clamp guarantees `|X| < 2^53`, and the multiply by a power of two is exact absent
overflow/underflow. So the reconstructed coordinates are **bit-identical on x86-64, aarch64 and
wasm32**, with no cross-engine determinism contract to maintain.

Decoder rules that make this hold, enforced by a test rather than by convention:

* No transcendental function anywhere on the decode path. `sin`, `cos`, `atan2`, `hypot` are all
  forbidden — libm results are not reproducible across platforms. Only `+ − × ÷` and `sqrt` (needed
  by v2's direction normalisation), all correctly rounded by IEEE-754.
* `f64::mul_add` is forbidden — FMA changes the rounding. Rust never auto-contracts, so this is a
  lint, not a hope.
* All iteration is by ascending integer index. No `HashMap`/`HashSet` iteration order is observable.

### Body, `format_version = 2` ("topology")

Identical to v1 except that SECTION D is replaced by D1/D2/D3, and `flags` gains bit1 `TOPO` (which
MUST be set in v2; a v2 body with `TOPO` clear is a hard reject, reserved for a future "v2 grammar
but explicit adjacency" variant).

```
SECTION D1  --  direction table
  uvarint  nd
  for d in 0..nd:
    uvarint  a[d] - a[d-1]      (a[-1] = 0)   vertex index
    uvarint  b[d] - a[d]                      vertex index, b[d] > a[d]
  Entries are ascending by direction angle as ordered by the ENCODER; the decoder does not re-sort.
  Reject if any index >= nv or a[d] == b[d].

SECTION D2  --  masks
  For v = 0..nv-1 ascending, for each d in cand(v) ascending: one bit.
  LSB-first, byte-aligned once for the whole section.

SECTION D3  --  residual edges (everything the mask cannot express)
  uvarint  nres
  uvarint  lo[0] ; uvarint lo[i] - lo[i-1]        (>= 0)
  uvarint  hi[i] - lo[i]                          (>= 0)
```

Decoder-derived quantities, computed from already-decoded vertices only:

```
u_d  = (V[b_d] - V[a_d]) / sqrt(dx*dx + dy*dy)          then negated if not lexicographically
                                                        positive (u.x > 0, or u.x == 0 && u.y > 0)
n_d  = (-u_d.y, u_d.x)
for each d:
    off[v]  = V[v] . n_d ;  proj[v] = V[v] . u_d
    sort vertices by off; split into carriers where the gap exceeds TOL_PERP = span * 2.5e-7
    within each carrier sort by proj (ties broken by vertex index)
    consec[(d, v)] = the successor of v in its carrier, if any
cand(v) = { d : consec[(d, v)] exists }, ascending
```

A set bit at `(v, d)` emits the crease `v — consec[(d, v)]`. Because `u_d` is lexicographically
positive, the low endpoint under `⟨·, u_d⟩` is also the earlier vertex in `(xi, yi)` order, so every
crease is coded exactly once at its lex-lower endpoint. `TOL_PERP` is span-relative
(1e-4 at the 400 paper) and sits ~1,700× above the worst within-carrier deviation and ~1,700× below
the corpus's p0.1 genuine vertex separation of 0.174.

Canonical crease order in v2 = mask creases in `(vertex asc, direction asc)` order, then D3 residual
creases in stream order. SECTION E and the SECTION F index space follow that order.

**Direction representatives are the longest crease in each direction class**, not the first one in
file order. The `graph` prototype used file order and its shortest representative was 1.7e-5 units
long, giving `u_d` an angular error of 2e-2 deg — a perpendicular spread of 0.138 over a 400-unit
carrier, 1,380× `TOL_PERP`. It stayed self-consistent (so it only inflated the residual stream) but
it also made the payload a function of segment ordering.

### Body, `format_version = 3` ("entropy")

Same logical model as v2. `compressor = 2`; the body is a single adaptive range-coded stream with no
byte-aligned sections. Changes:

* **SECTION C** becomes an occupancy bitmap over the `nx × ny` alphabet grid, raster-scanned in
  `(xi, yi)` order, one binary decision per cell under a 10-cell causal template
  `(0,−1)(0,−2)(0,−3)(−1,−1)(−1,0)(−1,+1)(−1,+2)(−2,0)(−2,+1)(−2,−1)` → 1024 KT binary contexts.
  A column-differential alternative (one survival bit per member of the previous column, then new
  entries as deltas) is mode-selected per document when `nx·ny ≫ nv`; the mode is one header bit.
  The bitmap coder is skipped above 8M cells.
* **SECTION D2** mask bits are coded under the context
  `(d, in_bit_d, prev_vertex_out_bit_d, min(out_so_far,3), min(|in(v)|,3))`, where `in(v)` is the set
  of directions in which an edge already arrived from an earlier vertex (derivable, because low
  endpoints precede high endpoints).
* **SECTION E** uses a hierarchical Krichevsky–Trofimov coder with α = 1.6 over three context levels:
  `(d, prev_colour_on_carrier, min(deg,8))` → `(d, prev_colour_on_carrier)` → `(prev_colour_on_carrier)`
  → uniform. KT, not PPM: PPM-A's escape penalty costs 0.55 bits/crease on a small alphabet.
* Alphabet deltas and vertex indices use adaptive multi-symbol models with Elias-gamma escapes.

The exact context layout, model update rule, and range-coder renormalisation constants are **frozen
at implementation time and recorded in `crates/oristudio-cp/src/share/v3/SPEC.md`**. This is the
append-only obligation from the forward-compat contract, and it is the single strongest argument
against building stage 3 at all (see Open questions).

### Fallback mode

If the encoder cannot produce a verified payload (see below), it emits `format_version = 1` with
`flags` bit7 `RAW` set and the body being a `uvarint`-prefixed UTF-8 **`.fold`** document, deflated.

The fallback is `.fold`, **not** `.cp`. `.cp` cannot represent circles, aux lines or texts
(`CreasePatternModel::can_save_as_cp`, `crates/oristudio-cp/src/model/mod.rs:449-451`), collapses ten
`LineColor` variants to code 4 (`io/cp.rs:70-77`), and has nowhere to put a non-classic
`fold_magnitude` — i.e. it cannot carry exactly the documents that would need a fallback. Two
candidate designs justified their fallback with `.cp`+gzip size numbers for content `.cp` cannot
hold.

---

## Encoder

Deterministic. No search except a bounded mode comparison; no solver; no iteration whose count
depends on data values except the verify loop, which is capped.

**E1 — Extract.** Take `(a, b, color)` from `CreasePatternModel::line_segments`
(`crates/oristudio-cp/src/model/mod.rs:279-292`). `aux_line_segments`, circles, texts, points and
grid go to their extension tags. Drop nothing.

**E2 — Canonicalise, complete-linkage.** Per axis, pool all `2·ne` scalars, sort, and cluster such
that **every** member of a cluster is within `τ_C = q` of the cluster representative (the median
member) — not single-linkage. Single-linkage was what both the `generic` and `graph` designs used and
it has unbounded cluster diameter: measured, 5,000 values spaced 8e-10 collapse to one entry with a
2.0e-6 unit displacement, i.e. **2× the CAMV clustering radius**, silently merging vertices Oriedita
considers distinct. Complete-linkage bounds the displacement at `τ_C` by construction, which is what
P1 and P4 rest on.

Note `q` depends on `F` and `F` depends on `L_min` which depends on canonicalisation. Resolve by
iterating twice: canonicalise at a provisional `τ_C = span·2^-45`, compute `F`, re-canonicalise at
`τ_C = 2^-F`, recompute `F`; if `F` increased, accept the larger value and stop (`τ_C` only shrinks,
so the fixpoint is reached in at most two rounds).

**E3 — Quantise and self-check.** `XQ[i] = round(xr[i] / q)` as i64, likewise `YQ`. If either array
has a duplicate, or any `|value| ≥ 2^53`, increment `F` by 2 and return to E2 (cap: 4 retries, then
RAW). This is what makes SECTION A/B's "strictly ascending" invariant a guarantee: the `graph`
prototype produced 23 exact alphabet collisions and 24 non-positive steps on the corpus because it
never checked.

**E4 — Vertices and ordering.** Vertices are distinct `(xi, yi)` index pairs, sorted lexicographically.
Creases are `(min, max)` index pairs, stable-sorted lexicographically. Plain lexicographic ordering
beats Morton and Hilbert by 8–15% here: space-filling curves shorten edge index gaps but destroy the
run structure in the larger vertex stream.

**E5 — Topology (v2+ only).** Cluster crease angles mod 180° at 1e-6°; per class the representative is
the **longest** crease; `u_d` from that pair's *reconstructed* vertices. Then compute `consec` and
`cand` **using exactly the decoder's routine on the decoder's reconstructed geometry** — never on the
source coordinates. Mark a crease first-hit iff `consec[(d, lo)] == hi` and `(d, lo)` is unclaimed;
everything else (duplicates, degenerate `a == b`, non-first-hit) goes to SECTION D3.

**E6 — Serialise, then decode-and-compare. This step is mandatory and is the safety mechanism.**

```
loop (max 3 rounds):
    bytes  <- serialise()
    D'     <- decode(bytes)                       # literally the shipped decoder function
    if crease multiset(D') != crease multiset(D):
        move every non-reproducing crease into SECTION D3 ; continue
    diag   <- check4(D) , check4(D')              # crates/oristudio-cp/src/checks.rs:224
    resid  <- per-vertex Kawasaki residual, matched by vertex identity
    if P1..P5 all hold: break
    increment F by 2 ; goto E2
if not verified: emit RAW fallback
```

The `graph` design credited this stage with its headline correctness result and never wrote it —
`grep` for `decode` in its prototype finds the word only in docstrings. The `lattice` design did
build it and it is what took its round-trip rate from 561/563 to 563/563. It is cheap (one linear
decode plus one `check4`) and it converts an entire class of silent-wrongness bug into a size
regression.

**E7 — Mode comparison.** Encode under every implemented `format_version` the caller allows, verify
each, and emit the smallest verified payload. The version byte makes this free for the decoder.

**E8 — Frame and compress.** Deflate-raw for v1/v2 (compressor `1`), stored if that is not smaller
(compressor `0`), none for v3 (compressor `2`). CRC-32 the uncompressed body. Base64url, unpadded.

---

## Decoder

Single pass. `O(nx + ny + nv + ne)` for v1; plus `O(nd · nv log nv)` for v2/v3.

```
 1. read location.hash ; split on '=' ; require key 'c'
 2. base64url-decode (URL_SAFE_NO_PAD in Rust; setFromBase64{alphabet:'base64url'} in TS)
 3. frame: magic, format_version, compressor, raw_body_len, flags, crc  -- reject per the frame rules
 4. decompress ; assert length == raw_body_len ; assert crc
 5. dispatch on format_version to the frozen decoder for that version
 6. HEADER: version_echo, flags, F, counts ; run every structural reject before allocating
 7. A/B: prefix-sum into X[0..nx), Y[0..ny) as i64 ; reject any non-positive step
 8. C: prefix-sum columns and per-column y-indices -> (xi[v], yi[v]) ; reject out-of-range
 9. coordinates: V[v] = ( X[xi[v]] as f64 * 2^-F , Y[yi[v]] as f64 * 2^-F )
10. v1: D -> prefix-sum degrees and per-vertex gap lists -> (lo, hi) pairs, reject hi >= nv
    v2/v3: D1 -> directions from vertex index pairs (sqrt only)
           derive off/proj/carriers/consec/cand per direction
           D2 -> mask bits over cand(v) in vertex order -> creases
           D3 -> residual creases
11. E: recompute the derived-border set from (xi, yi) exactly as the encoder did ;
      scatter escapes ; expand the MV bitmap -> LineColor per crease
12. F: walk extension TLVs ; skip unknown ancillary tags and count them ;
      hard-reject unknown critical tags
13. build LineSegments, hand to the existing insert path
```

Cost: at the corpus maximum (9,396 creases, 4.7k vertices) v1 is a linear varint scan and v2's
`nd·nv log nv` peaks at ~4.7e6 scalar operations. Both are single-digit milliseconds in Rust and safe
on the synchronous cold-start path. This is the whole reason `solve_exact`
(`crates/oristudio-cp-compiler/src/exact_solve.rs:197`) is not on this path: it has a 25 s budget
(`exact_solve.rs:31`) and a documented "converged to a nearby valid-but-wrong CP" failure mode
(`exact_solve.rs:126-136`).

**Runtime numbers for the candidate designs were all Python or numpy and were measured to be off by
1–2 orders of magnitude in both directions. Rust/wasm decode time is unmeasured — see Open questions.**

---

## Staging

Each stage is a `format_version`, independently shippable, and the decoder for every prior stage
stays in the binary forever.

### Stage 1 — `format_version = 1`, the index codec

Everything in "Body, v1", the frame, the seam, the wasm bridge, the benchmark binary, and the full
test harness. Compression is `deflate-raw` **in TypeScript** via `CompressionStream`/
`DecompressionStream` — baseline in every current browser, **zero wasm bytes**. The Rust side returns
and accepts raw bodies.

### Stage 2 — `format_version = 2`, the topology layer

Adds D1/D2/D3 and drops SECTION D. This is the single largest structural win in the whole design:
99.7% of corpus creases are ray-first-hits, so the largest stream (explicit adjacency, ~6.1
bits/crease) collapses to a per-vertex bitmask (~1.6 bits/crease) plus a residual list that is empty
for most documents. No new dependencies; deflate still does the entropy work.

### Stage 3 — `format_version = 3`, the entropy layer

Replaces deflate with an adaptive range coder, the vertex table with a causal-template occupancy
bitmap, and the colour stream with a KT context hierarchy. Adds ~15–25 KB of wasm and removes the
dependency on `CompressionStream`. **Gated on measured product need** — see Open questions.

### Stage 4 — the tail, deferred

`#s=<id>` server-stored short links for anything above the char budget, plus a "Copy short link"
affordance. Every prior art that had a large payload — Box Pleating Studio (TinyURL on *every* share,
`third_party/box-pleating-studio/src/app/vue/modals/share.vue:103-119`), Excalidraw, Compiler
Explorer — independently concluded it needed this. Neither stage 2 nor stage 3 puts p99 under 8,000
chars, so this is not optional in the long run; it is only deferrable.

Also stage 4: a **parametric escape hatch** — when the document has a live `.bps` Box Pleating
project, share the *design* rather than the expanded CP. Upstream ships a 7,910-crease model in 1,484
chars that way. Orthogonal to this codec.

---

## Measured baselines and expected sizes

All corpus numbers are the 563 scraped `.cp` files (329,254 creases) at
`/Users/zacharymarion/Documents/datasets/create-pattern-detector/scraped/native/raw/cpoogle`.
Char counts here use the **unpadded** `ceil(4·bytes/3)` formula and include the 16-byte frame.

### Baselines (measured)

| | p50 chars | p90 chars | max chars | ≤2000 |
| --- | --- | --- | --- | --- |
| raw `.cp` text | 27,076 | 129,418 | 994,752 | 0/563 |
| `.cp` + gzip −9 | 3,020 | 13,780 | 97,796 | ~150/563 |
| `.cp` + brotli q11 | 2,800 | 11,974 | 83,112 | 189/563 |

### This plan, per stage

| Stage | p50 | p90 | max | ≤2000 chars | basis |
| --- | --- | --- | --- | --- | --- |
| **1 — index, deflate** | **838** | **2,628** | **23,675** | **471/563** | **MEASURED** — shipped codec, real encode + real decode + real `dispatched_camv` on all 563 corpus documents. `cargo run --release -p oristudio-cp --example share_bench` |
| **2 — + topology, deflate** | **814** | **2,352** | **23,675** | **489/563** | **MEASURED** — shipped codec, same harness. Projected ~650 / ~1,850; the shortfall is diagnosed below. |
| **3 — + range coder** | **~460** | **~1,400** | **~13,700** | **~528/563** | `graph` measured 436 / 1,335 / 13,136 (reproduced exactly by its critic) at `canon 1e-9`; +~4% for this plan's quantum |

**Stages 1 and 2 are now measured end to end; stage 3 remains derived.**

### Stage-2 result — MEASURED, and it underperforms the projection

563 documents, shipped codec, real encode + decode + `dispatched_camv`:

* **diagnostics preserved 563/563, RAW fallbacks 0** — correctness holds.
* p50 838 → **814** (−2.9%), p90 2,628 → **2,352** (−10.5%), bits/crease 13.91 → **13.01**.
* ≤2000 chars *and* correct: 471 → **489** (+18 documents, 83.7% → 86.9%).
* **Grammar chosen: v1 on 295 documents, v2 on 268.** The topology layer helps barely half the
  corpus, and the E7 mode comparison is load-bearing — forcing v2 would make 295 documents larger.

The plan projected −21% p50 / −30% p90. **The shortfall has a single measured cause: direction
count.** This implementation grouped directions by *exact* reduced integer vector, on the reasoning
that the coordinates are already integers so no tolerance is needed. That is true for correctness and
false for size:

| direction grouping | distinct directions, p50 |
| --- | --- |
| exact reduced integer vector (what shipped) | **65** |
| angle-clustered at 1e-6° (what the plan specced) | **9** |

Quantisation noise splits *intended*-parallel creases into distinct exact classes — a 22.5° crease at
a 2^-36 quantum reduces to large coprime integers that match nothing else, so only axis-aligned and
45° creases ever merge. The mask carries one bit per (vertex, candidate direction), so 7× the
directions inflates it: **3.0 bits/crease measured against the 1.6 the plan projected.**

So the tolerance the plan specified was load-bearing for compression, not incidental, and removing it
traded a tuning constant for roughly double the mask. It also costs encode time — the derivation is
`O(nd · nv log nv)`, and encode p99 went 12.8ms → 90ms (max 20ms → 815ms), most of it that factor of
seven.

**The fix, and its cost:** cluster directions by angle (or by normalised vector, which needs only
`sqrt` and so stays inside the decoder's no-transcendentals rule), and group carriers by a
perpendicular tolerance as originally specced. That reintroduces one tuning constant and a float
comparison on the decode path.

**DECISION (2026-08-03): stage 2 was reverted and is not shipping.** Even fixed it would land
around −14%, and the deeper lesson from the measurement is that **deflate was already capturing most
of the adjacency redundancy** — the structural change removed bytes the generic compressor was
removing anyway. That reasoning applies to stage 3 as well. Weighed against a *permanent* second
grammar (every version is a forever obligation once links exist) and a 40x encode-time regression at
the tail (20ms → 815ms), 3% did not justify it. Only `format_version = 1` ships.

The residual problem is the tail — p99 8,535 chars — and no entropy coding fixes that; a 10x better
codec still leaves the largest patterns unshareable. That is stage 4's job.

Stage-1 result, shipped codec, 563 documents / 329,254 creases:

* **diagnostics preserved: 563/563 (100%)**, comparing `dispatched_camv` before and after a real
  encode→decode. **RAW fallbacks: 0.**
* base64url chars — p10 392, p25 531, **p50 838**, p75 1,486, **p90 2,628**, p99 8,535, max 23,675.
* 13.91 bits per crease.
* fit *and* correct: ≤600 chars 30.4%, ≤998 59%, **≤2000 83.7%**, ≤4000 96.3%, ≤8000 98.6%,
  ≤32000 100%.
* decode p50 **0.02 ms**, max 0.83 ms — the link-open cost is negligible, and no solver is involved.
  Encode p50 0.65 ms, max 20 ms (dominated by the CAMV self-check, which only the sharer pays).

This lands within 0.3% of the independent Python prototype (836 / 2,615 / 471), which is the
cross-check that matters: two implementations built from the same spec agreeing on the byte counts.

Two bugs the corpus caught that unit tests did not, both worth recording because both were silent:

1. **Complete linkage does not imply distinct representatives.** Cluster diameter is bounded by
   `tau`, but a cluster's median can sit near its upper edge while the next cluster starts just past
   the tolerance — so two adjacent representatives can round to the *same* integer and merge two
   genuinely distinct vertices. Fixed by assigning alphabet integers monotonically (bump to
   `previous + 1` on collision), which costs at most one extra quantum, ~1e-11 model units.
2. **`-0.0`.** `-0.0 == 0.0` is true, so `dedup` on the sorted scalar list drops one of them, but
   `to_bits()` differs — leaving a bits-keyed map with no entry for the survivor's twin. Real `.cp`
   files are full of values like `-2.12e-12` that land on negative zero. It cost 95 of 563 documents
   their index encoding (they fell back to `.fold`, correct but ~10x too big) while every unit test
   still passed. Fixed by mapping every *original* value against cluster boundaries rather than
   walking the deduplicated list.

Both were caught only because the encoder verifies its own output and the benchmark reports the
fallback *reason*. An encoder that silently emitted `.fold` would have scored 100% on every
correctness metric while the payloads were an order of magnitude too large.

**The stage 2 and 3 numbers below are still derived, not measured.** Three separate compositions are involved
(this plan's quantum on `generic`'s streams; `lattice`'s topology delta on `generic`'s alphabet;
`graph`'s entropy stage on this plan's alphabet), and none of the three was measured as such. The
benchmark binary in the next section is what turns them into facts, and the first checklist item of
each stage is to run it.

Two structural notes on the tail, which the table understates:

* Stage 3's **max is worse than stage 2's**. The `graph` codec's worst corpus document (`Eagle-2024`:
  2,623 creases, 216 distinct directions, a 955×934 alphabet, 21% lattice coverage) spends 67% of its
  payload on the alphabet and lands at 13,136 chars where the topology-layer codec lands at ~9,600.
  Stage 3's mode comparison (E7) fixes this by emitting v2 when v3 is larger; the table's stage-3 max
  assumes that comparison is not done, so treat ~12,000 as the real ceiling.
* **Rotation destroys the alphabet model.** Rotating 58 corpus CPs by 31.7° — an operation the editor
  offers, and one that preserves Kawasaki exactly — inflated the payload 2.56× at p50 (max 3.59×),
  with `nx + ny` going to exactly `2·nv`. A rotated p50 link is ~1,550 chars and a rotated p90 link
  ~5,500. Nothing in this plan is rotation-invariant, and neither was any candidate design that
  measured its own numbers. The mitigation is stage 4's short link, not a codec change.

---

## Affected Areas

### Rust

| Path | Stage | Contents |
| --- | --- | --- |
| `crates/oristudio-cp/src/share/mod.rs` | 1 | public surface: `encode_share(&CreasePatternDocument, ShareOptions) -> Result<Vec<u8>, ShareError>`, `decode_share(&[u8]) -> Result<ShareDecoded, ShareError>` (`ShareDecoded` carries the document plus `skipped_extensions`) |
| `crates/oristudio-cp/src/share/frame.rs` | 1 | magic/version/compressor/length-seal/CRC-32, all bounds checks |
| `crates/oristudio-cp/src/share/varint.rs` | 1 | LEB128 + zigzag, reading against a hard remaining-bytes bound |
| `crates/oristudio-cp/src/share/bitio.rs` | 1 | LSB-first bit reader/writer, 4-bit nibble packing |
| `crates/oristudio-cp/src/share/canon.rs` | 1 | complete-linkage canonicalisation, `F` derivation, quantisation + self-check |
| `crates/oristudio-cp/src/share/v1.rs` | 1 | sections A–F, encode and decode |
| `crates/oristudio-cp/src/share/topology.rs` | 2 | direction classes, `u_d` from vertex index pairs, carriers, `consec`, `cand` — one module used by **both** encoder and decoder |
| `crates/oristudio-cp/src/share/v2.rs` | 2 | sections D1–D3 |
| `crates/oristudio-cp/src/share/v3/` | 3 | `range.rs`, `model.rs`, `v3.rs`, `SPEC.md` (the frozen model layout) |
| `crates/oristudio-cp/src/share/verify.rs` | 1 | the E6 decode-and-compare loop, the P1–P5 predicates, the RAW fallback |
| `crates/oristudio-cp/src/share/error.rs` | 1 | `ShareError` — typed, no `unwrap`/`expect`/`panic!` per AGENTS.md |
| `crates/oristudio-cp/Cargo.toml` | 1 | `+ crc32fast` (already in the lockfile via `zip`); `+ flate2 {default-features=false, features=["rust_backend"]}` **only if** compression moves into Rust — stages 1–2 do not need it, because `oristudio-bp-wasm → oristudio-bp → zip → flate2` already proves it builds for `wasm32-unknown-unknown` (`Cargo.toml:60`, `crates/oristudio-bp/Cargo.toml:20`) |

`oristudio-cp` currently has zero compression dependencies (`crates/oristudio-cp/Cargo.toml:23-29`).
Keep it that way through stage 2.

### wasm bridge

`crates/oristudio-cp-wasm/src/lib.rs`, beside `restore_from_compact` (`:106`):

```rust
#[wasm_bindgen] pub fn export_share_body(handle: u32, max_version: u8) -> Result<Vec<u8>, JsValue>
#[wasm_bindgen] pub fn load_share_body(bytes: &[u8]) -> Result<ShareLoadResult, JsValue>
```

There is currently **no** `#[wasm_bindgen]` function anywhere returning a `Vec<u8>` of a document —
`CompactGeometry::to_bytes`/`from_bytes` (`crates/oristudio-cp/src/geometry_transport.rs:93,159`) are
Tauri-IPC only, and the wasm path hand-builds typed arrays via `compact_to_js` (`lib.rs:376`). This
is genuinely new surface. The generated bridge under `apps/web/src/generated/` is **tracked, not
gitignored** — it must be rebuilt and committed to ship.

### Web

**The v1 entry point is the crease-pattern selection toolbar, not the File menu.** You select a
crease pattern, the floating toolbar appears, and a share icon sits beside the Fold / Export /
Simulate verbs it already offers. Sharing is therefore scoped to **one segment**, not the whole
document — which is both the smaller payload and the clearer mental model ("share this crease
pattern"), and it reuses the entire existing segment-export path (`resolveSelectedSegment`,
`ensureCpSegmentationArtifacts`, `buildSegmentFold`) with only the terminal step new.

Consequences worth stating up front:

* No `File ▸ Share link…`, no whole-document share, no menu-visibility gating in v1.
* Segment payloads are **smaller than the corpus figures above**, which measure whole documents. The
  p90 of 2,628 chars is an upper bound for this entry point, not a typical value — but segment
  payloads are unmeasured, and `share_bench` should grow a segment mode before any number is quoted.
* Every toolbar action runs through `runAndDismiss`, which clears the selection. The share modal must
  therefore read from store state and outlive the selection, exactly as the export modal already does
  (`CpSelectionToolbar.tsx:143`).
* The link-*opening* seam below is unchanged: it does not care what produced the payload.
* Desktop is asymmetric on purpose. `apps/tauri` uses `createMemoryRouter`
  (`routing/appRouter.tsx:85-88`), so there is no URL to read: the desktop build can *produce* links
  and cannot *open* them without a custom-scheme deep link. Do not pretend otherwise in the UI.

| Path | Stage | Contents |
| --- | --- | --- |
| `apps/web/src/lib/shareLink.ts` | 1 | frame-agnostic transport: `CompressionStream('deflate-raw')`, `Uint8Array.prototype.toBase64({alphabet:'base64url'})` / `setFromBase64`, fragment parse/format. No CP knowledge. |
| `apps/web/src/lib/sharedCpPayload.ts` | 1 | `takeSharedCpPayload()` / `hasPendingSharedCp()` / `peekSharedCpFragment()` — module singleton + `sessionStorage` reload guard |
| `apps/web/src/main.tsx` (`:11`) | 1 | call `takeSharedCpPayload()` at **module scope, before `createAppRouter()`**, then `history.replaceState` |
| `apps/web/src/routing/appRouter.tsx` (`:22`) | 1 | `startupHomePath()` returns `EDIT_PATH` when a payload is pending, ahead of the `showWelcomeOnStartup` read |
| `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` (`:890`) | 1 | `ensureEditCreasePattern` consumes the payload **inside** the module-level in-flight guard (`:118`) instead of calling `createBlankOristudioCpDocument()` (`:895`) |
| `apps/web/src/cp-workspace/CpSelectionToolbar.tsx` | 1 | **The entry point.** A fifth `IconButton` beside Fold / Export… / Save PNG / Simulate inline, opening the share modal for the selected segment. |
| `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` | 1 | `shareOristudioCpSegment(segmentId)` beside `exportOristudioCpSegment`: `buildSegmentFold` → `load_fold` → `export_share_link` → `free_document`, result into store state |
| `apps/web/src/cp-workspace/share/ShareLinkModal.tsx` | 1 | the modal — link field, copy button, character count, over-budget warning with an "export a file instead" escape |
| `apps/web/src/cp-workspace/share/useShareLink.ts` | 1 | store bindings, the shape of `hooks/useViewportSurface.ts` |
| `apps/web/src/components/panels/CreasePatternPanel.tsx` | 1 | mount only. No new state, effect, memo or listener. |

Three existing call sites erase the fragment and are the reason the seam must be at module scope:
`appRouter.tsx:28-30` (`startupRedirect` returns a bare pathname), `appRouter.tsx:80` (the `*` route),
and `workspaceUrlSync.ts:43` (`navigateTo(workspacePath(workspace))` on the first workspace
transition).

**Do not** build a `/share` route loader. `implementation-plans/workspace-routing.md:220-222`
prescribes one; that note predates the deletion of `workspaceGuard` and the rule "routing decides
intent, surfaces self-provision; never provision a document in a route/loader/mount-effect". Updating
that plan file is a checklist item.

### Docs

* `PORTING.md` — no change; this is original functionality, not a port.
* `implementation-plans/workspace-routing.md:22-23,220-222` — mark the `/share` loader stale.
* `WEB_ROADMAP.md` — add the share-link surface.

---

## Validation harness

### Corpus benchmark — `crates/oristudio-cp-eval/src/bin/share_bench.rs`

Not committed with the corpus (`tests/corpus/` holds notes only, no private files). Reads a corpus
root from `ORISTUDIO_SHARE_CORPUS` and accepts `.cp`, `.fold`, `.ori` and `.osf`. Reports, per
`format_version` and for every baseline (`raw`, `.cp`+deflate, `.fold`+deflate):

* payload bytes and **unpadded** base64url chars at p10 / p25 / p50 / p75 / p90 / p99 / max
* bits per crease, per document and corpus-total
* **per-section byte breakdown** post-compression (the only way to know where to spend next)
* budget-fit counts against the full URL including a configurable prefix: ≤600 (printed QR), ≤998
  (RFC 5322 line), ≤2000 (Discord / IE heritage), ≤8000, ≤32000
* residual-edge rate, derived-border hit rate, verify-loop iteration histogram, `F` histogram,
  RAW-fallback rate and reasons
* encode and decode wall time at p50 / p99 / max, in **Rust**
* a machine-readable JSON summary so a CI job can diff two runs and fail on regression

Regression gate: the benchmark writes `artifacts/share-bench/summary.json` (gitignored) and a
committed `crates/oristudio-cp-eval/baselines/share-bench.json` records the accepted p50/p90/max and
fit counts. A change that regresses any of them by >2% without updating the baseline in the same
commit is a review failure.

### Precision harness — `crates/oristudio-cp-eval/src/bin/share_precision.rs`

For every corpus document, runs the real kernel (not a reimplementation) on both sides:

* `check4` / `check_camv_task` (`crates/oristudio-cp/src/checks.rs:224,232`) before and after, compared
  as a **multiset** — same point (within `Epsilon::UNKNOWN_1EN4`), same `FlatFoldabilityRule`, same
  `FlatFoldabilityColor`, same little-big-little segment set. This is P1 and P5.
* per-vertex Kawasaki residual via the kernel's own path, matched **by vertex identity**, for P2.
* `vertex_closure_residual` for P3.
* max coordinate displacement for P4.

Reports the full residual distribution (p50 / p90 / p99.9 / max, plus max per-vertex `R₁ − R₀`) and
exits non-zero on any P1–P5 failure. **Note the corpus-harness bug that invalidated part of the prior
research**: a Python CAMV reimplementation mapped `.cp` code 3 to "skip" and tested `black` against
code 0, silently dropping every mountain crease. `.cp` codes are 1 = Black0, 2 = Blue2 (valley),
3 = Red1 (mountain), 4 = Cyan3 (`crates/oristudio-cp/src/io/cp.rs:57-77`). Using the kernel directly
removes the whole class of error.

### Unit and integration tests

* `crates/oristudio-cp/tests/share_roundtrip.rs` — proptest over generated documents: random vertex
  sets, degenerate creases, duplicate creases, all 13 `LineColor` variants, non-classic fold
  magnitudes, aux/circles/texts, out-of-paper coordinates, unit-square coordinates, rotated patterns.
  Asserts `decode(encode(D)) == D'` where `D'` is the encoder's own intended reconstruction, and P1.
* `crates/oristudio-cp/tests/share_frame.rs` — hostile-input suite: truncation at every byte offset,
  bit flips, CRC mismatch, bogus counts (`ne = 2^40` in a 13-byte payload), decompression bombs,
  unknown version, unknown critical tag, unknown ancillary tag, reserved bits set. Every case must be
  a typed error, never a panic, never an unbounded allocation.
* `crates/oristudio-cp/tests/share_golden.rs` + `tests/fixtures/oristudio-cp/share-v1-golden.bin` (and
  `-v2`, `-v3`) — byte-exact payloads for `tests/fixtures/oriedita/solution_sample_1.cp`, the five
  `crates/oristudio-cp/resources/default-molecules/*.fold`, a lattice-exact case, a pure-22.5° case,
  a unit-square case, and a rotated case. Mirrors the discipline of
  `tests/fixtures/oristudio-cp/compact-geometry-golden.bin`.
* `apps/web/src/lib/shareLink.test.ts` — the TS transport decodes the same golden fixture to the same
  bytes, in the shape of `apps/web/src/engine/oristudioCpNativeClient.test.ts:788-839`.
* `crates/oristudio-cp/tests/share_determinism.rs` — a static assertion that the decode path contains
  no `sin`/`cos`/`tan`/`atan`/`atan2`/`hypot`/`exp`/`ln`/`powf`/`mul_add` call. A grep-based test is
  sufficient and is better than a convention.
* `apps/web/src/lib/sharedCpPayload.test.ts` — the seam: fragment consumed before the router runs,
  `replaceState` applied, reload guard prevents re-open, failed decode still exposes the original
  fragment.

### CI

Add `share_roundtrip`, `share_frame`, `share_golden`, `share_determinism` to the existing
`native-oracle` job (they are plain `cargo test --workspace`). `share_bench` and `share_precision` are
**not** in CI — they need the corpus, which is not committed. They are a documented pre-merge manual
step for any change under `crates/oristudio-cp/src/share/`, and the checklist below requires their
output in the PR body.

---

## Rejected alternatives

| Rejected | Why, and which critique killed it |
| --- | --- |
| **Explicit grid / lattice detection as an early stage** (a common recommendation; "detect the smallest denominator `N` for which all coordinates are within tolerance of `k/N`") | **Measured to be nearly worthless, for a non-obvious reason.** A coordinate mode can only shrink SECTIONS A/B, and the alphabet is **24.1% of compressed bytes corpus-wide** — that is the hard ceiling on *every* such mode. Worse, the ceiling is not where the mode applies: only **82/563** documents have any grid `N ≤ 2048` covering ≥95% of coordinates, and on exactly those the alphabet is **already just 5.8% of the compressed payload at p50** (vs 29.9% overall), because a grid alphabet has near-constant deltas and deflate crushes them. Expected corpus-wide win ≈ **1%**. The adaptive integer alphabet *is* grid detection, done implicitly, for free, without a denominator search or a spec constant. The alphabet costs most (42% at p90) on precisely the documents that have no grid — which is where the anchored-line DAG, not a lattice, is the lever. Measured 2026-08-03, `/tmp/ceiling.py`, F=36. |
| **Algebraic `Z[√2]`/`Z[√3]` module alphabet** (the `lattice` design's headline) | Same 24.1% ceiling as above. Its exactness argument also does not survive a fair control: a plain uniform **37-bit** alphabet breaks zero of the same 127,758 clean vertices, and the residual floor (2.5e-7) is identical for 44-bit uniform and for the lattice — it is set by canonicalisation, not by algebraic reconstruction. Size win is 9.9% at p50, 1.2% at p90, and it makes the **worst case 18% worse**. Cost: a 2×1024×129 basis search, a frozen-forever `Q[b]` table, two irrationalities, a cross-engine f64 determinism contract, and an unmeasured spec constant (`B = 256`, where every script used 64). Can be added later behind the version byte if 64 characters at the median ever matter. |
| **Carrier / constraint propagation with seeded ρ** (the `constraint` design) | Not yet a codec: three of its streams were never decoded once; its crease bitmap index space is defined circularly in terms of the data being decoded, with **no threshold separating true from false incidences in 40/40 files**; half its vertices decode to the wrong partner carrier. Honestly accounted (real `X` stream, real header, real container framing) it is 622 chars at p50 against 616 for the codec it claimed to beat by 12.3%, fits **one fewer** file under 2,000 chars, and is 2.4–2.8× worse in the tail. Its own critic showed a plain quantised vertex table at 40 bits already meets the precision bar unconditionally, so the whole apparatus is justified on size alone and the size win is nil. |
| **Coarse coordinates (16–32 bits) + decoder repair** | 20-bit quantisation breaks Kawasaki on 37.8% of interior vertices in 528/563 documents, and 16/18/20/24/26 bits all sit on the same ~37% plateau — there is no "good enough" middle. Also, real CP geometry is over-determined (three carriers concurrent), so rounding breaks concurrency and the inconsistency lands directly on ray angles at `step/L`. |
| **`solve_exact` as the decoder or a decode-path repair** | Right target (`polish_target_kawasaki_degrees = 1e-6`, `crates/oristudio-cp-compiler/src/exact_solve.rs:116-118`), wrong cost and wrong semantics: a 25 s budget (`:31`) already strained by 63-vertex problems, versus ~9,100 free parameters for one real CP; it *moves* vertices under Gaussian priors; and its own tuning note records converging to "a nearby valid-but-wrong CP" 46 times out of 563 (`:126-136`). A share link that decodes to a different-but-plausible CP is worse than one that fails. Keep it as an explicit user-invoked "repair" action, never automatic. |
| **`exactize.rs`** | Deprecated by its own module doc (`crates/oristudio-cp-compiler/src/exactize.rs:1-5`). |
| **`fix_inaccurate_*` as a decode-side snap** | Median inter-entry gap in `fixData_22_5.bin` is 0.0023 over a 200-unit span — ~18 bits just to disambiguate, worse than sending the coordinate — and it linear-scans 67,638 f64 values per coordinate. It also *changes* geometry, which violates P5. |
| **TypeScript `CompressionStream` instead of Rust deflate** (what earlier drafts of this plan specified, for "zero wasm bytes") | **Reversed on a measurement.** Splitting compression across the boundary forces a frame-rewriting dance: TS would have to parse the header, and the CRC-over-uncompressed-body plus the decompression-bomb guard would end up half in each language. Doing it in Rust keeps every bounds check in one place and makes the format testable under `cargo test` alone. The cost turns out to be small — **`miniz_oxide` is +37.7 KB raw / +17.0 KB gzipped** on `oristudio_cp_wasm_bg.wasm`, measured by building the codec with and without it. That is a fifth of brotli's decoder and does not come close to the ~10%-of-bundle bar that rejected brotli below. The `compressor` byte still admits a stored body, so the TS path stays available if the number ever changes. |
| **brotli** | The published rust-brotli-wasm decoder is ~90 KB gzipped (~196 KB raw) against a 1.6 MB `oristudio_cp_wasm_bg.wasm`; the encoder is ~450 KB gzipped. The measured gap over `deflate-raw` on this payload shape is ~7.7% at p50. Not worth 10% of the bundle on the *open* path. |
| **brotli custom dictionaries** | The `generic` design built the real thing (`BrotliCompressCustomIoCustomDict`) and found the widely-used prepend emulation **overstates the gain by ~2×**: 95.6% of no-dict at 32 KB, 93.7% at 64 KB, 91.8% at 128 KB. And the gain is backwards — −14.3% at p50 but **−1.0% at p90**, i.e. nothing where the budget actually binds. Plus 42 KB of permanently-frozen bundle per generation. |
| **base85 / Z85** | Alphabet contains `# % < > [ ] { } ^ & ? /`; after URL escaping it is *worse* than base64url. |
| **A custom 72–90 symbol URL alphabet** | ≤2.8% real gain over base64url for materially worse robustness in chat clients and email, and no double-click-to-select. |
| **base45 (RFC 9285)** | 29% better inside a QR (alphanumeric mode) but **not URL-legal** — contains space, `%`, `+`, `$`, `*`, `/`, `:`. If printed QR ever becomes first-class, emit a *separate* base45 payload for the QR only. |
| **Query string instead of fragment** | Reintroduces IIS `maxQueryString` 2048, nginx/Apache ~8 KB request lines, Cloudflare's 32 KB, access-log retention of the user's unpublished design, and cross-origin `Referer` leakage. RFC 3986 §3.5 gives all of that away for free in the fragment. |
| **Canonicalising the graph by splitting creases at all intersections** (a standard planar-graph normalisation, and a natural-sounding preprocessing step) | **Invents diagnostics that did not exist.** `point_line_map` (`checks.rs:1165-1180`) builds the vertex map from segment **endpoints only** and never computes an intersection, so in this kernel a crossing without a shared endpoint is *not* a vertex and receives no Kawasaki or Maekawa check. Splitting there creates a real degree-4 vertex, which is then checked — and a crossing of two unrelated creases has no reason to satisfy Maekawa. It fails P5 (no diagnostic created) by construction, and it silently rewrites the document the user drew, so a round trip through a share link would not give back their own file. The encoder takes `line_segments` as authored and drops nothing (E1). |
| **Morton / Hilbert vertex ordering** | 8–15% worse than plain lexicographic: space-filling curves shorten edge index gaps but destroy the run structure in the larger vertex stream. |
| **Shared X/Y alphabet + membership bitmask** | +2.4% corpus-wide despite 43.5% of documents having exactly equal X and Y alphabets — the generic compressor already exploits the cross-stream repetition. |
| **Direction table as quantised angles** | At the specced 1e-3° a single carrier shatters across hundreds of perpendicular buckets (lever arm 283 × 5e-4° = 2.5e-3, i.e. 250× `TOL_PERP`), producing 11,566 residual creases. Vertex index pairs are exact and cost the same. |
| **`.cp` + deflate as the correctness backstop** | Cannot represent the documents that need a backstop: `can_save_as_cp` requires circles/aux/texts empty (`crates/oristudio-cp/src/model/mod.rs:449-451`), ten `LineColor` variants collapse to code 4 (`io/cp.rs:70-77`), and non-classic `fold_magnitude` has nowhere to go. `.fold` is the fallback. |
| **`geometry_transport.rs`'s `CompactGeometry` as the starting point** | Explicitly optimised for zero-copy into JS typed arrays: 52-byte header, 32-bit alignment, 16 bytes/segment of `[color, active, selected, customized]` as `i32` (three of which are droppable), 3 bytes/segment of custom colour written unconditionally, no vertex dedup, and a `serde_json` tail that on a FOLD-imported document contains the entire source FOLD. 51 bytes/segment. Its *disciplines* (magic + hard reject, omit-unused-arrays, golden fixture forcing both decoders) are copied; its layout is not. |
| **A `/share` route data loader** | `implementation-plans/workspace-routing.md:220-222` prescribes it; that note is stale, contradicted by the post-`workspaceGuard` rule against provisioning in loaders, and it also loses the payload to `startupRedirect`. |
| **An `App.tsx` hook mirroring `useTauriOpenedFiles`** | Correct shape for the future desktop channel, but it loses the race with `CreasePatternPanel`'s self-provision: a blank CP is created then replaced, producing a visible double flash and a bogus `projectLoadId` bump. |
| **Edgebreaker / Touma–Gotsman connectivity coding** | Assume a manifold triangulation; a CP is a planar straight-line graph with mixed degrees, dangling creases and disconnected components. And geometry-conditioned connectivity already measures **3.46 bits/vertex p50, 2.66 corpus-mean** — below the 3.245 bits/vertex Tutte bound for bare connectivity — so there is nothing left to win. |
| **Parallelogram prediction with quantised residuals** (standard mesh geometry coding) | 10 bits/vertex at 12-bit quantisation, ~26 bits short of what the CAMV bar demands. The entire mesh-geometry-compression family is disqualified by the precision constraint, not by size. |
| **ReferenceFinder / Huzita-Justin construction programs** | Solves the *inverse* problem, per point, approximately, expensively, with no guarantee that a whole CP shares a compact construction. A research direction, not a transport. |
| **Browser HTTP shared dictionaries** | A transport feature (Chrome 130+) with no JS API. Irrelevant to a URL payload. |

---

## Open questions

1. **The quantum/canonicalisation combination has never been measured.** The `generic` critique
   measured `canon 1e-11 + no quantisation` → max per-vertex `ΔR = 7.83e-9` ✓ and `canon 1e-11 +
   B=40` → 1.881e-7 ✗, but never `canon 1e-11 + B=44`, and never this plan's `τ_C = q` coupling with
   complete linkage. The expected result (~2e-8, 5× under P2) is a linear extrapolation.
   **Experiment:** run `share_precision` over the corpus for `F ∈ {32, 34, 36, 38, adaptive}` ×
   `τ_C ∈ {q, 4q, 1e-9}` × `{single, complete}` linkage, and report the per-vertex `max(R₁ − R₀)`
   surface. This is checklist item 1 of stage 1 and must land before the format constants are frozen.
2. **Is P2 achievable at all?** If the residual floor is dominated by something neither `F` nor `τ_C`
   controls — e.g. the kernel's own `acos` conditioning — then no configuration meets `R₁ < 1e-7`.
   The measured pre-round-trip worst clean-vertex residual under the repo's `acos` is 1.881e-7 deg,
   which is *already above* the 1e-7 target, so **P2's absolute form may be unsatisfiable for some
   vertices by definition** and only the `R₁ − R₀ < 1e-7` half may be meaningful.
   **Experiment:** the same run, reporting the pre-round-trip `R₀` distribution first. If the
   absolute form is unsatisfiable, the criterion becomes `R₁ − R₀ < 1e-7` plus "no vertex crosses
   1e-6", and the plan should say so explicitly rather than quietly relaxing.
3. **All three stage size numbers are compositions that were never measured as such.** Stage 1
   applies a precision surcharge measured on one codec's streams; stage 2 applies a topology delta
   measured on a different codec's alphabet; stage 3 composes a third codec's entropy stage onto this
   plan's alphabet. **Experiment:** `share_bench` after each stage, with the previous stage's numbers
   in the same table.
4. **The corpus is 563 scraped `.cp` files and nothing else.** It contains no TreeMaker output, no
   FOLD-imported documents with `U`/`None` assignments, no aux lines, no circles, no texts, no
   non-classic fold magnitudes, no curved-crease approximations, and no rotated or rescaled patterns —
   i.e. it cannot exercise SECTION E's escape path, any critical extension tag, the RAW fallback, or
   the scale-adaptive `F`. Rotation alone was measured to inflate the payload 2.56× at p50.
   **Experiment:** build a second corpus from `crates/oristudio-cp/resources/default-molecules/*.fold`,
   `tests/fixtures/`, TreeMaker CLI output, and programmatic rotate/rescale/aux/circle/text variants
   of the scraped set. Report `share_bench` and `share_precision` on both.
5. **Rust/wasm decode time is entirely unmeasured.** The `constraint` design quoted 17 ms for a step
   that was actually 197 ms; the `graph` design quoted "~40 ms" for a decode whose numpy-vectorised
   parts alone measured 116 ms and which excluded its own arithmetic-decoding stage. "30–100× faster
   in Rust" does not apply to numpy-vectorised prototypes. **Experiment:** a criterion bench on the
   three largest corpus documents, native and under `wasm-pack test --node`, gating the synchronous
   cold-start placement.
6. **Is stage 3 worth its permanent cost?** The whole measured difference between the topology codec
   and the entropy codec is ~13 documents crossing the 2,000-char line, in exchange for ~1,000 lines
   of range coder and adaptive models **frozen bit-exactly for the life of every link ever shared**.
   If stage 4's `#s=` short link exists, it absorbs those documents for free. **Experiment:**
   instrument the share dialog for a release cycle and report the distribution of *actual* link
   lengths users generate, plus how often the short-link path is taken.
7. **Stage 2's `TOL_PERP` grouping and first-hit tie-breaking have no analytic safety argument** — only
   the E6 verify loop. The `graph` prototype measured ~98,000 carrier-crossing parameter values within
   1e-9 of each other across 40 files, ordered by rounding noise. **Experiment:** report the residual-
   edge rate and verify-loop iteration histogram from `share_bench` on the extended corpus; if the
   demotion rate exceeds a few per thousand creases, stage 2's win shrinks and needs re-pricing.
8. **Cross-platform f64 identity of `(i64 as f64) * 2^-F`** is believed trivially exact but is not
   pinned. **Experiment:** the golden fixture asserted from native `cargo test`, from
   `wasm-pack test --node`, and from the TS mirror in `npm run test:web`, all in CI.
9. **Desktop.** `createMemoryRouter` (`apps/web/src/routing/appRouter.tsx:85-88`) means there is no
   URL at all, and Tauri drop handling is deliberately disabled (`dragDropEnabled: false`, to avoid
   consuming Dockview's panel drags). A custom-scheme deep link through the `useTauriOpenedFiles`
   channel (`apps/web/src/App.tsx:148`) is unspecified and out of scope for stages 1–3.
10. **Anchored-line construction DAG — the strongest deferred idea, and the only real competitor to
    stage 3.** Represent lines as `(anchor point ref, direction ref)`, derived vertices as
    `intersection(lineA, lineB)`, and creases as `(supporting line, start vertex, end vertex)`.
    Two properties no other candidate has: lines anchored at one vertex are **exactly concurrent**,
    and a derived vertex is computed at full f64 from exact inputs rather than being quantised —
    so it beats the quantum on the angular bar instead of paying for it. Decoder determinism is fine
    (line intersection is `+ − × ÷` only, IEEE-exact, no transcendentals — it already satisfies the
    decoder rules above). Its ceiling is the alphabet it eliminates: **24.1% corpus-wide, 42% at p90**,
    and it is strongest on exactly the non-grid documents where a lattice mode is useless. Its real
    cost is **encoder-side inference** — choosing which lines and anchors explain the pattern is a
    search, and nothing here has measured whether it succeeds on real CPs.
    **Priced against the alternative:** brute-force precision is cheap. Measured, F=30 → p50 794
    chars and F=40 → p50 968, i.e. ten extra bits per coordinate costs only ~22%. So the DAG's
    *precision* advantage is worth ~20%, not a qualitative unlock; its *size* advantage is the
    24% alphabet. Both are real, neither is decisive, and it competes for the same slot as stage 3's
    range coder (~30%) at considerably more design risk.
    **Experiment, before stage 3 is committed:** on the 82 grid documents and 100 sampled non-grid
    ones, attempt line/anchor inference offline and report (a) the fraction of vertices explainable as
    an intersection of two inferred lines, (b) the resulting payload against the stage-2 number, and
    (c) the max per-vertex `R₁ − R₀` versus the quantised path. If (a) is high on non-grid CPs, this
    displaces stage 3.
11. **`.osf` interaction.** Opening a share link into a session that already has a document must
    either merge (`importAddOristudioCpText`, `apps/web/src/store/workspaceStore/slices/projectSlice.ts:1906`)
    or replace (`loadCreasePatternText`, `:1742`), and the product answer is not decided. Stage 1
    ships cold-start only.

---

## Checklist

### Stage 0 — settle the constants (must precede any format freeze)

- [x] Add the precision harness on the **real kernel** — landed as
      `crates/oristudio-cp/examples/share_precision.rs` (an example, not an eval bin, so it needs no
      new crate dependency). Complete-linkage canonicalise + quantise, `check4` before/after,
      violation multiset matched by point/rule/colour, plus `closure_n` so a not-applicable P3
      cannot be misread as a pass.
- [x] Run the `F` sweep over all 563 documents. Result recorded in `## Stage-0 result` above:
      **F=30 is the knee at 100% CAMV preservation**; F=20 creates 32,992 violations.
- [ ] Extend the sweep to the remaining axes of Open question 1 — `τ_C ∈ {q, 4q, 1e-9}` ×
      `{single, complete}` linkage — and add the **per-vertex** `max(R₁ − R₀)` residual, which the
      set-equality run does not cover.
- [x] Measure the **fold-angle / closure** regime by injecting non-classic magnitudes. Result in
      `## Stage-0 result`: the closure path needs more bits than the flat path, and `F=28` leaves
      only 1.4× margin against the 1e-6 bar.
- [ ] Raise `F_min` from 20 to **30 (flat) / 32 (any non-classic crease)** in the `F` formula —
      both measured floors — and freeze `τ_C = q`, complete linkage, `TOL_PERP = span·2.5e-7`.
- [ ] Rework tag `0x8001` to the sparse + angle-alphabet form with a dense mode bit, and add a
      round-trip test for each mode plus the mode-comparison choice.
- [ ] Assemble the extended corpus (Open question 4) and a script that generates the rotate / rescale /
      aux / circle / text / fold-magnitude variants.

### Stage 1 — `format_version = 1`

- [x] `crates/oristudio-cp/src/share/{mod,error,varint,bitio}.rs` — typed errors, LEB128 + zigzag
      bounded against remaining bytes, LSB-first bit and nibble IO, unit-tested.
- [x] `crates/oristudio-cp/src/share/frame.rs` — magic, version, compressor, length seal, CRC-32,
      every reject rule; `+ crc32fast` in `Cargo.toml`.
- [x] `crates/oristudio-cp/src/share/canon.rs` — complete-linkage canonicalisation, `F` derivation
      with the two-round fixpoint, quantisation with the duplicate/`2^53` self-check.
- [x] `crates/oristudio-cp/src/share/v1.rs` encode — sections A–E, canonical crease order,
      DERIVED_BORDER with the both-directions guard, 13-code colour with 1-bit M/V + 4-bit escapes.
- [x] `crates/oristudio-cp/src/share/v1.rs` decode — every structural reject before any allocation;
      exact prefix sums; power-of-two coordinate reconstruction.
- [x] Extension TLV area: writer, reader, ancillary-skip / critical-reject, `skipped_extensions`
      surfaced on `ShareDecoded`.
- [x] Extension tags `0x0001`–`0x0006` and `0x8001`–`0x8002`, each with a round-trip test.
- [x] RAW fallback mode (`.fold` text, deflated) and the `flags` bit that selects it.
- [x] `crates/oristudio-cp/src/share/verify.rs` — the E6 decode-and-compare loop with the `F`-bump and
      RAW escape, plus the P1–P5 predicates as reusable functions.
- [x] `crates/oristudio-cp/tests/share_roundtrip.rs` — proptest suite.
- [x] `crates/oristudio-cp/tests/share_frame.rs` — hostile-input suite (truncation at every offset,
      CRC, bombs, bogus counts, unknown version/tags, reserved bits). No panics, no unbounded allocs.
- [x] `crates/oristudio-cp/tests/share_determinism.rs` — the no-transcendental / no-FMA grep test.
- [x] `crates/oristudio-cp/tests/share_golden.rs` + `tests/fixtures/oristudio-cp/share-v1-golden.bin`.
- [x] wasm bridge: `export_share_link` / `load_share_link` in
      `crates/oristudio-cp-wasm/src/lib.rs` (+ `CpSession::export_share` / `load_share`, and a
      `ShareError -> EngineError` mapping giving the frontend `share_link_too_new` vs
      `share_link_invalid`). Verified to build for `wasm32-unknown-unknown`.
- [x] Rebuild `apps/web/src/generated/` (tracked, not gitignored) so the frontend can call the new
      exports. **Bundle cost, measured** on `oristudio_cp_wasm_bg.wasm`: 1,641,195 → 1,793,450 bytes
      raw (+152,255, +9.28%); gzipped 850,372 → 918,985 (+68,613, **+8.07%** — the number users
      actually download). Split by building the codec with the compressor stripped:
      **`miniz_oxide` +37.7 KB raw / +17.0 KB gzipped**, **share codec itself +114.5 KB raw /
      +51.6 KB gzipped**. So the compression choice is the cheap part; the codec is the cost, and it
      is the cost of having the feature at all. (Checked and ruled out: the RAW fallback does *not*
      drag in extra serde machinery — `oristudio-cp-wasm` already exports `export_fold` and
      `export_fold_file` at `lib.rs:209,214`, so the FOLD path was linked before this feature
      existed.)
- [x] `apps/web/src/lib/shareLink.ts` — fragment build/parse, the long-link threshold, clipboard
      helper. No compression or base64 here: both live in Rust, so this module stays CP-agnostic and
      is pure string work. + `shareLink.test.ts` (9 tests).
- [x] Engine surface through **all three** bridges, so the Tauri parity test stays green:
      `CpSession::export_share` / `load_share`, wasm `export_share_link` / `load_share_link`, Tauri
      `cp_export_share` / `cp_load_share`, plus `CP_ENGINE_COMMANDS` entries.
- [x] `shareFoldFrameAsLink` in `oristudioCpRuntime.ts` — scratch handle, freed in `finally`,
      mirroring `exportFoldFrameAsFormat`.
- [x] `shareOristudioCpSegment(segmentId)` + `dismissOristudioCpShareLink` in `projectSlice`, and
      `oristudioCpShareLink` state. Reuses `ensureCpSegmentationArtifacts` + `buildSegmentSubFold`,
      so a shared segment is the same sub-fold Export writes.
- [x] `cp-workspace/share/ShareLinkModal.tsx` + styles — URL field (pre-selected), copy button with
      copied state, crease/character count, long-link warning, scope note. Mounted in `App.tsx`.
- [x] Share button in `CpSelectionToolbar` (sixth action) + test asserting it passes the **segment
      id** and dismisses.
- [ ] `apps/web/src/lib/sharedCpPayload.ts` — module singleton, `sessionStorage` reload guard,
      `peekSharedCpFragment()` for error reporting; + tests.
- [ ] Seam: `main.tsx` module-scope consume + `replaceState`; `startupHomePath()` branch;
      `ensureEditCreasePattern` consumption inside the in-flight guard.
- [ ] `apps/web/src/cp-workspace/share/shareActions.ts` + `useShareLink.ts`; register the shortcut in
      `apps/web/src/keyboard/`; mount from `CreasePatternPanel.tsx` with **no** new panel state.
- [x] UI honesty: the "crease pattern only" note and the long-link warning with the character count.
- [x] Decode-failure handling: `share_link_invalid` / `share_link_too_new` get plain-language
      messages in `toastMessages.ts` (the kernel's own text is precise but internal), and a failed
      open falls back to a blank canvas so the editor stays usable rather than dead.
- [x] **Opening seam — built as a `/s` route, not a `main.tsx` module-scope hook.** `ShareRoute`
      captures the fragment and redirects to `/edit`; `ensureEditCreasePattern` provisions from the
      pending payload instead of seeding a blank. Deletes what the module-scope design needed: no
      global side effect, no `replaceState`, no `sessionStorage` reload guard (the redirect strips
      the payload, so a refresh cannot re-import over work in progress), no `startupHomePath`
      branch. Verified end to end in the browser: `/s#…` → `/edit`, fragment gone, document source
      `Shared.cp`, creases intact.
- [x] i18n for every new string: 9 keys × 8 locales, `i18n:check` passing.
- [x] Corpus benchmark — landed as `crates/oristudio-cp/examples/share_bench.rs` (an example beside
      `share_precision.rs`, so it needs no new crate dependency). Stage-1 row of
      `## Measured baselines and expected sizes` now carries real numbers.
- [ ] `baselines/share-bench.json` + the >2% regression gate.
- [ ] Run `share_precision` on both corpora; paste the P1–P5 result table into the PR body.
- [ ] Mark `implementation-plans/workspace-routing.md:22-23,220-222` stale; add the surface to
      `WEB_ROADMAP.md`.

### Stage 2 — `format_version = 2`

- [x] `crates/oristudio-cp/src/share/topology.rs` — built with **exact integer** direction classes
      (GCD-reduced vectors) and exact cross-product carriers, not angles and `TOL_PERP`. Correct, and
      measured to cost ~2x the mask; see the stage-2 result above.
- [ ] Re-do the grouping with an angle/normalised-vector tolerance and re-measure — the diagnosed
      fix for the size shortfall.
- [x] Sections D1-D3, encode and decode. Landed inside `v1.rs` behind a version switch rather than a
      separate module: v2 differs from v1 only in section D, and both share canonical crease order, so
      the colour section and every per-crease extension index space are shared rather than duplicated.
      The version byte selects the grammar; no separate `TOPO` flag is needed.
- [x] Encoder integration: slot claiming on the decoder's own derivation, demotion to D3, and E7 mode
      comparison. **The comparison is on the framed, compressed payload, not the raw body** -- the
      topology layer emits fewer but less repetitive bytes, so body length mispredicts the shipped size
      and chose wrong on small documents.
- [x] Golden fixtures for **every** shipped grammar, forced rather than chosen (`share-v1-golden.bin`,
      `share-v2-golden.bin`, plus `share-golden.bin` for whatever the encoder picks). Without forcing,
      a grammar could stop being exercised just by losing the size comparison, then rot -- while links
      shared under it were still live.
- [ ] Try **graph-traversal vertex ordering** (BFS/DFS from a corner, so neighbour-index deltas in
      SECTION D shrink) against plain lexicographic. Only lexicographic vs Morton vs Hilbert was ever
      measured, and adjacency is 40% of the uncompressed body — the largest single section — so this
      is the cheapest untested lever in the design. Keep whichever wins; it is an encoder choice, not
      a format change, because the decoder reads the order off the wire.
- [x] Ran `share_bench`; stage-2 row now measured. Direction-count diagnosis recorded above.
- [ ] Residual-edge rate and verify-loop histogram still unreported.
- [ ] Run the anchored-line inference experiment (Open question 10) and decide stage 3 vs the DAG.

### Stage 3 — `format_version = 3` (gated on Open question 6)

- [ ] Decide, from the stage-2 telemetry, whether to build it at all. Record the decision here.
- [ ] `crates/oristudio-cp/src/share/v3/range.rs` — carryless 32-bit range coder, integer-exact,
      enc + dec, fuzz-tested for enc/dec symmetry.
- [ ] `crates/oristudio-cp/src/share/v3/model.rs` — adaptive binary (KT) and multi-symbol models with
      periodic halving; no floats anywhere in the coder.
- [ ] `crates/oristudio-cp/src/share/v3/v3.rs` — occupancy bitmap with the 10-cell causal template,
      column-differential alternative, contexted mask bits, KT colour hierarchy.
- [ ] `crates/oristudio-cp/src/share/v3/SPEC.md` — the frozen model layout, marked append-only.
- [ ] Mode comparison against v2 so the tail cannot regress; golden fixture `share-v3-golden.bin`.
- [ ] Drop `CompressionStream` from the v3 path in `shareLink.ts` (keep it for v1/v2 decode forever).
- [ ] Run `share_bench` and `share_precision`; replace the stage-3 row; measure the wasm size delta on
      `oristudio_cp_wasm_bg.wasm` and record it.

### Stage 4 — the tail (deferred)

- [ ] `#s=<id>` fragment key, a `/s/:id` resolver, and the encoder's "over budget → offer a short
      link" path.
- [ ] Retention, privacy and deletion policy for stored payloads, written down before any storage
      exists.
- [ ] Parametric escape hatch: share the `.bps` design instead of the expanded CP when one exists.
- [ ] Desktop deep link through the `useTauriOpenedFiles` channel.
- [ ] Optional: the algebraic-module alphabet as `format_version = 4`, only if the median link length
      is a measured product complaint.
