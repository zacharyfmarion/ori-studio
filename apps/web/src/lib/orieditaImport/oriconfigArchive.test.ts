import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { buildZip } from './__fixtures__/buildZip';
import { readOriconfigArchive } from './oriconfigArchive';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function fixture(name: string): Uint8Array {
  return readFileSync(resolve(FIXTURES, `${name}.oriconfig`));
}

/**
 * `readFileSync` hands back a Buffer that, under 4 KiB, is a window onto a shared
 * 8 KiB pool — so its `.buffer` is the pool and not the file. Copying out at the
 * Buffer's own offsets gives the standalone buffer the browser's
 * `File.arrayBuffer()` hands the real caller.
 */
function fixtureArrayBuffer(name: string): ArrayBuffer {
  const bytes = fixture(name);
  const isolated = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(isolated).set(bytes);
  return isolated;
}

const CONFIG_JSON = `{
  "foldWarning" : true,
  "mouseWheelMovesCreasePattern" : true,
  "laf" : "com.formdev.flatlaf.FlatDarkLaf",
  "lineWidth" : 3,
  "pointSize" : 2,
  "antiAlias" : true,
  "gridColor" : { "red" : 100, "green" : 200, "blue" : 200, "alpha" : 255 },
  "defaultDirectory" : "/Users/someone/origami",
  "recentFileList" : [ "/Users/someone/origami/crane.cp" ],
  "windowSize" : { "width" : 1280, "height" : 800 },
  "someFutureFieldWeDoNotKnow" : 42
}
`;

const HOTKEY_PROPERTIES = `#Wed Aug 12 10:25:37 PDT 2026
spacedAction=shift ctrl pressed V
colRedAction=shift pressed A
angleBisectorAction=ctrl pressed B
clearedAction=
nonAsciiAction=\\u00E9\\u65E5\\u672C
`;

