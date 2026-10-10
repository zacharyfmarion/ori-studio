/**
 * The open step's linked Pose, passed on to the surfaces beside the step
 * detail that offer its verbs too — the Step pane in Pose (D13).
 *
 * There is one pose controller per open step, and it holds the fold between
 * verbs (`useDiagramLinkedPose`, owned by the Diagram panel, which draws the
 * live 3D view). A second surface calling that hook would open a second
 * capture session on the same step; this only shares the first.
 */
import { useSyncExternalStore } from 'react';
import type { DiagramLinkedPose } from './useDiagramLinkedPose';

let open: { stepId: string; pose: DiagramLinkedPose } | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The pose of the step open in detail, or null when none is or it is not linked. */
export function publishOpenLinkedPose(stepId: string | null, pose: DiagramLinkedPose | null): void {
  const next = stepId !== null && pose !== null ? { stepId, pose } : null;
  if (next?.stepId === open?.stepId && next?.pose === open?.pose) return;
  open = next;
  for (const listener of listeners) listener();
}

/** The linked Pose of `stepId`, while it is the step open in detail; null otherwise. */
export function useOpenLinkedPose(stepId: string | null): DiagramLinkedPose | null {
  const current = useSyncExternalStore(subscribe, () => open);
  return current !== null && current.stepId === stepId ? current.pose : null;
}

/** The linked Pose of `stepId` while it is the step open in detail, for a verb run outside React. */
export function openLinkedPoseOf(stepId: string): DiagramLinkedPose | null {
  return open !== null && open.stepId === stepId ? open.pose : null;
}

/**
 * The live simulator Pose shows for a step shown as Simulated, as far as a
 * surface beside it needs it: its "rest now", which captures the model where
 * it is if that is not the step's picture already — Pose Again on a step
 * already open (D19). Registered by the view while it is up.
 */
let restNow: { stepId: string; run: () => void } | null = null;

/** The open simulated view's rest now, until the returned function lets it go. */
export function registerSimulatedRestNow(stepId: string, run: () => void): () => void {
  const entry = { stepId, run };
  restNow = entry;
  return () => {
    if (restNow === entry) restNow = null;
  };
}

/** Bring `stepId`'s live simulator to a rest now; false when Pose shows no simulator for it. */
export function simulatedRestNow(stepId: string): boolean {
  if (restNow === null || restNow.stepId !== stepId) return false;
  restNow.run();
  return true;
}
