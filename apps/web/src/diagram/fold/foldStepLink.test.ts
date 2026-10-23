import { describe, expect, it } from 'vitest';

import { foldNodeDigest } from '../../fold/document/foldDigest';
import { sequenceOf, step, valleyAt } from '../../fold/document/foldSequence.fixtures';
import { setFoldStartSide } from '../../fold/document/foldSequenceEdits';
import type { FoldSequenceDocument, FoldStepNode } from '../../fold/document/foldSequenceDocument';
import { foldStepSource } from '../document/diagramSteps.fixtures';
import type { DiagramFoldStepSource } from '../document/diagramDocument';
import { foldLinkNeedsReplay, foldStepLinkStatus, type FoldLinkReplay, type FoldReplayedNode } from './foldStepLink';

const SEQUENCE = sequenceOf([
  step('fstep-1', null, valleyAt(0.5)),
  step('fstep-2', 'fstep-1', valleyAt(0.25)),
  step('fstep-3', 'fstep-2', valleyAt(0.75)),
]);

const landed = (fingerprint: string): FoldReplayedNode => ({ status: 'ok', fingerprint });

/** The session's replay of `document`: every step landed at `fs1:<id>`, the sheet at `fs1:sheet`, as patched. */
function replayOf(
  document: FoldSequenceDocument,
  patch: Record<string, FoldReplayedNode> = {},
  sheet: FoldReplayedNode = landed('fs1:sheet')
): FoldLinkReplay {
  const nodes = new Map<string, FoldReplayedNode>(document.steps.map((node) => [node.id, landed(`fs1:${node.id}`)]));
  for (const [id, node] of Object.entries(patch)) nodes.set(id, node);
  return { sequenceId: document.id, sheet, nodes };
}

/** A link to step 2 of `document`, as captured while it landed what the replay says. */
function linkTo(document: FoldSequenceDocument, patch: Partial<DiagramFoldStepSource> = {}): DiagramFoldStepSource {
  return foldStepSource({
    sequence: document.id,
    step: 'fstep-2',
    path: foldNodeDigest(document, 'fstep-2')!,
    // Before step 2: the state step 1 landed.
    state: 'fs1:fstep-1',
    ...patch,
  });
}

const context = (document: FoldSequenceDocument, replay: FoldLinkReplay | null = replayOf(document)) => ({
  sequences: [{ document }],
  replay,
});

describe('a Fold step link’s status (D17)', () => {
  it('is current while the step lands the state it was captured showing, before it and after', () => {
    expect(foldStepLinkStatus(linkTo(SEQUENCE), context(SEQUENCE))).toBe('current');
    const after = linkTo(SEQUENCE, { moment: 'after', state: 'fs1:fstep-2' });
    expect(foldStepLinkStatus(after, context(SEQUENCE))).toBe('current');
  });

  it('reads the sheet’s state for the moment before a first step', () => {
    const first = linkTo(SEQUENCE, { step: 'fstep-1', path: foldNodeDigest(SEQUENCE, 'fstep-1')!, state: 'fs1:sheet' });
    expect(foldStepLinkStatus(first, context(SEQUENCE))).toBe('current');
    expect(foldStepLinkStatus(first, context(SEQUENCE, replayOf(SEQUENCE, {}, landed('fs1:another'))))).toBe('stale');
  });

  it('is stale when the step lands another state — a changed engine, a changed state upstream — and counted', () => {
    const replay = replayOf(SEQUENCE, { 'fstep-1': { status: 'changed', fingerprint: 'fs1:new' } });
    expect(foldStepLinkStatus(linkTo(SEQUENCE), context(SEQUENCE, replay))).toBe('stale');
  });

  it('ignores the engine version: a new engine that lands the same state leaves it current', () => {
    expect(foldStepLinkStatus(linkTo(SEQUENCE, { engine: 99 }), context(SEQUENCE))).toBe('current');
  });

  it('is stale, not missing, when the path changed under a step that still lands (Front up / Back up)', () => {
    const flipped = setFoldStartSide(SEQUENCE, 'back');
    expect(foldNodeDigest(flipped, 'fstep-2')).not.toBe(foldNodeDigest(SEQUENCE, 'fstep-2'));
    // Even were the state the same, the path the link names is not the one it lands along now.
    expect(foldStepLinkStatus(linkTo(SEQUENCE), context(flipped, replayOf(flipped)))).toBe('stale');
  });

  it.each([
    ['the sequence is gone', (link: DiagramFoldStepSource) => ({ link: { ...link, sequence: 'fold-gone' }, document: SEQUENCE })],
    ['the step is gone', (link: DiagramFoldStepSource) => ({ link: { ...link, step: 'fstep-gone' }, document: SEQUENCE })],
  ])('is missing when %s', (_label, make) => {
    const { link, document } = make(linkTo(SEQUENCE));
    expect(foldStepLinkStatus(link, context(document))).toBe('missing');
  });

  it('is missing when the step no longer folds (broken), its own refusal or one above it', () => {
    const broken: FoldReplayedNode = { status: 'broken', fingerprint: null };
    expect(foldStepLinkStatus(linkTo(SEQUENCE), context(SEQUENCE, replayOf(SEQUENCE, { 'fstep-2': broken })))).toBe('missing');
  });

  it('is unknown while nothing replays it: no session held, another sequence shown, or its replay pending', () => {
    expect(foldStepLinkStatus(linkTo(SEQUENCE), context(SEQUENCE, null))).toBe('unknown');
    const other = { ...replayOf(SEQUENCE), sequenceId: 'fold-other' };
    expect(foldStepLinkStatus(linkTo(SEQUENCE), context(SEQUENCE, other))).toBe('unknown');
    const pending: FoldReplayedNode = { status: 'pending', fingerprint: null };
    expect(foldStepLinkStatus(linkTo(SEQUENCE), context(SEQUENCE, replayOf(SEQUENCE, { 'fstep-2': pending })))).toBe('unknown');
    // The step landed, the state it folds from not yet reported.
    expect(foldStepLinkStatus(linkTo(SEQUENCE), context(SEQUENCE, replayOf(SEQUENCE, { 'fstep-1': pending })))).toBe('unknown');
  });

  it('is unknown for a step a newer build made, or one folded from such a step: locked', () => {
    const locked: FoldStepNode = { id: 'fstep-1', parent: null, unknown: { id: 'fstep-1', parent: null, op: { kind: 'swivel' } } };
    const document = sequenceOf([locked, step('fstep-2', 'fstep-1', valleyAt(0.25))]);
    const replay = replayOf(document, { 'fstep-1': { status: 'locked', fingerprint: null }, 'fstep-2': { status: 'locked', fingerprint: null } });
    expect(foldStepLinkStatus(linkTo(document), context(document, replay))).toBe('unknown');
  });
});

