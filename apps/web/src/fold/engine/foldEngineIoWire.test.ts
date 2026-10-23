import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOLD_IMPORT_REFUSAL_CODES } from './foldEngineIoWire';
import { FOLD_REFUSAL_CODES } from './foldEngineWire';

/**
 * The Import CP refusals this mirror must list: the engine's
 * (`ImportRefusal::code`), then the bridge's own (`IoRefusal::code`, less
 * the arm that hands the engine's through). Vitest runs in the web
 * workspace, two levels under the repository.
 */
const CRATES = resolve(process.cwd(), '../../crates');

function codes(file: string, from: string, to: string): string[] {
  const source = readFileSync(resolve(CRATES, file), 'utf8');
  const start = source.indexOf(from);
  const body = source.slice(start, source.indexOf(to, start));
  return [...body.matchAll(/=> "([a-z_]+)"/g)].map((match) => match[1]);
}

describe('the Import CP contracts', () => {
  it('list exactly the refusal codes the engine and the bridge give, in their order', () => {
    const engine = codes('oristudio-fold/src/import/mod.rs', 'pub fn code(&self)', 'fn map_points');
    const bridge = codes('oristudio-fold-wasm/src/io/wire.rs', 'pub fn code(&self)', 'fn to_value');
    // Guard against passing vacuously on a moved file or a renamed function.
    expect(engine.length).toBeGreaterThan(15);
    expect(bridge.length).toBeGreaterThan(5);
    expect(FOLD_IMPORT_REFUSAL_CODES).toEqual([...engine, ...bridge]);
  });

  it('are refusals a replay can meet, beside the step codes', () => {
    const known: readonly string[] = FOLD_REFUSAL_CODES;
    expect(FOLD_IMPORT_REFUSAL_CODES.filter((code) => !known.includes(code))).toEqual([]);
    expect(new Set(FOLD_REFUSAL_CODES).size).toBe(FOLD_REFUSAL_CODES.length);
  });
});
