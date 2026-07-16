# Licensing

This file summarizes the licensing posture of this repository. It is a
developer-facing guide, not legal advice.

## Project License

The Rust workspace is declared as `GPL-2.0-or-later` in `Cargo.toml`.

This is a direct Rust/WASM port of the model side of Robert J. Lang's
TreeMaker 5.0.1, so the Rust implementation should be treated as a derivative
work of TreeMaker's GPL model code. Do not relicense this port as MIT, Apache,
BSD, proprietary, or another non-GPL license unless the relevant copyright
holders explicitly grant that permission.

The root `LICENSE.txt` contains the GPL v2 license text shipped with
TreeMaker 5.0.1. The Free Software Directory also records TreeMaker as
`GPLv2orlater`.

If you distribute binaries, wasm packages, npm packages, or other object-code
forms built from this repository, the GPL requires that recipients receive or
can obtain the corresponding source code under the same GPL terms.

## Third-Party Ports

Beyond TreeMaker, this repository contains Rust/TypeScript ports of several
other origami tools. Every upstream is permissively licensed (MIT) and therefore
GPL-compatible, so bundling them inside the GPL-2.0-or-later whole is allowed.
Because the project is GPL v2 **or later**, Apache-2.0 components are compatible
too (the combined work can be taken as GPLv3). The root `NOTICE` file reproduces
each upstream copyright/permission notice; keep it in source and binary
distributions.

| Upstream | Upstream license | Ported into | Crate/package license | Attribution |
| --- | --- | --- | --- | --- |
| Box Pleating Studio (Mu-Tsun Tsai) | MIT | `oristudio-bp`, `oristudio-bp-wasm` | `oristudio-bp`: MIT; wasm wrapper: GPL-2.0-or-later (workspace) | `crates/oristudio-bp/LICENSE` + `NOTICE` |
| Oriedita / Orihime | MIT | `oristudio-cp`, `oristudio-cp-wasm` | `oristudio-cp`: MIT OR Apache-2.0; wasm wrapper: GPL-2.0-or-later (workspace) | `crates/oristudio-cp/LICENSE` + `NOTICE` |
| Flat-Folder (Jason S. Ku) | MIT | `treemaker-flatfold` | MIT OR Apache-2.0 | `crates/treemaker-flatfold/LICENSE-MIT`, `LICENSE-APACHE` + `NOTICE` |
| Origami Simulator (Amanda Ghassaei) | MIT | `packages/origami-simulator` | MIT | `packages/origami-simulator/LICENSE` + `NOTICE` |

The individual MIT crate licenses let those crates be reused on their own MIT
terms; each retains its upstream copyright notice so that reuse stays compliant.
When such a crate is combined into a shipped Ori Studio binary/wasm alongside the
GPL TreeMaker port, the combined distribution as a whole is governed by the GPL.

JavaScript/npm dependencies of the web and desktop apps are all permissive
(MIT/Apache-2.0/ISC/BSD); there are no GPL/AGPL/LGPL npm dependencies imposing
additional obligations.

## What Is Covered

| Path or artifact | License / status | Notes |
| --- | --- | --- |
| Rust workspace crates | `GPL-2.0-or-later` | `treemaker-core`, `treemaker-cli`, `treemaker-wasm`, and `oracle-tests`. |
| `LICENSE.txt` | GPL v2 text from TreeMaker 5.0.1 | Keep this file in source distributions. |
| `third_party/treemaker-5.0.1` | TreeMaker GPL source distribution | Vendored as the behavioral baseline and C++ oracle source. Preserve notices. |
| `third_party/box-pleating-studio` | MIT (Mu-Tsun Tsai) | Vendored reference/oracle source for the BP port. Preserve `LICENSE.md`. |
| `third_party/flat-folder` | MIT (Jason S. Ku) | Vendored reference/oracle source for the flat-fold port. Preserve `LICENSE`. |
| `third_party/oriedita` | MIT (Oriedita / Orihime) | Vendored reference/oracle source for the CP-editing port. Preserve `LICENSE.md`. |
| `packages/origami-simulator` | MIT (Amanda Ghassaei + port) | TypeScript port of the Origami Simulator solver. Preserve `LICENSE` and `NOTICE`. |
| `third_party/treemaker-5.0.1/Source/tmModel/wnlib` | Unrestricted per TreeMaker's bundled license notice | The TreeMaker license file says the `wnlib` directory may be distributed with no restrictions. |
| `tests/fixtures` | GPL-compatible TreeMaker fixture data | Fixtures are copied or generated from the TreeMaker parity workflow; keep them with the GPL source distribution. |
| `crates/*/testdata` | GPL-compatible TreeMaker fixture data | Small crate-local copies keep packaged crate tests self-contained. |
| `tests/corpus` | Documentation only | Real-user corpora stay external unless redistribution permission is explicit. |
| `crates/treemaker-wasm/LICENSE.txt` | GPL v2 text | Included so the generated wasm/npm package carries the license text. |
| `crates/treemaker-wasm/pkg` | Generated GPL package output | Ignored by git; if published, publish with license/source availability. |
| `target/` and other build outputs | Generated from GPL source | Ignored by git; distribution triggers GPL source obligations. |