describe('readOriconfigArchive', () => {
  it('reads a real Java-produced export', async () => {
    const result = await readOriconfigArchive(fixtureArrayBuffer('sample'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.get('config.json')).toBe(CONFIG_JSON);
    expect(result.entries.get('hotkey.properties')).toBe(HOTKEY_PROPERTIES);
    expect(result.unsupportedEntries).toEqual([]);
  });

  it('ignores the archive entries the import has no use for', async () => {
    // exportPref zips the whole app config directory, so unrelated bundles ride along.
    const result = await readOriconfigArchive(fixture('sample'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.entries.keys()].sort()).toEqual(['config.json', 'hotkey.properties']);
  });

  it('reads entry sizes from the central directory, not the local headers', async () => {
    // The regression this whole module exists to prevent. Java's ZipOutputStream sets
    // general-purpose bit 3, so the fixture's local headers really do claim zero bytes;
    // a reader that trusted them would pass every other test in this file with empty
    // strings. Assert the fixture still carries the trap, then that we cleared it.
    const bytes = fixture('sample');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint16(6, true) & 0x0008).toBe(0x0008);
    expect(view.getUint32(18, true)).toBe(0);
    expect(view.getUint32(22, true)).toBe(0);

    const result = await readOriconfigArchive(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.get('config.json')?.length).toBe(449);
  });

  it('reads an export from a user who never edited a hotkey', async () => {
    // Info-ZIP rather than Java: its local extra field is longer than the central one,
    // so this also covers reading each length from the header it belongs to.
    const result = await readOriconfigArchive(fixtureArrayBuffer('no-hotkey'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.get('config.json')).toBe(CONFIG_JSON);
    expect(result.entries.has('hotkey.properties')).toBe(false);
  });

  it('reads stored entries without inflating them', async () => {
    const result = await readOriconfigArchive(fixtureArrayBuffer('stored'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.get('config.json')).toBe(CONFIG_JSON);
    expect(result.entries.get('hotkey.properties')).toBe(HOTKEY_PROPERTIES);
  });

  it('reports a file that is not a zip at all', async () => {
    const notAZip = new TextEncoder().encode('this is not an archive').buffer;

    expect(await readOriconfigArchive(notAZip)).toEqual({ ok: false, reason: 'not-a-zip' });
    expect(await readOriconfigArchive(new ArrayBuffer(0))).toEqual({
      ok: false,
      reason: 'not-a-zip',
    });
  });

  it('reports an archive whose tail is missing as not a zip', async () => {
    // Nothing survives to say this ever was one: the end-of-central-directory record
    // went with the tail.
    expect(await readOriconfigArchive(fixtureArrayBuffer('truncated-tail'))).toEqual({
      ok: false,
      reason: 'not-a-zip',
    });
  });

  it('reports an archive whose body no longer matches its directory', async () => {
    expect(await readOriconfigArchive(fixtureArrayBuffer('truncated-body'))).toEqual({
      ok: false,
      reason: 'truncated',
    });
  });

  it('reports an entry whose compressed data will not inflate', async () => {
    expect(await readOriconfigArchive(fixtureArrayBuffer('corrupt-deflate'))).toEqual({
      ok: false,
      reason: 'entry-failed',
    });
  });

  it('skips an entry compressed with a method it does not implement', async () => {
    const result = await readOriconfigArchive(fixtureArrayBuffer('unsupported-method'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.get('config.json')).toBe(CONFIG_JSON);
    expect(result.entries.has('hotkey.properties')).toBe(false);
    expect(result.unsupportedEntries).toEqual([{ name: 'hotkey.properties', method: 12 }]);
  });

  it('rejects an entry whose bytes no longer match the checksum the archive carries', async () => {
    const archive = buildZip([
      { name: 'config.json', data: CONFIG_JSON },
      { name: 'hotkey.properties', data: HOTKEY_PROPERTIES, crcOverride: 0x12345678 },
    ]);

    expect(await readOriconfigArchive(archive)).toEqual({ ok: false, reason: 'entry-failed' });
  });

  it('never hands back a well-formed but wrong entry after a single-bit corruption', async () => {
    // Deflate is not self-checking. Most single-bit flips inside a compressed stream
    // still inflate, to different bytes and usually at the same length — so a length
    // check alone catches almost none of them, and an unchecked reader silently
    // rebinds the keyboard from a damaged download. The CRC in the central
    // directory is the only thing that separates the two cases.
    const pristine = await readOriconfigArchive(fixtureArrayBuffer('sample'));
    expect(pristine.ok).toBe(true);
    if (!pristine.ok) return;

    const bytes = fixture('sample');
    let rejected = 0;
    for (let index = 0; index < bytes.byteLength; index += 1) {
      const mutated = new Uint8Array(bytes);
      mutated[index] = mutated[index]! ^ 0x01;

      const result = await readOriconfigArchive(mutated);
      if (!result.ok) {
        rejected += 1;
        continue;
      }
      for (const [name, content] of result.entries) {
        expect(content, `byte ${index} changed ${name} without being reported`).toBe(
          pristine.entries.get(name)
        );
      }
    }
    // Guards the guard: if a refactor stopped reading the archive at all, every
    // mutation would trivially "match" and the loop above would assert nothing.
    expect(rejected).toBeGreaterThan(50);
  });

  it('refuses to inflate an entry past the size its own directory declared', async () => {
    // Deflate's expansion ratio is unbounded, so a small archive can declare a tiny
    // entry and inflate to hundreds of megabytes. Reading it all and checking the
    // length afterwards is not equivalent: past ~512 MiB `TextDecoder` throws
    // `Cannot create a string longer than 0x1fffffe8 characters` out of the module,
    // and a browser tab is gone well before that.
    const bomb = new Uint8Array(64 * 1024 * 1024);
    const archive = buildZip([
      {
        name: 'hotkey.properties',
        data: bomb,
        payloadOverride: new Uint8Array(deflateRawSync(Buffer.from(bomb), { level: 9 })),
        uncompressedSizeOverride: 12,
      },
    ]);
    expect(archive.byteLength).toBeLessThan(200_000);

    expect(await readOriconfigArchive(archive)).toEqual({ ok: false, reason: 'entry-failed' });
  });

  it('rejects an entry that inflates to fewer bytes than declared', async () => {
    const archive = buildZip([
      { name: 'hotkey.properties', data: HOTKEY_PROPERTIES, uncompressedSizeOverride: 999_999 },
    ]);

    expect(await readOriconfigArchive(archive)).toEqual({ ok: false, reason: 'entry-failed' });
  });

  it('finds the directory behind a trailing archive comment', async () => {
    const archive = buildZip(
      [
        { name: 'config.json', data: CONFIG_JSON },
        { name: 'hotkey.properties', data: HOTKEY_PROPERTIES },
      ],
      { comment: 'repackaged by a tool that leaves a note '.repeat(40) }
    );

    const result = await readOriconfigArchive(archive);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.get('hotkey.properties')).toBe(HOTKEY_PROPERTIES);
  });

  it('takes each variable-length field from the header it belongs to', async () => {
    // Built rather than captured, so the disagreement is unmistakable: the local
    // header carries a 21-byte extra field the central record does not mention.
    const archive = buildZip([
      {
        name: 'hotkey.properties',
        data: HOTKEY_PROPERTIES,
        dataDescriptor: true,
        localExtra: new Uint8Array(21).fill(0x55),
        centralExtra: new Uint8Array(5).fill(0x55),
      },
    ]);

    const result = await readOriconfigArchive(archive);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.get('hotkey.properties')).toBe(HOTKEY_PROPERTIES);
  });

  it('only reads entries at the root of the archive', async () => {
    // `exportPref` zips `configDir.listFiles()` under `file.getName()`, so a genuine
    // export is flat. A nested `hotkey.properties` came from somewhere else and is
    // not this user's Oriedita config; reading it would be a guess.
    const archive = buildZip([
      { name: 'oriedita/hotkey.properties', data: HOTKEY_PROPERTIES },
      { name: 'oriedita/config.json', data: CONFIG_JSON },
    ]);

    const result = await readOriconfigArchive(archive);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.entries.keys()]).toEqual([]);
  });

  it('reports every truncation of a real export without throwing', async () => {
    const bytes = fixture('sample');

    for (let end = 0; end < bytes.byteLength; end += 1) {
      const result = await readOriconfigArchive(new Uint8Array(bytes.subarray(0, end)));
      expect(result.ok, `truncating at ${end} bytes read as a complete archive`).toBe(false);
    }
  });

  it('reports a zip with nothing in it rather than inventing entries', async () => {
    expect(await readOriconfigArchive(new Uint8Array([0x50, 0x4b, 0x03]))).toEqual({
      ok: false,
      reason: 'not-a-zip',
    });

    const empty = await readOriconfigArchive(buildZip([]));
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.entries.size).toBe(0);
  });

  it('reports a runtime with no deflate support', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    try {
      expect(await readOriconfigArchive(fixtureArrayBuffer('sample'))).toEqual({
        ok: false,
        reason: 'no-decompression-support',
      });

      // Nothing in a stored archive needs inflating, so it still reads.
      const stored = await readOriconfigArchive(fixtureArrayBuffer('stored'));
      expect(stored.ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
