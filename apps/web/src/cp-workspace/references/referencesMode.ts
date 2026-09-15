/**
 * The References workspace's two modes, and what each of its surfaces shows
 * in each.
 *
 * The workspace does two jobs. *Find a reference* answers "how do I get this
 * point or crease?" for one picked target, from a blank sheet, the way
 * ReferenceFinder does. *Folding sequence* reads the planner's whole
 * precrease order for the pattern. They used to be one surface, decided by
 * whether something was picked: the sequence ran on arrival, and a crease
 * could only be asked about once the step being read had folded it — so a
 * crease made late in the sequence was reachable only from the last card.
 * Zach (2026-09-15): "a lot of people will want … just a way to ask, like how
 * do I get a specific point or line?"
 *
 * The mode is where the reader is, like the active step — workspace view
 * state (`referencesView.mode`), not a setting — and it decides what the
 * canvas draws, whether the filmstrip is there, and what the one line under
 * the toolbar (the *lead*) says. Those decisions are here, as data, so the
 * panel composes and the rules are tested without a store.
 */

export type ReferencesMode = 'find' | 'sequence';

/** What the workspace has to go on, whichever mode it is in. */
export interface ReferencesModeInput {
  mode: ReferencesMode;
  /** A vertex or crease is picked. Only Find has one; leaving Find clears it. */
  targeted: boolean;
  /**
   * The selected sheet has creases beyond its border. A new document is a
   * border and nothing else, and there is nothing to find or to plan on it.
   */
  hasCreases: boolean;
  /** A plan for this sheet, at this revision, is there to read. */
  planned: boolean;
  /** A computation is in flight. */
  busy: boolean;
}

/**
 * The line under the toolbar where the filmstrip goes once there are cards.
 * The filmstrip is not rendered until then — an empty strip with two arrows
 * reads as broken — so this is what stands in its place.
 */
export type ReferencesLead =
  | { kind: 'none' }
  /** Find, nothing picked: how to ask. */
  | { kind: 'hint-find' }
  /** Sequence, being planned: the wait, said where the cards will be. */
  | { kind: 'planning' }
  /**
   * Sequence, nothing to read and nothing running: the plan was stopped or
   * failed, or the sheet has not been tried. The way to ask is a button.
   */
  | { kind: 'plan' };

export interface ReferencesSurfaces {
  /**
   * Which visibility rule the canvas draws by: the sheet whole and at full
   * strength; the paper's outline and the picked crease; or the sheet as it
   * stands at the active step, with the creases still to come as ghosts.
   */
  canvas: 'whole' | 'target' | 'plan';
  /** What the filmstrip shows, or that it is not rendered at all. */
  strip: 'none' | 'candidate' | 'plan';
  lead: ReferencesLead;
  /**
   * What a tap on the sheet does: ask ReferenceFinder about the target, jump
   * to the step that makes the crease, or nothing.
   */
  pick: 'query' | 'jump' | 'none';
  /** The sheet is a border and nothing else; the body says so instead. */
  emptySheet: boolean;
}

export function referencesSurfaces(input: ReferencesModeInput): ReferencesSurfaces {
  const { mode, targeted, hasCreases, planned, busy } = input;
  if (!hasCreases) {
    return { canvas: 'whole', strip: 'none', lead: { kind: 'none' }, pick: 'none', emptySheet: true };
  }
  if (mode === 'find') {
    if (targeted) {
      return {
        canvas: 'target',
        strip: 'candidate',
        lead: { kind: 'none' },
        pick: 'query',
        emptySheet: false,
      };
    }
    return {
      canvas: 'whole',
      strip: 'none',
      lead: { kind: 'hint-find' },
      pick: 'query',
      emptySheet: false,
    };
  }
  if (planned) {
    return { canvas: 'plan', strip: 'plan', lead: { kind: 'none' }, pick: 'jump', emptySheet: false };
  }
  return {
    canvas: 'whole',
    strip: 'none',
    lead: { kind: busy ? 'planning' : 'plan' },
    pick: 'none',
    emptySheet: false,
  };
}