## Optimizer Backends

TreeMaker 5.0.1 abstracts nonlinear constrained optimization behind `tmNLCO`.
The public source supports several possible adapters, but only ALM is enabled by
default in `Source/tmModel/tmNLCO/tmNLCO.h`.

| Backend | Port status | License / redistribution status | Practical effect |
| --- | --- | --- | --- |
| `ALM` | Ported | Distributable TreeMaker code | This is the parity baseline used by Rust and the C++ oracle. |
| `CFSQP` | Not ported | External/proprietary optimizer; not redistributed with TreeMaker 5.0.1 source | Would only affect numerical optimization performance/results, not file I/O or CP construction. |
| `RFSQP` | Not ported | External/evaluation FSQP-family optimizer; TreeMaker source comments note it is not redistributable | Would only affect numerical optimization performance/results. |
| `wnlib` | Not ported as an optimizer backend | Bundled `wnlib` code is unrestricted, but not enabled by default in TreeMaker 5.0.1 | Lang's bundled notes say it was faster than ALM but less reliable on some convergence tests. |

CFSQP/RFSQP are intentionally excluded unless redistributable source and
compatible license terms are provided. They are not required for TreeMaker
5.0.1 ALM parity.

## Publishing Checklist

Before publishing a repository, CLI binary, wasm package, or npm package:

1. Keep `LICENSE.txt`, `LICENSING.md`, and the TreeMaker notices in
   `third_party/treemaker-5.0.1`.
2. Publish the corresponding source for any binary or wasm artifact.
3. Do not include CFSQP/RFSQP source or binaries unless you have a separate
   redistribution license that is compatible with the GPL.
4. Make package metadata say `GPL-2.0-or-later`.
5. Keep generated package outputs from hiding the source dependency: link back
   to this repository or otherwise provide the exact source used to build them.
6. If you add new dependencies, check their licenses before release.

## Rust Dependency License Inventory

The current crates.io dependency graph is GPL-compatible. This list was
generated from `cargo metadata` against the checked-in `Cargo.lock`.

