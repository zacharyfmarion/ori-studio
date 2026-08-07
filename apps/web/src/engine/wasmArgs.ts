import type { WasmErrorEnvelope } from './types';

/**
 * Argument checks for the JS→wasm boundary.
 *
 * wasm-bindgen's generated glue does not type-check what it is handed, and the
 * two scalar kinds fail in different ways. A non-string where the Rust signature
 * declares `&str` corrupts the length arithmetic inside `passStringToWasm0` and
 * traps the module, which reaches the user as a bare
 * `memory access out of bounds`. A non-number where it declares `f64` is
 * coerced to NaN and passed on without complaint.
 *
 * Neither is catchable on the Rust side — the trap happens before the exported
 * function runs, and NaN arrives as an ordinary `f64` — so the check has to
 * happen here. The engine still validates the values it is given; this only
 * guarantees the call survives the crossing well enough to be validated.
 *
 * Every helper throws a {@link WasmErrorEnvelope}, the shape the workers'
 * `normalizeError` passes through untouched, so a bad argument surfaces the same
 * way a typed engine error does.
 */

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

function invalidArgument(name: string, expected: string, value: unknown): WasmErrorEnvelope {
  return {
    code: 'invalid_input',
    message: `${name} must be ${expected}, got ${describe(value)}`,
  };
}

/** A `f64` argument: a real number, never NaN or an infinity. */
export function wasmNumber(name: string, value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidArgument(name, 'a finite number', value);
  }
  return value;
}

/** A `f64` argument the engine also accepts as absent. */
export function wasmNullableNumber(name: string, value: number | null): number | null {
  return value === null ? null : wasmNumber(name, value);
}

/** A `&str` argument. Rust rejects the unknown values; this rejects the non-strings. */
export function wasmString<T extends string>(name: string, value: T): T {
  if (typeof value !== 'string') {
    throw invalidArgument(name, 'a string', value);
  }
  return value;
}