describe('the status of a link to a run of steps drawn as one', () => {
  /** Steps 2 and 3 as one: the state before step 2, along step 3's path. */
  const runOf = (document: FoldSequenceDocument, patch: Partial<DiagramFoldStepSource> = {}) =>
    linkTo(document, { through: 'fstep-3', path: foldNodeDigest(document, 'fstep-3')!, ...patch });
  /** `document` with step `id` folding another way: a Repeat rebuilt, a Collapse updated in place. */
  const edited = (document: FoldSequenceDocument, id: string) =>
    sequenceOf(document.steps.map((node) => (node.id === id ? step(node.id, node.parent, valleyAt(0.6)) : node)));

  it('is current while the run lands what it was captured showing: the state before its first step', () => {
    expect(foldStepLinkStatus(runOf(SEQUENCE), context(SEQUENCE))).toBe('current');
    const replay = replayOf(SEQUENCE, { 'fstep-1': { status: 'changed', fingerprint: 'fs1:new' } });
    expect(foldStepLinkStatus(runOf(SEQUENCE), context(SEQUENCE, replay))).toBe('stale');
  });

  it('is stale when either step of it changes: the last step’s path names both', () => {
    for (const id of ['fstep-2', 'fstep-3']) {
      const document = edited(SEQUENCE, id);
      expect(foldNodeDigest(document, 'fstep-3')).not.toBe(foldNodeDigest(SEQUENCE, 'fstep-3'));
      expect(foldStepLinkStatus(runOf(SEQUENCE), context(document, replayOf(document)))).toBe('stale');
    }
  });

  it('is missing when its last step is gone, or no longer folds from its first', () => {
    const gone = sequenceOf(SEQUENCE.steps.filter((node) => node.id !== 'fstep-3'));
    expect(foldStepLinkStatus(runOf(SEQUENCE), context(gone))).toBe('missing');
    const backwards = linkTo(SEQUENCE, { step: 'fstep-3', through: 'fstep-2' });
    expect(foldStepLinkStatus(backwards, context(SEQUENCE))).toBe('missing');
    const broken: FoldReplayedNode = { status: 'broken', fingerprint: null };
    expect(foldStepLinkStatus(runOf(SEQUENCE), context(SEQUENCE, replayOf(SEQUENCE, { 'fstep-3': broken })))).toBe('missing');
  });

  it('is unknown until its last step has landed', () => {
    const pending: FoldReplayedNode = { status: 'pending', fingerprint: null };
    expect(foldStepLinkStatus(runOf(SEQUENCE), context(SEQUENCE, replayOf(SEQUENCE, { 'fstep-3': pending })))).toBe('unknown');
    expect(foldLinkNeedsReplay(runOf(SEQUENCE), [{ document: SEQUENCE }])).toBe(true);
  });
});

describe('whether a Fold step link needs the session’s replay (D17)', () => {
  const OTHER = sequenceOf(SEQUENCE.steps, undefined, 'fold-other');
  const LOCKED = sequenceOf([
    { id: 'fstep-1', parent: null, unknown: { id: 'fstep-1', parent: null, op: { kind: 'swivel' } } },
    step('fstep-2', 'fstep-1', valleyAt(0.25)),
  ]);

  it('needs it for a step of the sequence Fold shows, the only one the session replays', () => {
    expect(foldLinkNeedsReplay(linkTo(SEQUENCE), [{ document: SEQUENCE }, { document: OTHER }])).toBe(true);
  });

  it.each([
    ['its sequence is gone', linkTo(SEQUENCE, { sequence: 'fold-gone' }), [SEQUENCE]],
    ['its step is gone', linkTo(SEQUENCE, { step: 'fstep-gone' }), [SEQUENCE]],
    ['its step is a newer build’s', linkTo(LOCKED), [LOCKED]],
    ['its sequence is not the one Fold shows', linkTo(OTHER), [SEQUENCE, OTHER]],
    ['there is no sequence at all', linkTo(SEQUENCE), []],
  ])('does not when %s: the link reads the same whatever the session replays', (_label, link, documents) => {
    const sequences = documents.map((document) => ({ document }));
    expect(foldLinkNeedsReplay(link, sequences)).toBe(false);
    const shown = documents[0];
    const replays: (FoldLinkReplay | null)[] = [null];
    if (shown) {
      replays.push(replayOf(shown));
      replays.push(replayOf(shown, Object.fromEntries(shown.steps.map((node) => [node.id, { status: 'broken', fingerprint: null }]))));
    }
    const told = new Set(replays.map((replay) => foldStepLinkStatus(link, { sequences, replay })));
    expect([...told]).toHaveLength(1);
  });
});