| Crate | Version | License |
| --- | --- | --- |
| `anstream` | `1.0.0` | `MIT OR Apache-2.0` |
| `anstyle` | `1.0.14` | `MIT OR Apache-2.0` |
| `anstyle-parse` | `1.0.0` | `MIT OR Apache-2.0` |
| `anstyle-query` | `1.1.5` | `MIT OR Apache-2.0` |
| `anstyle-wincon` | `3.0.11` | `MIT OR Apache-2.0` |
| `anyhow` | `1.0.102` | `MIT OR Apache-2.0` |
| `async-trait` | `0.1.89` | `MIT OR Apache-2.0` |
| `autocfg` | `1.5.0` | `Apache-2.0 OR MIT` |
| `bit-set` | `0.8.0` | `Apache-2.0 OR MIT` |
| `bit-vec` | `0.8.0` | `Apache-2.0 OR MIT` |
| `bitflags` | `2.11.1` | `MIT OR Apache-2.0` |
| `block-buffer` | `0.10.4` | `MIT OR Apache-2.0` |
| `bumpalo` | `3.20.2` | `MIT OR Apache-2.0` |
| `cast` | `0.3.0` | `MIT OR Apache-2.0` |
| `cc` | `1.2.62` | `MIT OR Apache-2.0` |
| `cfg-if` | `1.0.4` | `MIT OR Apache-2.0` |
| `clap` | `4.6.1` | `MIT OR Apache-2.0` |
| `clap_builder` | `4.6.0` | `MIT OR Apache-2.0` |
| `clap_derive` | `4.6.1` | `MIT OR Apache-2.0` |
| `clap_lex` | `1.1.0` | `MIT OR Apache-2.0` |
| `colorchoice` | `1.0.5` | `MIT OR Apache-2.0` |
| `cpufeatures` | `0.2.17` | `MIT OR Apache-2.0` |
| `crypto-common` | `0.1.7` | `MIT OR Apache-2.0` |
| `digest` | `0.10.7` | `MIT OR Apache-2.0` |
| `equivalent` | `1.0.2` | `Apache-2.0 OR MIT` |
| `errno` | `0.3.14` | `MIT OR Apache-2.0` |
| `fastrand` | `2.4.1` | `Apache-2.0 OR MIT` |
| `find-msvc-tools` | `0.1.9` | `MIT OR Apache-2.0` |
| `fnv` | `1.0.7` | `Apache-2.0 / MIT` |
| `foldhash` | `0.1.5` | `Zlib` |
| `futures-core` | `0.3.32` | `MIT OR Apache-2.0` |
| `futures-task` | `0.3.32` | `MIT OR Apache-2.0` |
| `futures-util` | `0.3.32` | `MIT OR Apache-2.0` |
| `generic-array` | `0.14.7` | `MIT` |
| `getrandom` | `0.3.4` | `MIT OR Apache-2.0` |
| `getrandom` | `0.4.2` | `MIT OR Apache-2.0` |
| `hashbrown` | `0.15.5` | `MIT OR Apache-2.0` |
| `hashbrown` | `0.17.1` | `MIT OR Apache-2.0` |
| `heck` | `0.5.0` | `MIT OR Apache-2.0` |
| `id-arena` | `2.3.0` | `MIT/Apache-2.0` |
| `indexmap` | `2.14.0` | `Apache-2.0 OR MIT` |
| `is_terminal_polyfill` | `1.70.2` | `MIT OR Apache-2.0` |
| `itoa` | `1.0.18` | `MIT OR Apache-2.0` |
| `js-sys` | `0.3.98` | `MIT OR Apache-2.0` |
| `leb128fmt` | `0.1.0` | `MIT OR Apache-2.0` |
| `libc` | `0.2.186` | `MIT OR Apache-2.0` |
| `libm` | `0.2.16` | `MIT` |
| `linux-raw-sys` | `0.12.1` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| `log` | `0.4.29` | `MIT OR Apache-2.0` |
| `memchr` | `2.8.0` | `Unlicense OR MIT` |
| `minicov` | `0.3.8` | `Apache-2.0/MIT` |
| `nu-ansi-term` | `0.50.3` | `MIT` |
| `num-traits` | `0.2.19` | `MIT OR Apache-2.0` |
| `once_cell` | `1.21.4` | `MIT OR Apache-2.0` |
| `once_cell_polyfill` | `1.70.2` | `MIT OR Apache-2.0` |
| `oorandom` | `11.1.5` | `MIT` |
| `pin-project-lite` | `0.2.17` | `Apache-2.0 OR MIT` |
| `ppv-lite86` | `0.2.21` | `MIT OR Apache-2.0` |
| `prettyplease` | `0.2.37` | `MIT OR Apache-2.0` |
| `proc-macro2` | `1.0.106` | `MIT OR Apache-2.0` |
| `proptest` | `1.11.0` | `MIT OR Apache-2.0` |
| `quick-error` | `1.2.3` | `MIT/Apache-2.0` |
| `quote` | `1.0.45` | `MIT OR Apache-2.0` |
| `r-efi` | `5.3.0` | `MIT OR Apache-2.0 OR LGPL-2.1-or-later` |
| `r-efi` | `6.0.0` | `MIT OR Apache-2.0 OR LGPL-2.1-or-later` |
| `rand` | `0.9.4` | `MIT OR Apache-2.0` |
| `rand_chacha` | `0.9.0` | `MIT OR Apache-2.0` |
| `rand_core` | `0.9.5` | `MIT OR Apache-2.0` |
| `rand_xorshift` | `0.4.0` | `MIT OR Apache-2.0` |
| `regex-syntax` | `0.8.10` | `MIT OR Apache-2.0` |
| `rustix` | `1.1.4` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| `rustversion` | `1.0.22` | `MIT OR Apache-2.0` |
| `rusty-fork` | `0.3.1` | `MIT/Apache-2.0` |
| `same-file` | `1.0.6` | `Unlicense/MIT` |
| `semver` | `1.0.28` | `MIT OR Apache-2.0` |
| `serde` | `1.0.228` | `MIT OR Apache-2.0` |
| `serde-wasm-bindgen` | `0.6.5` | `MIT` |
| `serde_core` | `1.0.228` | `MIT OR Apache-2.0` |
| `serde_derive` | `1.0.228` | `MIT OR Apache-2.0` |
| `serde_json` | `1.0.149` | `MIT OR Apache-2.0` |
| `sha2` | `0.10.9` | `MIT OR Apache-2.0` |
| `shlex` | `1.3.0` | `MIT OR Apache-2.0` |
| `slab` | `0.4.12` | `MIT` |
| `strsim` | `0.11.1` | `MIT` |
| `syn` | `2.0.117` | `MIT OR Apache-2.0` |
| `tempfile` | `3.27.0` | `MIT OR Apache-2.0` |
| `thiserror` | `2.0.18` | `MIT OR Apache-2.0` |
| `thiserror-impl` | `2.0.18` | `MIT OR Apache-2.0` |
| `typenum` | `1.20.0` | `MIT OR Apache-2.0` |
| `unarray` | `0.1.4` | `MIT OR Apache-2.0` |
| `unicode-ident` | `1.0.24` | `(MIT OR Apache-2.0) AND Unicode-3.0` |
| `unicode-xid` | `0.2.6` | `MIT OR Apache-2.0` |
| `utf8parse` | `0.2.2` | `Apache-2.0 OR MIT` |
| `version_check` | `0.9.5` | `MIT/Apache-2.0` |
| `wait-timeout` | `0.2.1` | `MIT/Apache-2.0` |
| `walkdir` | `2.5.0` | `Unlicense/MIT` |
| `wasip2` | `1.0.3+wasi-0.2.9` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| `wasip3` | `0.4.0+wasi-0.3.0-rc-2026-01-06` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| `wasm-bindgen` | `0.2.121` | `MIT OR Apache-2.0` |
| `wasm-bindgen-futures` | `0.4.71` | `MIT OR Apache-2.0` |
| `wasm-bindgen-macro` | `0.2.121` | `MIT OR Apache-2.0` |
| `wasm-bindgen-macro-support` | `0.2.121` | `MIT OR Apache-2.0` |
| `wasm-bindgen-shared` | `0.2.121` | `MIT OR Apache-2.0` |
| `wasm-bindgen-test` | `0.3.71` | `MIT OR Apache-2.0` |
| `wasm-bindgen-test-macro` | `0.3.71` | `MIT OR Apache-2.0` |
| `wasm-bindgen-test-shared` | `0.2.121` | `MIT OR Apache-2.0` |
| `wasm-encoder` | `0.244.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| `wasm-metadata` | `0.244.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| `wasmparser` | `0.244.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| `winapi-util` | `0.1.11` | `Unlicense OR MIT` |
| `windows-link` | `0.2.1` | `MIT OR Apache-2.0` |
| `windows-sys` | `0.61.2` | `MIT OR Apache-2.0` |
| `wit-bindgen` | `0.51.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| `wit-bindgen` | `0.57.1` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| `wit-bindgen-core` | `0.51.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| `wit-bindgen-rust` | `0.51.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| `wit-bindgen-rust-macro` | `0.51.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| `wit-component` | `0.244.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| `wit-parser` | `0.244.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |
| `zerocopy` | `0.8.48` | `BSD-2-Clause OR Apache-2.0 OR MIT` |
| `zerocopy-derive` | `0.8.48` | `BSD-2-Clause OR Apache-2.0 OR MIT` |
| `zmij` | `1.0.21` | `MIT` |


## Source References

- TreeMaker 5.0.1 bundled license: `third_party/treemaker-5.0.1/LICENSE.txt`
- TreeMaker optimizer notes: `third_party/treemaker-5.0.1/Source/tmModel/tmNLCO/README.txt`
- Enabled optimizer flags: `third_party/treemaker-5.0.1/Source/tmModel/tmNLCO/tmNLCO.h`
- FSF GPL v2 text: <https://www.gnu.org/licenses/old-licenses/gpl-2.0.html>
- FSF Directory TreeMaker entry: <https://directory.fsf.org/wiki/TreeMaker>
