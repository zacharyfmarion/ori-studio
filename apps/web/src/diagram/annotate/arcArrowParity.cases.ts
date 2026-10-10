import type { KnownDiagramAnnotation } from '../document/diagramDocument';

/**
 * Every arrow an unshaped annotation can be, and every other kind beside it:
 * the cases whose drawing was recorded before arrows could be shaped
 * (`__fixtures__/arcArrowsGolden.json`), so that shaped arrows coming in
 * change nothing an arc, a push, a sign, a line or a label draws.
 */
export const ARC_ARROW_CASES: readonly KnownDiagramAnnotation[] = (() => {
  const cases: KnownDiagramAnnotation[] = [];
  const arrows = ['valley-arrow', 'mountain-arrow', 'fold-unfold-arrow'] as const;
  const shapes: { from: [number, number]; to: [number, number]; bend?: number }[] = [
    { from: [0.2, 0.3], to: [0.6, 0.3], bend: 0.1339746 },
    { from: [0.2, 0.3], to: [0.6, 0.3], bend: -0.1339746 },
    { from: [0.1, 0.7], to: [0.8, 0.2], bend: 0.5 },
    { from: [0.8, 0.2], to: [0.1, 0.7], bend: -0.5 },
    // Short: the head and the return are capped by the chord.
    { from: [0.3, 0.3], to: [0.33, 0.31], bend: 0.2 },
    // Off the picture, nearly straight.
    { from: [-0.3, 0.5], to: [0.4, 0.5], bend: 0.03 },
    // No bend written: References' 60°.
    { from: [0.5, 0.1], to: [0.5, 0.9] },
  ];
  for (const kind of arrows) {
    shapes.forEach((shape, index) => {
      cases.push({
        id: `${kind}-${index}`,
        kind,
        from: shape.from,
        to: shape.to,
        ...(shape.bend !== undefined ? { bend: shape.bend } : {}),
      });
    });
  }
  cases.push(
    { id: 'push', kind: 'push-arrow', from: [0.85, 0.9], to: [0.65, 0.8] },
    { id: 'turn', kind: 'turn-over', from: [0.5, 0.5], to: [0.5, 0.5], axis: 'horizontal' },
    { id: 'rotate', kind: 'rotate', from: [0.2, 0.8], to: [0.2, 0.8], rotate: { amount: 'eighth', direction: 'ccw' } },
    { id: 'valley-line', kind: 'valley-line', from: [0.1, 0.5], to: [0.9, 0.5] },
    { id: 'mountain-line', kind: 'mountain-line', from: [0, 0], to: [1, 1] },
    { id: 'hidden-line', kind: 'hidden-line', from: [0, 1], to: [1, 0] },
    { id: 'label', kind: 'label', from: [0.3, 0.3], to: [0.3, 0.3], text: 'A 谷折り' }
  );
  return cases;
})();
