import { describe, expect, it } from 'vitest';
import { wasmNullableNumber, wasmNumber, wasmString } from './wasmArgs';

describe('wasmNumber', () => {
  it('passes finite numbers through', () => {
    expect(wasmNumber('width', 12)).toBe(12);
    expect(wasmNumber('width', -0.5)).toBe(-0.5);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    // `undefined` is what a caller who omitted the argument sends; wasm-bindgen
    // would turn it into NaN rather than complain.
    ['undefined', undefined],
    ['a numeric string', '12'],
    ['an object', { width: 2 }],
  ])('rejects %s', (_label, value) => {
    expect(() => wasmNumber('width', value as number)).toThrow(
      expect.objectContaining({ code: 'invalid_input' })
    );
  });

  it('names the argument and the value it got', () => {
    expect(() => wasmNumber('width', NaN)).toThrow(
      expect.objectContaining({ message: 'width must be a finite number, got NaN' })
    );
    expect(() => wasmNumber('width', { width: 2 } as unknown as number)).toThrow(
      expect.objectContaining({ message: 'width must be a finite number, got an object' })
    );
  });
});

describe('wasmNullableNumber', () => {
  it('allows null but not other absent-looking values', () => {
    expect(wasmNullableNumber('seed', null)).toBeNull();
    expect(wasmNullableNumber('seed', 7)).toBe(7);
    expect(() => wasmNullableNumber('seed', undefined as unknown as number)).toThrow(
      expect.objectContaining({ code: 'invalid_input' })
    );
  });
});

describe('wasmString', () => {
  it('passes strings through, including ones Rust will reject', () => {
    expect(wasmString('gridType', 'rectangular')).toBe('rectangular');
    expect(wasmString('gridType', 'nonsense')).toBe('nonsense');
  });

  it.each([
    // The reported crash: an object where the signature expects positional
    // arguments. Unchecked, this traps the module with "memory access out of
    // bounds" rather than failing as an input error.
    ['an object', { width: 2, height: 4 }],
    ['undefined', undefined],
    ['null', null],
    ['a number', 4],
  ])('rejects %s', (_label, value) => {
    expect(() => wasmString('gridType', value as unknown as string)).toThrow(
      expect.objectContaining({ code: 'invalid_input' })
    );
  });
});
