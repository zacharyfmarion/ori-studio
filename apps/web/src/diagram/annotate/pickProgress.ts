/**
 * What the tool in hand has to say about its last press, for the tool window:
 * how far a pick tool's sequence has come (15b) — the step the next press is
 * for, and why the last finished nothing, if it did not — and a drawing
 * tool's notice of a press that put nothing down (equal divisions clicked on
 * no line, Revision 2). What the canvas knows and the tool window says. One
 * of each is ever current: the canvas open in Annotate writes them, and
 * clears them when its tool or step goes — a notice on the next press too.
 */
import { useSyncExternalStore } from 'react';
import type { BisectorRefusal, BisectorStep } from './angleBisector';

/** The steps of the equal-angle mark put down on its own: an arm, the vertex, the other arm. */
export type AngleMarkStep = 'arm' | 'mark-vertex' | 'other-arm';

export interface PickProgress {
  step: BisectorStep | AngleMarkStep;
  refusal: BisectorRefusal | null;
}

/** A drawing tool's word on a press that put nothing down, and the tool it is about. */
export interface ToolNotice {
  tool: 'divisions';
  notice: 'no-line';
}

let current: PickProgress | null = null;
let notice: ToolNotice | null = null;
const listeners = new Set<() => void>();

function tell(): void {
  for (const listener of listeners) listener();
}

export function setPickProgress(next: PickProgress | null): void {
  if (current === next || (current && next && current.step === next.step && current.refusal === next.refusal)) return;
  current = next;
  tell();
}

export function pickProgress(): PickProgress | null {
  return current;
}

/** Say `next` in the tool window, or nothing: none on the next press or another tool. */
export function setToolNotice(next: ToolNotice | null): void {
  if (notice === next || (notice && next && notice.tool === next.tool && notice.notice === next.notice)) return;
  notice = next;
  tell();
}

export function toolNotice(): ToolNotice | null {
  return notice;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The sequence in progress, for a surface that says what it asks for next. */
export function usePickProgress(): PickProgress | null {
  return useSyncExternalStore(subscribe, pickProgress, pickProgress);
}

/** A drawing tool's notice, for a surface that says it. */
export function useToolNotice(): ToolNotice | null {
  return useSyncExternalStore(subscribe, toolNotice, toolNotice);
}
