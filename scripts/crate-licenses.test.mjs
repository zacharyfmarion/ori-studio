/**
 * Every crate license that says which crate it covers names the crate it sits
 * in.
 *
 * The license texts under `crates/` open with "This crate (`name`) is …" and
 * say whether the crate is a port (and of whose code) or original work. They
 * are written by copying a sibling's file, and a copy that keeps the sibling's
 * opening misattributes the crate: `oristudio-precrease-wasm`'s MIT text once
 * described `treemaker-flatfold`, a port of Jason S. Ku's Flat-Folder, though
 * the bridge ports nothing. `LICENSING.md` holds the crate-by-crate table.
 *
 * Run with `npm run test:scripts`, which CI's web-client job also runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CRATES = fileURLToPath(new URL('../crates/', import.meta.url));

const LICENSE_FILE = /^LICENSE(-MIT|-APACHE)?(\.txt|\.md)?$/;

/** The opening this test reads, e.g. "This crate (`oristudio-bp` and …)". */
const NAMED_CRATE = /This crate \(`([^`]+)`/;

/** The `[package]` name in a `Cargo.toml`. */
function packageName(manifest) {
  const pkg = manifest.split(/^\[/m).find((section) => section.startsWith('package]'));
  return pkg?.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
}

function crateLicenses() {
  const found = [];
  for (const dir of readdirSync(CRATES)) {
    const root = join(CRATES, dir);
    if (!statSync(root).isDirectory()) continue;
    let manifest;
    try {
      manifest = readFileSync(join(root, 'Cargo.toml'), 'utf8');
    } catch {
      continue;
    }
    const crate = packageName(manifest);
    for (const file of readdirSync(root).filter((name) => LICENSE_FILE.test(name))) {
      found.push({ dir, file, crate, text: readFileSync(join(root, file), 'utf8') });
    }
  }
  return found;
}

test('a crate license names the crate it is in', () => {
  const licenses = crateLicenses();
  const named = licenses.filter(({ text }) => NAMED_CRATE.test(text));
  // The Fold, geometry, layer-order, precrease, CP, BP and Flat-Folder crates
  // all open this way; a regex that stopped matching would pass vacuously.
  assert.ok(named.length >= 9, `only ${named.length} licenses name their crate`);
  const wrong = named
    .map(({ dir, file, crate, text }) => ({
      path: `crates/${dir}/${file}`,
      crate,
      names: text.match(NAMED_CRATE)[1],
    }))
    .filter(({ crate, names }) => crate !== names);
  assert.deepEqual(wrong, []);
});

test('the package name is read from [package], not a [[bin]] or [lib] section', () => {
  const manifest = '[package]\nname = "a"\nversion = "1"\n\n[[bin]]\nname = "b"\n';
  assert.equal(packageName(manifest), 'a');
  assert.equal(packageName('[lib]\nname = "c"\n[package]\nname = "d"\n'), 'd');
});
