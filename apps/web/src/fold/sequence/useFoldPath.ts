import { useMemo } from 'react';
import { FOLD_BLANK_SEQUENCE, FOLD_PENDING_NODE, type FoldSessionNode } from '../session/foldSessionState';
import { useFoldSessionState } from '../session/useFoldSession';
import { cursorIndex, foldPathEntries } from './foldSequencePath';

const NO_PATH: readonly string[] = [];
const NO_NODES: ReadonlyMap<string, FoldSessionNode> = new Map();

/**
 * The shown sequence and its active path, numbered, with the step on screen:
 * what every surface that lists the path's steps, or acts on them, reads.
 * While `active` is false it reads nothing of the session, so a surface that
 * needs the path only while a tool is in hand is not re-rendered by a replay.
 */
export function useFoldPath(active = true) {
  const sequence = useFoldSessionState((snapshot) => (active ? snapshot.sequence : null));
  const activePath = useFoldSessionState((snapshot) => (active ? snapshot.activePath : NO_PATH));
  const sheet = useFoldSessionState((snapshot) => (active ? snapshot.sheet : FOLD_PENDING_NODE));
  const nodes = useFoldSessionState((snapshot) => (active ? snapshot.nodes : NO_NODES));
  const cursorId = useFoldSessionState((snapshot) => (active ? snapshot.cursor : null));
  const document = sequence ?? FOLD_BLANK_SEQUENCE;
  const entries = useMemo(
    () => foldPathEntries(document, activePath, sheet, nodes, FOLD_PENDING_NODE),
    [document, activePath, sheet, nodes]
  );
  return { sequence, document, entries, cursor: cursorIndex(entries, cursorId), cursorId };
}
