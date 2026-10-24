import type { OristudioCpDocumentSnapshot, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';

/** Immutable geometry only: never retain a kernel handle across Pose sessions. */
const documents = new WeakMap<OristudioCpDocumentSnapshot, Map<string, OristudioCpFoldedPaperScene>>();
const keyOf = (lines: string, side: string, foldCase: number, epoch: number) => `${epoch}:${side}:${foldCase}:${lines}`;

export function cachedFlatScene(document: OristudioCpDocumentSnapshot, lines: string, side: string, foldCase: number, epoch = 0) {
  const entries = documents.get(document);
  const key = keyOf(lines, side, foldCase, epoch);
  const scene = entries?.get(key);
  if (scene && entries) {
    entries.delete(key);
    entries.set(key, scene);
  }
  return scene ?? null;
}

export function rememberFlatScene(document: OristudioCpDocumentSnapshot, lines: string, side: string,
  foldCase: number, scene: OristudioCpFoldedPaperScene, epoch = 0) {
  let entries = documents.get(document);
  if (!entries) documents.set(document, entries = new Map());
  const key = keyOf(lines, side, foldCase, epoch);
  entries.delete(key);
  entries.set(key, scene);
  while (entries.size > 3) entries.delete(entries.keys().next().value!);
}
