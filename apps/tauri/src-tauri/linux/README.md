# Linux packaging files

Wired up through `bundle.linux.deb` in `tauri.conf.json`. Both are installed by
the `.deb`; the AppImage installs no system files, which is why the `.osf`
association works for `.deb` users and not for AppImage users.

Neither file carries explanatory comments, because both are **installed
verbatim onto the user's system** — `main.desktop` reaches
`/usr/share/applications/` and this rationale would go with it.

## `main.desktop`

Overrides the template Tauri would otherwise generate. It is upstream's file
(`crates/tauri-bundler/src/bundle/linux/freedesktop/main.desktop`) with exactly
one change: **`%F` on `Exec`**.

That field code is the whole point. Without one, the Desktop Entry Spec says the
application is launched with *no arguments*, so a double-clicked `.osf` started
Ori Studio with an empty document — the path never reached `argv_osf_paths` in
`src/lib.rs`. Everything else about the association was already correct (the
`*.osf` glob, the MIME type, the icons), which is exactly what made it look like
it worked.

`%F` rather than `%f` because the handler already filters a list of paths, and
rather than `%U` because it takes filesystem paths, not URLs. It must **not** go
on `StartupWMClass`.

The only variables the bundler exposes are `categories`, `comment`, `exec`,
`icon`, `name` and `mime_type` — there is no argument placeholder, which is why
this override exists at all. Keep the rest in sync with upstream.

## `oristudio-mime.xml`

Maps the `*.osf` glob onto `application/vnd.oristudio.project+json`, the type the
desktop entry declares it handles. Without it the association is inert even
though both halves look right: `xdg-mime query filetype design.osf` answers
`application/json` and the desktop never offers Ori Studio.

Installed to `/usr/share/mime/packages/`. The `shared-mime-info` dpkg trigger
runs `update-mime-database` on install, so no `postinst` is needed.

## Verifying a change here

These only take effect in a real `.deb`, so inspect one from a build:

```bash
gh run download <run-id> --repo zacharyfmarion/ori-studio -n OriStudio-linux
ar x "deb/Ori Studio_<version>_amd64.deb"
tar xzf data.tar.gz ./usr/share/applications/"Ori Studio.desktop"
cat "usr/share/applications/Ori Studio.desktop"
```
