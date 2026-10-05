import { describe, expect, it } from 'vitest';
import golden from './__fixtures__/closeUpGolden.json';
import { CLOSE_UP_CASES } from './closeUps.cases';
import { closeUpSurfaces } from './closeUps.surfaces';

/**
 * Close-ups (Phase 15f) as each surface paints them — a card, a page and the
 * canvas — recorded when they were made and checked by eye
 * (`artifacts/diagram-second-pass/15f/golden-close-ups.png`): two rings in
 * the annotation pen and the line between them, and inside the larger the
 * picture painted again, its fold at its print weight, the other marks drawn
 * larger with it, their heads and rings at theirs.
 */
describe('a close-up', () => {
  it.each(CLOSE_UP_CASES.map((entry) => [entry.id, entry.annotations] as const))(
    '%s paints as recorded on a card, a page and the canvas',
    (id, annotations) => {
      expect(closeUpSurfaces(annotations)).toEqual((golden as Record<string, unknown>)[id]);
    }
  );
});
