import type { TFunction } from 'i18next';
import {
  formatTurnDegrees,
  TURN_FRACTION,
  type TurnBetween,
  type TurnKind,
} from './turn';

/**
 * The words for a turn wherever it is shown — a Steps grid's turn card, a
 * page's glyph, a Step pane — so every sequence says a turn the same way.
 *
 * A turn written by a newer build (`unknown`) says only that it is one: its
 * kind is a stand-in. The keys are still the Diagram's, where these words were
 * first written.
 */

/**
 * What a turn says it is, in a few words: "Turn over", "Rotate 1/4 turn
 * clockwise", or for an exact angle "Rotate 30° clockwise".
 */
export function turnName(turn: TurnKind & { unknown?: unknown }, t: TFunction): string {
  if (turn.unknown !== undefined) return t('panels:diagram.turns.newer', 'Turn from a newer Ori Studio');
  if (turn.kind === 'turn-over') {
    return turn.axis === 'horizontal'
      ? t('panels:diagram.turns.turnOverTopToBottom', 'Turn over, top to bottom')
      : t('panels:diagram.turns.turnOverSideToSide', 'Turn over, side to side');
  }
  const rotation = turn.rotate;
  if (rotation.amount === 'degrees') {
    const degrees = formatTurnDegrees(rotation.degrees);
    return rotation.direction === 'cw'
      ? t('panels:diagram.turns.rotateDegreesClockwise', 'Rotate {{degrees}}° clockwise', { degrees })
      : t('panels:diagram.turns.rotateDegreesCounterclockwise', 'Rotate {{degrees}}° counterclockwise', { degrees });
  }
  const fraction = TURN_FRACTION[rotation.amount];
  return rotation.direction === 'cw'
    ? t('panels:diagram.turns.rotateClockwise', 'Rotate {{fraction}} turn clockwise', { fraction })
    : t('panels:diagram.turns.rotateCounterclockwise', 'Rotate {{fraction}} turn counterclockwise', { fraction });
}

/**
 * A turn's name for assistive tech, which says where it is as well as what it
 * is: "Turn over, side to side, between steps 3 and 4". The grid's chip and
 * the Pages view's glyph both read it.
 */
export function turnLabel(turn: TurnKind & { unknown?: unknown }, between: TurnBetween, t: TFunction): string {
  const name = turnName(turn, t);
  const where =
    between.before !== null && between.after !== null
      ? t('panels:diagram.turns.between', 'between steps {{before}} and {{after}}', { ...between })
      : between.after !== null
        ? t('panels:diagram.turns.beforeFirst', 'before step {{after}}', { ...between })
        : between.before !== null
          ? t('panels:diagram.turns.afterLast', 'after step {{before}}', { ...between })
          : '';
  return where ? t('panels:diagram.turns.chipLabel', '{{name}}, {{where}}', { name, where }) : name;
}

/** Where a turn prints, as a line of its own: "Between steps 3 and 4", or before the first or after the last. */
export function turnPlace(between: TurnBetween, t: TFunction): string | null {
  if (between.before !== null && between.after !== null) {
    return t('panels:diagram.turns.betweenSteps', 'Between steps {{before}} and {{after}}', { ...between });
  }
  if (between.after !== null) return t('panels:diagram.turns.beforeStep', 'Before step {{after}}', { ...between });
  if (between.before !== null) return t('panels:diagram.turns.afterStep', 'After step {{before}}', { ...between });
  return null;
}

/**
 * A turn's card's words (D24): its title, where a step has its number, and
 * how it turns — "Turn over" and "Side to side", "Rotate" and "1/4 turn
 * clockwise" or "30° clockwise". A newer build's says only that it is one.
 */
export function turnCardWords(turn: TurnKind & { unknown?: unknown }, t: TFunction): { title: string; how: string } {
  if (turn.unknown !== undefined) {
    return { title: t('panels:diagram.turns.cardTurn', 'Turn'), how: turnName(turn, t) };
  }
  if (turn.kind === 'turn-over') {
    return {
      title: t('panels:diagram.turns.cardTurnOver', 'Turn over'),
      how:
        turn.axis === 'horizontal'
          ? t('panels:diagram.turns.howTopToBottom', 'Top to bottom')
          : t('panels:diagram.turns.howSideToSide', 'Side to side'),
    };
  }
  const rotation = turn.rotate;
  const title = t('panels:diagram.turns.cardRotate', 'Rotate');
  if (rotation.amount === 'degrees') {
    const degrees = formatTurnDegrees(rotation.degrees);
    return {
      title,
      how:
        rotation.direction === 'cw'
          ? t('panels:diagram.turns.howDegreesClockwise', '{{degrees}}° clockwise', { degrees })
          : t('panels:diagram.turns.howDegreesCounterclockwise', '{{degrees}}° counterclockwise', { degrees }),
    };
  }
  const fraction = TURN_FRACTION[rotation.amount];
  return {
    title,
    how:
      rotation.direction === 'cw'
        ? t('panels:diagram.turns.howClockwise', '{{fraction}} turn clockwise', { fraction })
        : t('panels:diagram.turns.howCounterclockwise', '{{fraction}} turn counterclockwise', { fraction }),
  };
}

/**
 * An exact angle as a choice beside the presets' fractions — a row of the
 * Diagram's turn menu: "30°". Its words, so a control that shows an exact
 * turn reads it as the turn's card does. (The Step pane shows one as Custom,
 * its Angle field under it: `DiagramRotationControls`.)
 */
export function turnDegreesLabel(degrees: number, t: TFunction): string {
  return t('panels:diagram.turns.degrees', '{{degrees}}°', { degrees: formatTurnDegrees(degrees) });
}
