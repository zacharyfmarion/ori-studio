import type { KnownDiagramAnnotation } from '../document/diagramDocument';

/**
 * The callouts whose drawing is recorded (`__fixtures__/calloutsGolden.json`):
 * its line coming in from each side and through a corner, none at all with its
 * point under its box, a box off the picture, Latin, Han and kana and a mix,
 * one letter and the longest words — so the shape a callout is drawn in, its
 * pens and its words' runs, cannot move unseen.
 */
export const CALLOUT_GOLDEN_CASES: readonly KnownDiagramAnnotation[] = [
  { id: 'below-left', kind: 'callout', from: [0.15, 0.65], to: [0.55, 0.3], text: 'Repeat behind' },
  { id: 'below', kind: 'callout', from: [0.5, 0.7], to: [0.5, 0.3], text: 'Repeat on the other flap' },
  { id: 'left', kind: 'callout', from: [0.05, 0.4], to: [0.6, 0.4], text: '裏側も同様に' },
  { id: 'above-right', kind: 'callout', from: [0.8, 0.1], to: [0.4, 0.55], text: '背面重复' },
  { id: 'corner', kind: 'callout', from: [0.2, 0.2], to: [0.5, 0.5], text: 'W' },
  { id: 'covered', kind: 'callout', from: [0.52, 0.31], to: [0.5, 0.3], text: 'Repeat behind 裏も同様に' },
  { id: 'off', kind: 'callout', from: [0.9, 0.7], to: [1.3, 0.9], text: 'Repeat steps 5–8 on the other side' },
  { id: 'long', kind: 'callout', from: [0.1, 0.05], to: [0.5, 0.15], text: 'x'.repeat(80) },
];
