import { getRuntimeSurface, type RuntimeSurface } from './runtime';

/**
 * A thing the shell around the app either supplies or does not.
 *
 * Named for what the call site depends on, never for the surface that happens to
 * have it today. `'desktop'` was standing in for six unrelated questions at once
 * — is there an IPC bridge, is there a window with a title, is there an
 * updater — and adding `'ios'` (a Tauri shell with the bridge and none of the
 * chrome) is what made the conflation visible: an iPad build answered `'desktop'`
 * and took all six branches, correctly on two of them.
 */
export type SurfaceCapability =
  /** react-router owns a real URL, so the browser's Back button works. */
  | 'browserHistoryRouting'
  /** The Rust CP kernel runs in-process over Tauri commands, not a wasm worker. */
  | 'nativeCpEngine'
  /** File dialogs and read/write go through Tauri rather than the DOM. */
  | 'nativeFileIo'
  /** There is an OS window this app owns — one it can title and close-guard. */
  | 'nativeWindowChrome'
  /** The workspace closes itself on a phone-sized touch screen. */
  | 'phoneGate'
  /** The app can replace itself in place, and offers to. */
  | 'selfUpdate'
  /** Share links are worth minting: something here can receive a URL. */
  | 'shareLinks';

/**
 * The whole platform policy of the app, in one table.
 *
 * `Record<SurfaceCapability, Record<RuntimeSurface, boolean>>` is load-bearing
 * rather than decorative: it is what makes a new surface a **compile error** in
 * every row instead of a silent inheritance of whichever branch it resembles.
 * Adding `'ios'` broke all seven rows here, which is how each one below came to
 * be a decision rather than a default. Keep it that way — a helper that maps
 * "any Tauri surface" to one flag would hand the next surface the same free ride
 * `'ios'` got from `'desktop'`.
 */
const SURFACE_CAPABILITIES: Record<SurfaceCapability, Record<RuntimeSurface, boolean>> = {
  // Only the browser build is served from a URL a user can type, bookmark or go
  // Back from. Both Tauri shells run a memory router off `tauri://localhost`,
  // where a browser router's basename means nothing and the Back gesture is the
  // OS's, not react-router's.
  browserHistoryRouting: { web: true, desktop: false, ios: false },

  // Both Tauri shells, and it is not merely "available" on iOS — it is the
  // reason the port is worth doing. The same fold measured 18s through the wasm
  // worker and ~1.5s through the native kernel, and the native path also carries
  // real fold cancellation (a Tauri command that answers while the engine mutex
  // is held) where the web path needs cross-origin isolation for its
  // SharedArrayBuffer.
  nativeCpEngine: { web: false, desktop: true, ios: true },

  // True on iOS because the IPC bridge is there and the DOM alternative is
  // worse: WKWebView has no `showOpenFilePicker` and does not honour an anchor's
  // `download`, so the browser service's save path would fail silently.
  //
  // **Not the same as saying the iOS file layer works.** A document picked on
  // iOS arrives as a security-scoped URL, and the Rust side reads paths with
  // bare `std::fs`; see `OpenedFile` in `apps/tauri/src-tauri/src/lib.rs`. This
  // flag says which implementation to route through, and routing through the one
  // that can be fixed beats routing through the one that cannot.
  nativeFileIo: { web: false, desktop: true, ios: true },

  // Desktop only, and the clearest case of the conflation this table exists to
  // undo. On iOS the window is the screen: it has no title bar to set a title
  // in, and no close to intercept for an unsaved-work prompt. The Rust side
  // draws the same line — `clamp_window_to_min` is `cfg(desktop)` for it.
  nativeWindowChrome: { web: false, desktop: true, ios: false },

  // Off on both Tauri shells. The gate exists to stop someone starting a
  // pointer-and-keyboard workspace on a phone, and it redirects to `/welcome` to
  // say so — but a memory router has no address bar, so a misfire there is a
  // dead end with no way back. On iPadOS it would misfire: a narrow Split View
  // is under the 600px threshold, and a shell resized by the OS is not the same
  // event as a user choosing a phone.
  //
  // The residue is an iPhone build, which would get the full workspace on a
  // screen that cannot hold it. That is downstream of the device-family decision
  // (iPad-only vs Universal), which has not been made; revisit here when it is.
  phoneGate: { web: true, desktop: false, ios: false },

  // Desktop only. iOS updates through the App Store or TestFlight, and an app
  // that replaced its own binary would be rejected for it — so the updater
  // plugin is cfg'd out of the iOS build entirely, and every call into it here
  // would reach a command that is not registered.
  selfUpdate: { web: false, desktop: true, ios: false },

  // Web only. Sharing mints a URL, and the point of one is that it lands in an
  // address bar; neither Tauri shell has one. Unchanged for iOS — the reasoning
  // that already excluded desktop excludes it for the same reason.
  shareLinks: { web: true, desktop: false, ios: false },
};

/**
 * Whether `surface` supplies `capability`.
 *
 * Defaults to the live surface, so the common call is `surfaceSupports('x')`.
 * Pass one explicitly where the caller is deciding *about* a surface rather than
 * running on it — `createFileService` is the example.
 */
export function surfaceSupports(
  capability: SurfaceCapability,
  surface: RuntimeSurface = getRuntimeSurface()
): boolean {
  return SURFACE_CAPABILITIES[capability][surface];
}
