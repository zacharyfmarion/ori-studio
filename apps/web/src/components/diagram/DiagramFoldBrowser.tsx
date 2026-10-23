import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { FoldVertical } from 'lucide-react';
import { selectable } from '../../diagram/references/referencesBrowserSelection';
import {
  APP_FOLD_PROVIDER,
  useFoldBrowser,
  type FoldBrowser,
  type FoldBrowserProvider,
} from '../../diagram/fold/useFoldBrowser';
import type { DiagramFoldBrowserState } from '../../store/workspaceStore/types';
import { Button } from '../ui/Button';
import { DiagramFoldPicture } from './DiagramFoldPicture';
import {
  PullBrowserFrame,
  PullBrowserGrid,
  PullBrowserMessage,
  usePullBrowserDialog,
  type PullBrowserList,
} from './DiagramReferencesBrowser';
import { DiagramPullCard, DiagramPullCardThumbnail } from './DiagramReferencesCard';
import styles from './DiagramFoldBrowser.module.css';

/**
 * The Fold browser (fold-workspace plan D17): a modal over the Diagram, from
 * which a Fold sequence's steps are pulled — as References' cards are (D20),
 * in the same frame — or sent from Fold. Fold's code, mounted by
 * `DiagramFoldModal` once it has loaded.
 *
 * The browser itself: the shown sequence's active path as cards — each step
 * that folds, the turns between them, and Finished — each the step it would
 * become, its sentence Fold's own; under them what is selected and the one
 * verb, worded by where the browser was opened for. `provider` is the app's
 * Fold session, or a fake one in a test.
 */
export function DiagramFoldBrowser({
  state,
  provider = APP_FOLD_PROVIDER,
}: {
  state: DiagramFoldBrowserState;
  provider?: FoldBrowserProvider;
}) {
  const { t } = useTranslation();
  const browser = useFoldBrowser(state, provider);
  const list: PullBrowserList = {
    selection: browser.selection,
    ready: browser.cards.status === 'ready',
    pullableCount: browser.pullable.length,
    pulling: browser.pulling,
    turnOverBefore: browser.turnOverBefore,
    withTurnOver: browser.withTurnOver,
    setWithTurnOver: browser.setWithTurnOver,
    move: browser.move,
    extend: browser.extend,
    toggle: browser.toggle,
    selectAll: browser.selectAll,
    clear: browser.clear,
    add: browser.add,
    close: browser.close,
  };
  const dialog = usePullBrowserDialog(list, state.anchor);
  return (
    <PullBrowserFrame
      dialog={dialog}
      list={list}
      title={browserTitle(browser, t)}
      addLabel={addLabel(browser, t)}
      // A Fold turn is a turn over or a rotation.
      turnLabel={t('panels:diagram.fold.withTurn', 'With the turn before it')}
      tools={
        <>
          <MergeToggle browser={browser} />
          <Button size="sm" variant="ghost" onClick={browser.openFold}>
            <FoldVertical size={14} aria-hidden="true" />
            {t('panels:diagram.fold.openFold', 'Open Fold')}
          </Button>
        </>
      }
    >
      <FoldCards browser={browser} />
    </PullBrowserFrame>
  );
}

/**
 * Merge symmetric precreases: a precrease and its mirror image become one
 * step, both creases on the picture before them, as a book draws them — the
 * list shows each such run as one card. Remembered, and followed by Fold's
 * Send steps to Diagram; offered only while some run on the path would merge.
 */
function MergeToggle({ browser }: { browser: FoldBrowser }) {
  const { t } = useTranslation();
  const hint = browser.mergeable
    ? t(
        'panels:diagram.fold.mergePrecreasesHint',
        'A precrease and its mirror image become one step, both creases on one picture, as a book draws them.'
      )
    : t('panels:diagram.fold.mergePrecreasesNone', 'No precrease on this path has a mirror image to merge with.');
  return (
    <label className={styles.merge} title={hint} data-disabled={!browser.mergeable || undefined}>
      <input
        type="checkbox"
        checked={browser.merge}
        disabled={!browser.mergeable}
        onChange={(event) => browser.setMerge(event.currentTarget.checked)}
      />
      {t('panels:diagram.fold.mergePrecreases', 'Merge symmetric precreases')}
    </label>
  );
}

