export type DefoxEntry =
  | { ok: true; index: number; cp: string; svg: string; snapshot: string }
  | { ok: false; index: number; error: string };
export function renderDefox(bytes: Uint8Array): DefoxEntry[];
