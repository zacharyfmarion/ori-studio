/**
 * What the Layer order dialog's inspector says (`implementation-plans/layer-order-dialog.md`,
 * row U10; the boards `Round3`, `Round4-States` and `Round5-Compound`): its
 * model hands it keys with their values (faces by number, counts, sentences
 * as subject–verb–objects, `layer-order/model/layerOrderSelectors.ts`), and
 * this turns them into translated sentences, faces into their letters.
 *
 * **Word order is each locale's.** A sentence is one translated template,
 * `{{subject}} {{verb}} {{objects}}` in English, so a locale that puts the
 * verb last does; the builder lays its slots out in the same template's order
 * ({@link LayerOrderCopy.sentenceParts}). Nothing is joined from fragments but
 * a list of objects ("H, K") and a list of sentences ("A and B"), each with
 * the locale's own separators.
 *
 * Copy never names an upstream: "Edit’s order" is the host's name (D19).
 *
 * Copy only: `t` with literal keys, so the extractor sees every string.
 */
import type { TFunction } from 'i18next';
import type { FaceLetters, LayerFace } from '../../layer-order/engine/faceIndex';
import type { LayerVerb } from '../../layer-order/engine/layerOrderEngine';
import type { LayerTally } from '../../layer-order/engine/layerOrderWire';
import type { LayerOpenNotice } from '../../layer-order/model/layerOrderDecisions';
import type { LayerCommitVia } from '../../layer-order/model/layerOrderState';
import type {
  LayerAddState,
  LayerHint,
  LayerRowReason,
  LayerSentenceView,
  LayerStatusText,
  LayerStatusView,
  LayerStepperView,
} from '../../layer-order/model/layerOrderSelectors';
import type { LayerOrderRequestSurface } from '../../lib/layerOrder/layerOrderRequest';

/** One part of a sentence, in the locale's order: a slot, or text between them (a particle). */
export type LayerSentencePart =
  | { readonly kind: 'subject' }
  | { readonly kind: 'verb' }
  | { readonly kind: 'objects' }
  | { readonly kind: 'text'; readonly text: string };

/** Stand-ins the template is filled with to find where each slot goes: private-use characters, never in a translation. */
const SLOT_MARKS = { subject: '', verb: '', objects: '' } as const;

/** What a refusal, a hint or a row may need to say about the panes' letters. */
export interface LayerHintContext {
  /** Some of the faces on offer are tinted but unlettered at this zoom (D7's addition). */
  readonly unlettered: boolean;
}

export interface LayerOrderCopy {
  /** A face's letter; a face that no longer exists has none. */
  readonly letter: (face: LayerFace | null) => string;
  readonly verb: (verb: LayerVerb) => string;
  /** The sentence's slots in the locale's order, with any text between them. */
  readonly sentenceParts: () => readonly LayerSentencePart[];
  /** "D in front of H, K", standing alone; a face that no longer exists is named as one. */
  readonly sentence: (view: LayerSentenceView) => string;
  /** The same, inside another sentence ("Remove a face that no longer exists in front of D"). */
  readonly clause: (view: LayerSentenceView) => string;
  /** "H, K". */
  readonly objects: (objects: readonly (LayerFace | null)[]) => string;
  readonly hint: (hint: LayerHint, context: LayerHintContext) => string;
  readonly status: (text: LayerStatusText, counting: boolean) => string;
  readonly statusTitle: (status: LayerStatusView) => string | undefined;
  readonly stepperCount: (stepper: LayerStepperView) => string;
  readonly addLabel: (add: LayerAddState) => string;
  readonly addTitle: (add: LayerAddState, hint: string | null) => string | undefined;
  readonly reason: (reason: LayerRowReason) => string;
  readonly openNotice: (notice: LayerOpenNotice) => string;
}

function capitalized(text: string, lng: string): string {
  return text.length === 0 ? text : text.charAt(0).toLocaleUpperCase(lng) + text.slice(1);
}

