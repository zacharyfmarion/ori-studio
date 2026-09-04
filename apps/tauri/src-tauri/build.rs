fn main() {
    // `native_onnx` is on where ONNX Runtime both *exists* as a pyke prebuilt and
    // *links* on the image that leg is built on. Two different things stop it:
    //
    //   x86_64-apple-darwin  `ort-sys` has never carried an Intel macOS entry in
    //                        its prebuilt table, so the build fails at the
    //                        download step: "no prebuilt binaries available".
    //   *-unknown-linux-gnu  the binaries exist, but are built against a newer
    //                        libstdc++ than the release image carries. Linking
    //                        wants GLIBCXX_3.4.32 (`_M_replace_cold`,
    //                        `__cxa_call_terminate`); ubuntu-22.04 tops out at
    //                        3.4.30. Moving the leg to ubuntu-24.04 would link,
    //                        at the cost of raising the glibc floor on the .deb
    //                        and .AppImage — so Linux takes the worker for now
    //                        and keeps running where it runs today.
    //
    // Everywhere else — Apple Silicon and both Windows arches — links clean.
    // This must agree with the `[target.'cfg(...)'.dependencies]` gates on `ort`
    // in Cargo.toml: Cargo cannot hand a target-specific dependency's presence
    // to the source as a cfg, so the predicate is written in both places.
    println!("cargo::rustc-check-cfg=cfg(native_onnx)");
    println!("cargo::rerun-if-changed=build.rs");
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    if os == "windows" || (os == "macos" && arch == "aarch64") {
        println!("cargo::rustc-cfg=native_onnx");
    }

    tauri_build::build();
}
