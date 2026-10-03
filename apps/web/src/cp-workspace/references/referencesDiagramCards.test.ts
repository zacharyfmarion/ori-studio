import { describe, expect, it } from 'vitest';
import { referencesPlan } from '../../diagram/document/referencesSteps.fixtures';
import type { Diagram } from './referenceFinder/solution';
import { referencesDiagramCard, referencesDiagramCards } from './referencesDiagramCards';
import type { ReferencesFilmstripStep } from './referencesFilmstrip';

/** ReferenceFinder's wire: the sheet (type 3), then a valley line (type 1, style 3). */
const RF_DIAGRAM = [
  { type: 3, width: 1, height: 1 },
  { type: 1, from: [0, 0.5], to: [1, 0.5], style: 3 },
] as unknown as Diagram;

function rfRow(diagram: Diagram, number: number): ReferencesFilmstripStep {
  return {
    key: `rf-${number}`,
    kind: 'fold',
    badge: '',
    number,
    diagram,
    primitives: null,
    mirrored: false,
    sentence: `Fold ${number}.`,
    ways: null,
  };
}

describe('referencesDiagramCards', () => {
  it('sends the card the strip shows, as the strip draws it, with its sentence, number and line', () => {
    const plan = referencesPlan();
    const index = plan.strip.findIndex((row) => row.kind === 'fold');
    const result = referencesDiagramCard(plan, index);
    expect(result.status).toBe('ok');
    const [card] = result.status === 'ok' ? result.cards : [];
    const view = plan.viewSteps[index];
    const step = view?.kind === 'fold' ? plan.variants[0]!.sequence.steps[view.step] : undefined;
    expect(card).toEqual({
      kind: 'fold',
      model: plan.strip[index]!.primitives,
      mirrored: plan.strip[index]!.mirrored,
      sentence: plan.strip[index]!.sentence,
      card: plan.strip[index]!.number,
      line: { n: step!.line.n, d: step!.line.d },
    });
  });

  it('gives a turn-over no line and no number, and takes the side it is seen from', () => {
    const plan = referencesPlan({ backFrom: 1 });
    const index = plan.strip.findIndex((row) => row.kind === 'turn-over');
    expect(index).toBeGreaterThan(-1);
    const result = referencesDiagramCard(plan, index);
    expect(result.status === 'ok' && result.cards[0]).toMatchObject({
      kind: 'turn-over',
      card: null,
      line: null,
      mirrored: false,
    });
    // The cards after it are of the back, as the strip draws them.
    const after = referencesDiagramCard(plan, index + 1);
    expect(after.status === 'ok' && after.cards[0]).toMatchObject({ kind: 'fold', mirrored: true });
  });

  it('sends all but the ending, in the strip’s order', () => {
    const plan = referencesPlan();
    const result = referencesDiagramCards(plan);
    const kept = plan.strip.filter((row) => row.kind !== 'done');
    expect(result.status === 'ok' && result.cards.map((card) => card.sentence)).toEqual(
      kept.map((row) => row.sentence)
    );
    // The ending has a picture of its own, so it is skipped by kind, not by picture.
    expect(plan.strip.at(-1)).toMatchObject({ kind: 'done', primitives: expect.anything() });
  });

  it('can still send the ending on its own', () => {
    const plan = referencesPlan();
    const result = referencesDiagramCard(plan, plan.strip.length - 1);
    expect(result.status === 'ok' && result.cards[0]!.kind).toBe('done');
  });

  it('converts ReferenceFinder’s own diagram through the card’s adapter', () => {
    const result = referencesDiagramCards({ strip: [rfRow(RF_DIAGRAM, 1)], viewSteps: [], variants: [] });
    expect(result.status === 'ok' && result.cards[0]).toMatchObject({
      card: 1,
      line: null,
      model: {
        sheet: { width: 1, height: 1 },
        primitives: [{ kind: 'sheet' }, { kind: 'line', style: 'valley' }],
      },
    });
  });

  it('refuses rather than sending a blank step when the adapter refuses a diagram', () => {
    const unreadable = [{ type: 1, from: [0, 0], to: [1, 1], style: 3 }] as unknown as Diagram;
    const strip = [rfRow(RF_DIAGRAM, 1), rfRow(unreadable, 2)];
    expect(referencesDiagramCards({ strip, viewSteps: [], variants: [] })).toEqual({ status: 'unreadable' });
    expect(referencesDiagramCard({ strip, viewSteps: [], variants: [] }, 1)).toEqual({ status: 'unreadable' });
    expect(referencesDiagramCard({ strip, viewSteps: [], variants: [] }, 5)).toEqual({ status: 'none' });
  });
});