/** The inspector's copy in `lng`, faces named by `letters` (the opening's face index). */
export function layerOrderCopy(
  t: TFunction,
  lng: string,
  letters: FaceLetters | null,
  surface: LayerOrderRequestSurface | null = null
): LayerOrderCopy {
  const letter = (face: LayerFace | null) => (face === null ? '' : (letters?.letterOf(face) ?? ''));
  const gone = () => t('dialogs:layerOrder.faceGone', 'a face that no longer exists');
  const named = (face: LayerFace | null) => letter(face) || gone();

  const verb = (value: LayerVerb) =>
    value === 'in_front_of'
      ? t('dialogs:layerOrder.verb.inFrontOf', 'in front of')
      : t('dialogs:layerOrder.verb.behind', 'behind');

  const objects = (faces: readonly (LayerFace | null)[]) =>
    faces.map(named).join(t('dialogs:layerOrder.objectSeparator', ', '));

  /** Sentences or clauses as one list, in the locale's own words ("A and B", "A, B and C"). */
  const listed = (items: readonly string[]) => {
    try {
      return new Intl.ListFormat(lng, { type: 'conjunction' }).format(items);
    } catch {
      return items.join(', ');
    }
  };

  /** A sentence as a clause inside another: "a face that no longer exists in front of D", as it stands. */
  const clause = (view: LayerSentenceView) =>
    t('dialogs:layerOrder.sentence', '{{subject}} {{verb}} {{objects}}', {
      subject: named(view.subject),
      // A sentence whose object no longer exists has no verb to read; its object names it.
      verb: view.verb === null ? t('dialogs:layerOrder.verb.against', 'against') : verb(view.verb),
      objects: objects(view.objects),
    });

  /** A sentence that stands alone: a row's name. */
  const sentence = (view: LayerSentenceView) => capitalized(clause(view), lng);

  const sentenceParts = (): LayerSentencePart[] => {
    const marked = t('dialogs:layerOrder.sentence', '{{subject}} {{verb}} {{objects}}', SLOT_MARKS);
    const parts: LayerSentencePart[] = [];
    let text = '';
    for (const char of marked) {
      const slot = (Object.keys(SLOT_MARKS) as (keyof typeof SLOT_MARKS)[]).find((key) => SLOT_MARKS[key] === char);
      if (!slot) {
        text += char;
        continue;
      }
      if (text.trim()) parts.push({ kind: 'text', text: text.trim() });
      text = '';
      parts.push({ kind: slot });
    }
    if (text.trim()) parts.push({ kind: 'text', text: text.trim() });
    // A translation that lost a slot still shows all three, in English's order after the ones it kept.
    for (const kind of ['subject', 'verb', 'objects'] as const) {
      if (!parts.some((part) => part.kind === kind)) parts.push({ kind });
    }
    return parts;
  };

  const sentences = (views: readonly LayerSentenceView[]) => listed(views.map(clause));

  const reason = (value: LayerRowReason): string => capitalized(reasonText(value), lng);

  const reasonText = (value: LayerRowReason): string => {
    switch (value.key) {
      case 'ambiguous':
        return t(
          'dialogs:layerOrder.reason.ambiguous',
          'Not applied: a new crease split {{face}}, so this could mean either part.',
          { face: letter(value.face) }
        );
      case 'face_gone': {
        const { sentence: view } = value;
        if (value.gone === 'subject' && view.verb !== null) {
          return t('dialogs:layerOrder.reason.subjectGone', 'Not applied: the face {{verb}} {{objects}} no longer exists.', {
            verb: verb(view.verb),
            objects: objects(view.objects),
          });
        }
        if (value.gone === 'object' && view.subject !== null) {
          // A row's verb is read from its object's side, which a gone object no longer has: it is
          // named as it was ordered, "D against …".
          return t(
            'dialogs:layerOrder.reason.objectGoneAgainst',
            'Not applied: the face {{subject}} was ordered against no longer exists.',
            { subject: letter(view.subject) }
          );
        }
        return t('dialogs:layerOrder.reason.bothGone', 'Not applied: its faces no longer exist.');
      }
      case 'same_face':
        return t('dialogs:layerOrder.reason.sameFace', 'Not applied: its two faces are one face now.');
      case 'no_overlap':
        return t('dialogs:layerOrder.reason.noOverlap', 'Not applied: its faces no longer overlap.');
      case 'clashes':
        return value.clashes.length > 0
          ? t('dialogs:layerOrder.reason.clashes', 'Clashes with {{clashes}}', { clashes: sentences(value.clashes) })
          : t('dialogs:layerOrder.reason.clashesCreases', 'Clashes with the creases');
      case 'clash_within':
        return t('dialogs:layerOrder.reason.clashWithin', '{{sentence}} can’t all fit together.', {
          sentence: clause(value.sentence),
        });
      case 'waiting':
        return t('dialogs:layerOrder.reason.waiting', 'Not applied yet: it waits for the clashing constraints to be settled.');
    }
  };

  const committedRunOut = (via: LayerCommitVia): string => {
    switch (via) {
      case 'add':
        return t('dialogs:layerOrder.hint.addTimedOut', 'Couldn’t add it in time. Nothing was changed.');
      case 'remove':
        return t('dialogs:layerOrder.hint.removeTimedOut', 'Couldn’t remove it in time. Nothing was changed.');
      case 'undo':
        return t('dialogs:layerOrder.hint.undoTimedOut', 'Couldn’t undo in time. Nothing was changed.');
      case 'redo':
        return t('dialogs:layerOrder.hint.redoTimedOut', 'Couldn’t redo in time. Nothing was changed.');
      case 'clear_all':
        return t('dialogs:layerOrder.hint.clearTimedOut', 'Couldn’t clear the constraints in time. Nothing was changed.');
      case 'settle':
        return t('dialogs:layerOrder.hint.attentionTimedOut', 'Couldn’t check the saved constraints in time.');
    }
  };

  const pickObject = (count: number, tinted: boolean, unlettered: boolean) => {
    if (unlettered) {
      return t('dialogs:layerOrder.hint.pickObjectZoom', {
        count,
        defaultValue_one: 'Pick the tinted face. Zoom in to see its letter.',
        defaultValue_other: 'Pick one of the {{count}} tinted faces. Zoom in to see their letters.',
      });
    }
    if (tinted) {
      return t('dialogs:layerOrder.hint.pickObjectTinted', {
        count,
        defaultValue_one: 'Pick the tinted face',
        defaultValue_other: 'Pick one of the {{count}} tinted faces',
      });
    }
    return t('dialogs:layerOrder.hint.pickObject', {
      count,
      defaultValue_one: 'Pick the labelled face',
      defaultValue_other: 'Pick one of the {{count}} labelled faces',
    });
  };

  const attentionClash = (clashes: readonly LayerSentenceView[]) => {
    if (clashes.length === 2) {
      return t(
        'dialogs:layerOrder.hint.attentionClashPair',
        'Can’t fit: with the new creases, {{first}} clashes with {{second}}. Remove one to apply.',
        { first: clause(clashes[0]!), second: clause(clashes[1]!) }
      );
    }
    if (clashes.length > 2) {
      return t('dialogs:layerOrder.hint.attentionClashMany', 'Can’t fit: with the new creases, {{clashes}} clash. Remove one to apply.', {
        clashes: sentences(clashes),
      });
    }
    if (clashes.length === 1) {
      return t('dialogs:layerOrder.hint.attentionClashOne', 'Can’t fit: the new creases don’t allow {{sentence}}. Remove it to apply.', {
        sentence: clause(clashes[0]!),
      });
    }
    return t('dialogs:layerOrder.hint.attentionClashNone', 'Can’t fit with the new creases. Remove a constraint to apply.');
  };

  const hint = (value: LayerHint, context: LayerHintContext): string => capitalized(hintText(value, context), lng);

  const hintText = ({ text }: LayerHint, { unlettered }: LayerHintContext): string => {
    switch (text.key) {
      case 'pick_face':
        return t('dialogs:layerOrder.hint.pickFace', {
          count: text.choosers,
          defaultValue_one: 'Pick a face · {{count}} face has choices',
          defaultValue_other: 'Pick a face · {{count}} faces have choices',
        });
      case 'replace_subject':
        return t('dialogs:layerOrder.hint.replaceSubject', {
          count: text.choosers,
          face: letter(text.subject),
          defaultValue_one: 'Pick a face to replace {{face}} · {{count}} face has choices',
          defaultValue_other: 'Pick a face to replace {{face}} · {{count}} faces have choices',
        });
      case 'all_settled':
        return t('dialogs:layerOrder.hint.allSettled', 'Nothing left to choose: every overlap is settled');
      case 'face_choices':
        return t('dialogs:layerOrder.hint.faceChoices', {
          count: text.choices,
          face: letter(text.face),
          defaultValue_one: '{{face}} · {{count}} face to choose from',
          defaultValue_other: '{{face}} · {{count}} faces to choose from',
        });
      case 'face_nothing_left':
        return text.why === 'settled'
          ? t('dialogs:layerOrder.hint.faceSettled', '{{face}} · nothing left to choose: everything it overlaps is settled', {
              face: letter(text.face),
            })
          : t('dialogs:layerOrder.hint.faceAlone', '{{face}} · nothing left to choose: it overlaps no other face', {
              face: letter(text.face),
            });
      case 'subject_stuck':
        return text.why === 'settled'
          ? t(
              'dialogs:layerOrder.hint.subjectSettled',
              'Nothing left to choose for {{face}}: everything it overlaps is settled. Pick another face.',
              { face: letter(text.subject) }
            )
          : t(
              'dialogs:layerOrder.hint.subjectAlone',
              'Nothing left to choose for {{face}}: it overlaps no other face. Pick another face.',
              { face: letter(text.subject) }
            );
      case 'pick_object':
        return pickObject(text.objects, text.tinted, unlettered);
      case 'more_objects':
        return t('dialogs:layerOrder.hint.moreObjects', 'Pick more faces to add them, or a picked face to remove it.');
      case 'only_object':
        return t('dialogs:layerOrder.hint.onlyObject', '{{face}} is the only face to choose', { face: letter(text.object) });
      case 'checking':
        return t('dialogs:layerOrder.hint.checking', 'Checking {{sentence}}…', { sentence: clause(text.sentence) });
      case 'cant_fit_explaining':
        return t('dialogs:layerOrder.hint.explaining', 'Can’t fit. Finding what it clashes with…');
      case 'cant_fit':
        return text.clashes.length > 0
          ? t('dialogs:layerOrder.hint.cantFit', 'Can’t fit: with the creases, {{sentence}} clashes with {{clashes}}.', {
              sentence: clause(text.sentence),
              clashes: sentences(text.clashes),
            })
          : t('dialogs:layerOrder.hint.cantFitCreases', 'Can’t fit: the creases don’t allow {{sentence}}.', {
              sentence: clause(text.sentence),
            });
      case 'timed_out':
        return t('dialogs:layerOrder.hint.timedOut', 'Couldn’t check {{sentence}} in time.', { sentence: clause(text.sentence) });
      case 'commit_timed_out':
        return committedRunOut(text.via);
      case 'step_timed_out':
        return text.direction === 'next'
          ? t('dialogs:layerOrder.hint.stepTimedOutNext', 'Couldn’t find the next solution in time.')
          : t('dialogs:layerOrder.hint.stepTimedOutPrevious', 'Couldn’t find the previous solution in time.');
      case 'row_not_applied':
        return reason(text.reason);
      case 'attention_clash':
        return text.explaining
          ? t('dialogs:layerOrder.hint.attentionExplaining', 'Can’t fit with the new creases. Finding what clashes…')
          : attentionClash(text.clashes);
      case 'attention_checking':
        return t('dialogs:layerOrder.hint.attentionChecking', 'Checking the saved constraints…');
      case 'attention_timed_out':
        return t('dialogs:layerOrder.hint.attentionTimedOut', 'Couldn’t check the saved constraints in time.');
    }
  };

  const pictures = (count: LayerTally): string =>
    count.exact
      ? t('dialogs:layerOrder.status.pictures', {
          count: count.n,
          defaultValue_one: '{{count}} picture',
          defaultValue_other: '{{count}} pictures',
        })
      : t('dialogs:layerOrder.status.atLeastPictures', {
          count: count.n,
          defaultValue_one: 'At least {{count}} picture',
          defaultValue_other: 'At least {{count}} pictures',
        });

  // The second half of "4 pictures · 256 layer orders": mid-line, so "at least" is lower-case.
  const andLayerOrders = (count: LayerTally): string =>
    count.exact
      ? t('dialogs:layerOrder.status.andLayerOrders', {
          count: count.n,
          defaultValue_one: '{{count}} layer order',
          defaultValue_other: '{{count}} layer orders',
        })
      : t('dialogs:layerOrder.status.andAtLeastLayerOrders', {
          count: count.n,
          defaultValue_one: 'at least {{count}} layer order',
          defaultValue_other: 'at least {{count}} layer orders',
        });

  const status = (text: LayerStatusText, counting: boolean): string => {
    switch (text.key) {
      case 'pictures_and_orders':
        return t('dialogs:layerOrder.status.picturesAndOrders', '{{pictures}} · {{orders}}', {
          pictures: pictures(text.pictures),
          orders: andLayerOrders(text.orders),
        });
      case 'solutions':
        return text.count.exact
          ? t('dialogs:layerOrder.status.solutions', {
              count: text.count.n,
              defaultValue_one: '{{count}} solution',
              defaultValue_other: '{{count}} solutions',
            })
          : t('dialogs:layerOrder.status.atLeastSolutions', {
              count: text.count.n,
              defaultValue_one: 'At least {{count}} solution',
              defaultValue_other: 'At least {{count}} solutions',
            });
      case 'layer_orders':
        return text.count.exact
          ? t('dialogs:layerOrder.status.layerOrders', {
              count: text.count.n,
              defaultValue_one: '{{count}} layer order',
              defaultValue_other: '{{count}} layer orders',
            })
          : t('dialogs:layerOrder.status.atLeastLayerOrders', {
              count: text.count.n,
              defaultValue_one: 'At least {{count}} layer order',
              defaultValue_other: 'At least {{count}} layer orders',
            });
      case 'solution_n':
        return t('dialogs:layerOrder.status.solutionN', 'Solution {{index}}', { index: text.index });
      case 'none':
        return counting ? t('dialogs:layerOrder.status.counting', 'Counting solutions…') : '';
    }
  };

  const statusTitle = ({ tooltip }: LayerStatusView) =>
    tooltip
      ? t('dialogs:layerOrder.status.hiddenOnly', {
          count: tooltip.hidden,
          orders: tooltip.orders,
          defaultValue_one: '{{orders}} layer orders fit; {{count}} differs only in hidden layers',
          defaultValue_other: '{{orders}} layer orders fit; {{count}} differ only in hidden layers',
        })
      : undefined;

  // "Solution 3" until the total is exact: the index counts the solutions found so far, not their rank (E9).
  const stepperCount = ({ index, total }: LayerStepperView) => {
    if (total === null) return '';
    return total.exact
      ? t('dialogs:layerOrder.status.position', '{{index}} of {{total}}', { index, total: total.n })
      : t('dialogs:layerOrder.status.solutionN', 'Solution {{index}}', { index });
  };

  const addLabel = (add: LayerAddState) =>
    add.label === 'add_constraints'
      ? t('dialogs:layerOrder.builder.addConstraints', 'Add constraints')
      : t('dialogs:layerOrder.builder.addConstraint', 'Add constraint');

  const addTitle = (add: LayerAddState, reasonNow: string | null): string | undefined => {
    const title = addTitleText(add, reasonNow);
    return title === undefined ? undefined : capitalized(title, lng);
  };

  const addTitleText = (add: LayerAddState, hintNow: string | null): string | undefined => {
    if (add.enabled) return t('dialogs:layerOrder.builder.addTitle', 'Add {{sentence}}', { sentence: clause(add.sentence) });
    switch (add.why) {
      case 'inert':
        return undefined;
      case 'busy':
        return t('dialogs:layerOrder.builder.addBusy', 'Wait for the check to finish');
      case 'pick_subject':
        return t('dialogs:layerOrder.builder.addPickSubject', 'Pick a face first');
      case 'subject_stuck':
        return t('dialogs:layerOrder.builder.addStuck', 'Nothing left to choose for {{face}}', { face: letter(add.subject) });
      case 'pick_object':
        return t('dialogs:layerOrder.builder.addPickObject', 'Pick a face for {{face}} to go {{verb}}', {
          face: letter(add.subject),
          verb: add.sentence?.verb ? verb(add.sentence.verb) : verb('in_front_of'),
        });
      case 'checking':
        return add.sentence
          ? t('dialogs:layerOrder.builder.addChecking', 'Checking {{sentence}}', { sentence: clause(add.sentence) })
          : undefined;
      case 'cant_fit':
        return hintNow ?? undefined;
      case 'timed_out':
        return add.sentence
          ? t('dialogs:layerOrder.builder.addTimedOut', 'Couldn’t check {{sentence}} in time', { sentence: clause(add.sentence) })
          : undefined;
    }
  };

  const hostOrder = () => {
    switch (surface) {
      case 'edit_figure':
        return t('dialogs:layerOrder.notice.hostEdit', 'Edit’s order');
      case 'diagram_step':
      case 'pose':
        return t('dialogs:layerOrder.notice.hostStep', 'This step’s order');
      default:
        return t('dialogs:layerOrder.notice.hostShown', 'The order shown');
    }
  };

  const openNotice = (notice: LayerOpenNotice): string => {
    switch (notice.key) {
      case 'host_order_cant_fold':
        return notice.face !== null
          ? t(
              'dialogs:layerOrder.notice.cantFoldFace',
              '{{host}} can’t fold here: face {{face}} sits inside the fold at a crease through it. Showing the nearest order that folds.',
              { host: hostOrder(), face: letter(notice.face) }
            )
          : t('dialogs:layerOrder.notice.cantFold', '{{host}} can’t fold here. Showing the nearest order that folds.', {
              host: hostOrder(),
            });
      case 'host_order_timed_out':
        return t('dialogs:layerOrder.notice.timedOut', '{{host}} took too long to check, so the first order that folds is shown.', {
          host: hostOrder(),
        });
    }
  };

  return {
    letter,
    verb,
    sentenceParts,
    sentence,
    clause,
    objects,
    hint,
    status,
    statusTitle,
    stepperCount,
    addLabel,
    addTitle,
    reason,
    openNotice,
  };
}
