import type { OristudioCpCommandPayload } from '../engine/oristudioCpTypes';

export type OristudioCpCommandPayloadValidation =
  { ok: true; payload: OristudioCpCommandPayload } | { ok: false; error: string };

export function normalizeOristudioCpCommandPayload(
  rawPayload: unknown,
): OristudioCpCommandPayloadValidation {
  if (rawPayload === null || rawPayload === undefined) return { ok: true, payload: {} };
  if (!isRecord(rawPayload)) {
    const kind = Array.isArray(rawPayload) ? 'array' : typeof rawPayload;
    return {
      ok: false,
      error: `Invalid crease-pattern command payload: expected an object, null, or undefined, received ${kind}.`,
    };
  }
  return { ok: true, payload: compactOristudioCpCommandPayload(rawPayload) };
}

function compactOristudioCpCommandPayload(payload: object): OristudioCpCommandPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as OristudioCpCommandPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
