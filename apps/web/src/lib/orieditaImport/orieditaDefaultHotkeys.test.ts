import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ORIEDITA_DEFAULT_HOTKEYS } from './orieditaDefaultHotkeys.generated';

// Drift guard for the committed snapshot of Oriedita's shipped hotkey defaults.
//
// The generated module is what ships to the browser (third_party/ does not), so nothing at
// runtime would notice it going stale — and the upstream-drift skill advancing the vendored
// pointer is exactly the moment it would. This re-reads the vendored properties file and
// re-derives the table, which is why it re-implements the parse rather than importing the
// generator: a second reading of the same file is the check. If both need the same fix, that
// fix is a real upstream format change worth looking at twice.
const SOURCE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  'third_party/oriedita/oriedita/src/main/resources/hotkey.properties'
);

// Measured against the vendored jar table. Pinned so an upstream change to *either* number is
// loud: new actions and newly-bound actions both change how an import reconstructs a keymap.
const UPSTREAM_ACTION_COUNT = 232;
const UPSTREAM_BOUND_COUNT = 34;

interface VendoredDefaults {
  bound: Record<string, string>;
  actionCount: number;
}

function readVendoredDefaults(): VendoredDefaults {
  const bound: Record<string, string> = {};
  const actions = new Set<string>();

  for (const line of readFileSync(SOURCE_PATH, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;

    const separator = trimmed.indexOf('=');
    expect(separator, `expected a "key=value" line, got ${JSON.stringify(trimmed)}`).toBeGreaterThan(
      0
    );

    const action = trimmed.slice(0, separator).trim();
    const keystroke = trimmed.slice(separator + 1).trim();
    actions.add(action);
    if (keystroke !== '') bound[action] = keystroke;
  }

  return { bound, actionCount: actions.size };
}

describe('ORIEDITA_DEFAULT_HOTKEYS', () => {
  const vendored = readVendoredDefaults();

  it('matches the vendored hotkey.properties', () => {
    // Run `npm run generate:oriedita-defaults` from apps/web to regenerate after an upstream sync.
    expect(ORIEDITA_DEFAULT_HOTKEYS).toEqual(vendored.bound);
  });

  it('covers the measured upstream action counts', () => {
    expect(vendored.actionCount).toBe(UPSTREAM_ACTION_COUNT);
    expect(Object.keys(ORIEDITA_DEFAULT_HOTKEYS)).toHaveLength(UPSTREAM_BOUND_COUNT);
  });

  it('omits unbound actions rather than recording an empty keystroke', () => {
    // An empty default carries no information, and an empty *value* in a user's archive means
    // "restore Oriedita's default" far more often than "unbind" — see the merge-semantics table
    // in implementation-plans/oriedita-settings-import.md. Neither may reach the keymap as ''.
    expect(Object.values(ORIEDITA_DEFAULT_HOTKEYS)).not.toContain('');
  });
});