/** The sequence's cards, or why there are none. */
function FoldCards({ browser }: { browser: FoldBrowser }) {
  const { t } = useTranslation();
  const { cards } = browser;
  if (cards.status === 'empty') {
    return (
      <PullBrowserMessage
        text={t('panels:diagram.fold.empty', 'Fold a step in Fold, and the sequence’s steps appear here.')}
        action={{ label: t('panels:diagram.fold.openFold', 'Open Fold'), run: browser.openFold }}
      />
    );
  }
  const offered = browser.withTurnOver ? browser.turnOverBefore : null;
  // One Tab stop: where the keyboard is, or the first card that can be selected.
  const tabStop = browser.selection.focus ?? cards.cards.find((card) => card.step)?.index ?? null;
  return (
    <PullBrowserGrid label={t('panels:diagram.fold.steps', 'Steps')}>
      {cards.cards.map((card) => (
        <DiagramPullCard
          key={card.index}
          index={card.index}
          kind={card.kind}
          title={
            card.kind === 'fold'
              ? card.through !== undefined
                ? // A merged run: the steps it joins, which become one.
                  t('panels:diagram.fold.mergedCard', 'Steps {{first}}–{{last}}', {
                    first: card.number ?? '',
                    last: card.through,
                  })
                : t('panels:diagram.fold.card', 'Step {{number}}', { number: card.number ?? '' })
              : card.kind === 'turn-over'
                ? t('panels:diagram.fold.turnCard', 'Turn')
                : t('panels:diagram.references.finished', 'Finished')
          }
          badge=""
          picture={
            <DiagramPullCardThumbnail>
              <DiagramFoldPicture picture={card.picture} />
            </DiagramPullCardThumbnail>
          }
          onPaper={false}
          unreadable={card.step === null}
          why={
            card.step === null
              ? t('panels:diagram.fold.notLanded', 'Fold hasn’t folded this step, so it can’t be added yet.')
              : undefined
          }
          sentence={card.sentence}
          ways={null}
          inDiagram={browser.inDiagram.get(card.index) ?? null}
          shownNow={false}
          selected={browser.selection.indices.has(card.index)}
          tabStop={card.index === tabStop}
          offered={offered === card.index}
          choosable={selectable(card, true)}
          onPress={(modifiers) => browser.press(card.index, modifiers)}
          onFocus={() => browser.focusOn(card.index)}
        />
      ))}
    </PullBrowserGrid>
  );
}

/** The browser's title: where what it adds goes. */
function browserTitle(browser: FoldBrowser, t: TFunction): string {
  const { anchor } = browser.state;
  const number = browser.anchorNumber;
  if (number === null || anchor.kind === 'end') return t('panels:diagram.fold.titleEnd', 'Add from Fold');
  if (anchor.kind === 'fill' && browser.anchorTakesFirst) {
    return t('panels:diagram.references.titleFill', 'Fill step {{number}}', { number });
  }
  return t('panels:diagram.references.titleAfter', 'Add after step {{number}}', { number });
}

/** The verb, as what it will do: how many steps, and where. A turn is no step (D22). */
function addLabel(browser: FoldBrowser, t: TFunction): string {
  const steps = browser.pullable.filter((target) => target.kind === 'step').length;
  const count = Math.max(1, steps);
  const { anchor } = browser.state;
  const number = browser.anchorNumber;
  if (number === null || anchor.kind === 'end') {
    return t('panels:diagram.references.addSteps', {
      count,
      defaultValue_one: 'Add step',
      defaultValue_other: 'Add {{count}} steps',
    });
  }
  if (anchor.kind === 'fill' && browser.anchorTakesFirst) {
    const rest = count - 1;
    return rest === 0
      ? t('panels:diagram.references.fill', 'Fill step {{number}}', { number })
      : t('panels:diagram.references.fillAndAdd', {
          count: rest,
          number,
          defaultValue_one: 'Fill step {{number}} and add 1 after it',
          defaultValue_other: 'Fill step {{number}} and add {{count}} after it',
        });
  }
  return t('panels:diagram.references.addAfter', {
    count,
    number,
    defaultValue_one: 'Add step after step {{number}}',
    defaultValue_other: 'Add {{count}} steps after step {{number}}',
  });
}
