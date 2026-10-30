# AppImage build tooling

The Linux AppImage is produced by `tauri-bundler`, which drives `linuxdeploy`
with its GTK plugin. This directory exists because that plugin needs one change
and there is no configuration knob for it.

## Why

The plugin deploys GLib into the AppDir, and `linuxdeploy` deploys it again as
an ordinary dependency of the app binary — the AppImage excludelist does not
name `libglib-2.0.so.0`, `libgio-2.0.so.0`, `libgobject-2.0.so.0` or
`libgmodule-2.0.so.0`. So the AppImage carried whatever the build runner had,
which is GLib **2.72.4** on the pinned `ubuntu-22.04` runner.

That copy wins over the host's for every symbol, but it does not stop the
host's GIO modules from being scanned: the plugin's AppRun hook sets
`GIO_EXTRA_MODULES` and never `GIO_MODULE_DIR`, so libgio still reads its
compiled-in `/usr/lib/<arch>/gio/modules`. On any distro newer than the runner,
every module there was built against a newer GLib and none of them load:

```
/usr/lib/x86_64-linux-gnu/gvfs/libgvfscommon.so: undefined symbol: g_task_set_static_name
```

It is noisy rather than fatal — GIO prints and carries on — but it costs gvfs in
the file chooser and leaves GSettings on the memory backend. See
`implementation-plans/appimage-host-glib.md` for the full diagnosis.

## What is here

### `linuxdeploy-plugin-gtk.sh`

Upstream's plugin, vendored, with **one appended block** that deletes the GLib
sonames from the AppDir. It is appended rather than woven into upstream's logic
so that re-syncing is a copy plus a re-append.

Provenance: upstream `tauri-apps/linuxdeploy-plugin-gtk`,
`linuxdeploy-plugin-gtk.sh` on `master`,
sha256 `cb379f9b0733e9ad9f8bd78f8c2fa038aef2478523bb7d4c8e64ff6a1ea3501a` — the
copy `tauri-bundler` 2.9.x fetches at build time. Vendoring also pins it: until
now the release job, which holds the signing keys, fetched this script from a
`master` branch on every build.

To re-sync, diff against upstream and re-append the block:

```bash
curl -sSL https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh \
  -o /tmp/upstream-gtk.sh
diff /tmp/upstream-gtk.sh scripts/appimage/linuxdeploy-plugin-gtk.sh
```

Everything before `Ori Studio local change` must match. `scripts/verify-appimage-bundle.test.mjs`
asserts that the block still sweeps exactly the sonames the verifier refuses, so
a re-sync that drops it fails `npm run test:scripts`.

### `install-appimage-tools.sh`

Copies that plugin into `<cargo target dir>/.tauri/`, which is where
`tauri-bundler` looks — and, crucially, where it *skips the download* because
the file already exists. Run it before `tauri build` on any Linux host.

`bundle.useLocalToolsDir` in `apps/tauri/src-tauri/tauri.linux.conf.json` is
what puts that directory under `target/` instead of the machine-global user
cache. It is in the Linux-only config file for two reasons: Windows' NSIS and
WiX downloads read the same setting and have no reason to move, and a patched
plugin in `~/.cache/tauri` would silently apply to every other Tauri project
built on that machine.

## The check that makes this safe

Every mechanism above is a silent one. `bundle.useLocalToolsDir` could be
renamed, `prepare_tools` could stop skipping existing files, `linuxdeploy` could
run plugins before deploying dependencies — and each would put GLib back with
nothing in the build looking wrong.

So `scripts/verify-appimage-bundle.mjs` extracts the built AppImage and fails
the release if any GLib library is inside, or if GTK and WebKit are not. It runs
in the Linux legs of `.github/workflows/release.yml`, after the build and before
the upload.
