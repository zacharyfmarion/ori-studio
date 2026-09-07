# AppImage: leave GLib to the host

## Goal

Stop the Linux AppImage from carrying its own GLib, so that the host's GIO
modules load instead of failing against a three-year-old copy of the library
they were built for.

Reported on Ubuntu 26.04:

```
/usr/lib/x86_64-linux-gnu/gvfs/libgvfscommon.so: undefined symbol: g_task_set_static_name
```

The shipped `Ori.Studio_0.4.0_amd64.AppImage` contains
`usr/lib/libgio-2.0.so.0.7200.4` — **GLib 2.72.4**, from the pinned
`ubuntu-22.04` runner — plus `libglib-2.0.so.0`, `libgobject-2.0.so.0` and
`libgmodule-2.0.so.0`. Its AppRun hook exports only `GIO_EXTRA_MODULES`, never
`GIO_MODULE_DIR`, so the bundled libgio still scans its compiled-in default,
`/usr/lib/x86_64-linux-gnu/gio/modules` — the *host's* directory. On 26.04 that
holds gvfs built against GLib 2.88.0, which needs `g_task_set_static_name`
(GLib 2.76+). Ubuntu links with `-Wl,-z,now`, so it fails at dlopen rather than
at first call.

It is **not fatal**: `g_io_module_load_module` prints and returns false, and the
process carries on. The cost is an alarming line on stderr, no gvfs in the file
chooser, and a memory-only GSettings backend. Fixing it also removes ~3.7 MB
from the download.

## Approach

Bundling GLib is the mistake. Everything else the AppImage ships was built
against GLib 2.72 and binds forward to a newer host copy without complaint —
measured, not assumed: of the 2,559 GLib symbols the other 158 bundled shared
objects and the app binary import, **0** are missing from Ubuntu 24.04's GLib
2.80.0 or Ubuntu 26.04's 2.88.0.

The AppImage excludelist does *not* list `libglib-2.0.so.0` and friends, so
linuxdeploy deploys them as ordinary dependencies of the app binary. Dropping
them from the GTK plugin's forced `--library=` list therefore changes nothing on
its own; they have to be removed from the AppDir explicitly.

`tauri-bundler` downloads `linuxdeploy-plugin-gtk.sh` into its tools directory
**only when that file is absent**, so writing our own copy there first is the
whole mechanism. `bundle.useLocalToolsDir` moves that directory from the user's
cache to `target/.tauri/`, which makes the path deterministic and per-checkout
rather than machine-global — it goes in `tauri.linux.conf.json` so Windows'
NSIS tooling is untouched.

The vendored plugin is upstream's file with one appended block that deletes the
GLib sonames from the AppDir. Keeping the patch to a single appended block
rather than editing upstream's logic keeps it re-appliable when upstream moves.
Vendoring also pins what is currently an unpinned `master` fetch inside the job
that holds the signing keys.

Every step above fails *silently* if it stops working — a renamed config key, a
changed tools path, a reordered linuxdeploy — and the symptom would be a
regression nobody sees until a user reports it again. So the build asserts the
outcome on the artifact: `verify-appimage-bundle.mjs` extracts the built
AppImage and fails the release if any GLib library is inside, or if the
libraries that must be there are not.

## Affected Areas

- `scripts/appimage/linuxdeploy-plugin-gtk.sh` (new, vendored + patched)
- `scripts/appimage/install-appimage-tools.sh` (new)
- `scripts/appimage/README.md` (new)
- `scripts/verify-appimage-bundle.mjs` (new) and its test
- `apps/tauri/src-tauri/tauri.linux.conf.json` (new)
- `.github/workflows/release.yml` (install step before the build, verify step
  after it)

## Checklist

- [x] Confirm the bundled GLib version and the missing symbol against the
      shipped artifact
- [x] Reproduce the failure on Ubuntu 26.04 and confirm it is non-fatal
- [x] Measure that the rest of the bundle resolves against 24.04 and 26.04 GLib
- [x] Confirm GLib is absent from the AppImage excludelist, so deletion is
      required
- [x] Vendor the GTK plugin with the AppDir sweep appended
- [x] Add the tools-install script and the Linux-only `useLocalToolsDir` config
- [x] Add the artifact verifier and its unit tests
- [x] Wire both steps into the Linux legs of the release workflow
- [x] Document provenance and how to re-sync the vendored plugin
- [ ] Run a `workflow_dispatch` Linux build and confirm the verifier passes
- [ ] Have the reporter run the resulting AppImage on Ubuntu 26.04

## Not in scope

`GTK_PATH` in the same AppRun hook also lists the host's `gtk-3.0` module
directory, and the bundled GTK 3.24.33 has the same skew problem with host GTK
modules. Nothing has reported it, and unbundling GTK is a much larger question
because the bundled WebKit is built against it.

The bundled `libgiognutls.so` and its `GIO_EXTRA_MODULES` entry stay. It was
built against GLib 2.72 and binds forward like everything else, and dropping it
would leave no TLS backend on a host without glib-networking.
