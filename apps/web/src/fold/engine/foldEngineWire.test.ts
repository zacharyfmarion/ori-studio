import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FOLD_BRIDGE_REFUSAL_CODES,
  FOLD_ENGINE_REFUSAL_CODES,
  FOLD_LINE_REFUSAL_CODES,
  FOLD_REFUSAL_CODES,
} from './foldEngineWire';

/** Vitest runs in the web workspace, two levels under the repository. */
const crate = (path: string) => readFileSync(resolve(process.cwd(), '../../crates', path), 'utf8');

/** The codes a Rust `code()` match spells, in its order, between two markers of its source. */
function codesBetween(source: string, from: string, to: string): string[] {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  // Guard against passing vacuously on a moved file or a renamed item.
  expect(start, from).toBeGreaterThanOrEqual(0);
  expect(end, to).toBeGreaterThan(start);
  return [...source.slice(start, end).matchAll(/=> "([a-z_]+)"/g)].map((match) => match[1] ?? '');
}

describe('the refusal codes', () => {
  it('list exactly the engine’s, in FoldRefusal::code’s order', () => {
    const codes = codesBetween(crate('oristudio-fold/src/refusal.rs'), 'pub fn code(&self)', 'pub fn faces(&self)');
    expect(codes.length).toBeGreaterThan(30);
    expect(FOLD_ENGINE_REFUSAL_CODES).toEqual(codes);
  });

  it('list exactly an anchored line’s, in LineRefusal::code’s order', () => {
    const codes = codesBetween(crate('oristudio-fold/src/anchored.rs'), 'impl LineRefusal', 'pub enum AnchoredRefused');
    expect(codes.length).toBeGreaterThan(5);
    expect(FOLD_LINE_REFUSAL_CODES).toEqual(codes);
  });

  it('list exactly the bridge’s, in BridgeRefusal::code’s order', () => {
    const codes = codesBetween(crate('oristudio-fold-wasm/src/wire.rs'), 'impl BridgeRefusal', 'pub struct SheetMade');
    expect(codes.length).toBeGreaterThan(3);
    expect(FOLD_BRIDGE_REFUSAL_CODES).toEqual(codes);
  });

  it('never collide, so a code alone says which refusal it is', () => {
    expect(new Set(FOLD_REFUSAL_CODES).size).toBe(FOLD_REFUSAL_CODES.length);
  });
});
