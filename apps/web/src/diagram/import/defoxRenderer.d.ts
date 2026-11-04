export type DefoxEntry =
  | { ok: true; index: number; cp: string; svg: string; snapshot: string }
  | { ok: false; index: number; error: string };
/** One step drawn, and the output the project's drawn steps have taken with it. */
export interface DrawnDefoxStep {
  entry: DefoxEntry;
  spent: number;
}
export function openDefox(bytes: Uint8Array, spent?: number): number;
export function drawDefoxStep(index: number): DrawnDefoxStep;
export function closeDefox(): void;
export function renderDefox(bytes: Uint8Array): DefoxEntry[];
