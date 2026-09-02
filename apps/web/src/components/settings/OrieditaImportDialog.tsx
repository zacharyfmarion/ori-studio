import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Keyboard, Upload, X } from 'lucide-react';
import { bucketCount, track } from '../../analytics';
import { shortcutActionLabel, shortcutScopeLabel } from '../../i18n/shortcutLabels';
import {
  formatKeyChord,
  getShortcutDefinition,
  type ShortcutActionId,
} from '../../keyboard/shortcuts';
import {
  buildOrieditaImportPlan,
  parseJavaProperties,
  readOriconfigArchive,
  type JavaPropertyValue,
  type KeyStrokeRejectReason,
  type OriconfigArchiveFailureReason,
  type OrieditaImportEviction,
  type OrieditaImportRow,
} from '../../lib/orieditaImport';
import { getFileService } from '../../platform/fileService';
import { useShortcutStore } from '../../store/shortcutStore';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';

/**
 * Import the keyboard from an Oriedita `.oriconfig` export.
 *
 * The dialog is a review step, not a file picker with an OK button: the plan is
 * built and shown in full — what would change, and what would not, with a reason
 * per skipped row — before a single binding is written. A hotkey that vanishes
 * without explanation is the failure this whole feature exists to prevent, so
 * nothing reaches the store until Apply.
 *
 * It carries the user's *own* edits and nothing else. "I want Oriedita's layout"
 * is a standing preference, answered by the Oriedita defaults toggle in
 * Settings ▸ Shortcuts, and not something to smuggle in through a file picker.
 *
 * What the preview may show is deliberately narrow. `readOriconfigArchive` also
 * hands back `config.json`, which carries the user's `defaultDirectory` and
 * `recentFileList` — this dialog never reads it, and never renders the chosen
 * file's name or path either. Only action labels and chords are drawn.
 */

/**
 * Deliberately empty: the picker offers every file.
 *
 * `.oriconfig` is what Oriedita's own export writes, but the file reaches us
 * after a download, a rename, or a copy off another machine, and it routinely
 * arrives with no extension at all — at which point an `accept` filter greys out
 * the very file the user came here with, giving them no way to say otherwise.
 * `readOriconfigArchive` reads the actual bytes and says precisely what is wrong
 * when it is not an export, which is the better place for that judgement.
 */
const ORICONFIG_EXTENSIONS: string[] = [];

type ImportStage =
  | { readonly kind: 'choose' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'review'; readonly hotkeys: ReadonlyMap<string, JavaPropertyValue> };

function archiveFailureMessage(t: TFunction, reason: OriconfigArchiveFailureReason): string {
  switch (reason) {
    case 'not-a-zip':
      return t(
        'dialogs:orieditaImport.error.notAnExport',
        'That is not an Oriedita settings export. In Oriedita, open Preferences and choose Export.'
      );
    case 'truncated':
      return t(
        'dialogs:orieditaImport.error.damaged',
        'This settings export is incomplete and could not be read.'
      );
    case 'no-decompression-support':
      return t(
        'dialogs:orieditaImport.error.noDecompression',
        'This browser cannot unpack a settings export. Try the desktop app, or a current browser.'
      );
    case 'entry-failed':
      return t(
        'dialogs:orieditaImport.error.unreadableHotkeys',
        'The hotkeys inside this settings export could not be unpacked.'
      );
  }
}

/** Plain-language wording for each way `parseKeyStroke` refuses a keystroke. */
function rejectReasonText(t: TFunction, reason: KeyStrokeRejectReason): string {
  switch (reason) {
    case 'empty':
      return t('dialogs:orieditaImport.reason.noKeystroke', 'No key was recorded for this hotkey.');
    case 'released-not-supported':
      return t(
        'dialogs:orieditaImport.reason.released',
        'Fires when the key is let go, which Ori Studio does not do.'
      );
    case 'alt-graph-not-supported':
      return t('dialogs:orieditaImport.reason.altGraph', 'Uses AltGr, which Ori Studio cannot match.');
    case 'shift-non-letter-unrepresentable':
      return t(
        'dialogs:orieditaImport.reason.shiftNonLetter',
        'Shift with a number or punctuation key means a different character in a browser, so this shortcut could never fire.'
      );
    case 'key-location-unrepresentable':
      return t(
        'dialogs:orieditaImport.reason.keyLocation',
        'Uses a numeric keypad key, which a browser cannot tell apart from the main keyboard.'
      );
    case 'unknown-key-name':
      return t('dialogs:orieditaImport.reason.unknownKey', 'Uses a key Ori Studio does not know.');
    case 'ctrl-meta-unrepresentable':
      return t(
        'dialogs:orieditaImport.reason.ctrlMeta',
        'Holds Control and Command together, which Ori Studio treats as one modifier.'
      );
    case 'modifier-only':
      return t(
        'dialogs:orieditaImport.reason.modifierOnly',
        'Records only modifier keys, with nothing to press with them.'
      );
    case 'typed-unrepresentable':
      return t(
        'dialogs:orieditaImport.reason.typedCharacter',
        'Records a typed character rather than a key, so the key to bind depends on the keyboard layout.'
      );
  }
}

/**
 * The localized name of an action, falling back to the name the archive used.
 *
 * The fallback is reached only for an upstream action Ori Studio has no
 * counterpart for, where the upstream name is the one identifying thing the user
 * can recognize the skipped row by.
 */
function actionLabel(t: TFunction, id: ShortcutActionId | null, fallback: string): string {
  const definition = id ? getShortcutDefinition(id) : undefined;
  return definition ? shortcutActionLabel(t, definition) : fallback;
}

function skipReasonText(t: TFunction, row: OrieditaImportRow): string {
  if (row.outcome.kind !== 'skip') return '';
  switch (row.outcome.reason) {
    case 'ambiguous-empty':
      // Restore-default writes the same empty value the Clear button does, and it
      // does so for the 198 of 232 upstream actions that ship unbound — so the
      // file cannot say which one this was, and acting either way would guess.
      return t(
        'dialogs:orieditaImport.reason.ambiguousEmpty',
        'Left blank in Oriedita. Oriedita writes the same blank when a hotkey is reset to its default, so this one is left alone.'
      );
    case 'unmapped-action':
      return t(
        'dialogs:orieditaImport.reason.unmappedAction',
        'Ori Studio has no matching action.'
      );
    case 'unparseable':
      return row.detail.rejectReason
        ? rejectReasonText(t, row.detail.rejectReason)
        : t('dialogs:orieditaImport.reason.unreadable', 'This hotkey could not be read.');
    case 'reserved-chord':
      // Oriedita is a desktop application, so an exported config is full of
      // chords only a browser objects to. Saying which host is refusing, and
      // that the desktop build would take it, is the difference between a dead
      // end and an answer.
      return row.detail.reservedReason === 'app-menu'
        ? t(
            'dialogs:orieditaImport.reason.reservedAppMenu',
            'The macOS app menu keeps this shortcut for itself.'
          )
        : t(
            'dialogs:orieditaImport.reason.reserved',
            'The browser keeps this shortcut for itself. The desktop app can use it.'
          );
    case 'shadowed': {
      const shadowing = row.detail.shadowing;
      if (!shadowing) {
        return t(
          'dialogs:orieditaImport.reason.shadowedWithinImport',
          'Another hotkey in this import already wants this key.'
        );
      }
      const other = actionLabel(t, shadowing.actionId, shadowing.label);
      return shadowing.winnerId === row.shortcutId
        ? t(
            'dialogs:orieditaImport.reason.shadowedTakes',
            'Would take this key away from {{action}}.',
            { action: other }
          )
        : t('dialogs:orieditaImport.reason.shadowedLoses', '{{action}} answers this key first.', {
            action: other,
          });
    }
    case 'action-not-bindable':
      return t(
        'dialogs:orieditaImport.reason.notBindable',
        'This action cannot take an imported shortcut.'
      );
    case 'menu-accelerator-unsupported':
      return t(
        'dialogs:orieditaImport.reason.menuAccelerator',
        'Menu shortcuts cannot use this key.'
      );
  }
}

/**
 * The line under an action name: which keyboard layer the binding lives in,
 * followed by what applying it costs or why it was skipped.
 */
function rowNote(t: TFunction, row: OrieditaImportRow): string {
  const scope = row.scope
    ? shortcutScopeLabel(t, row.scope)
    : t('dialogs:orieditaImport.noScope', 'no matching action');
  if (row.outcome.kind === 'skip') return `${scope} — ${skipReasonText(t, row)}`;
  if (row.detail.replacedChords.length === 0) return scope;
  return `${scope} — ${t('dialogs:orieditaImport.replaces', 'Replaces {{chords}}', {
    chords: row.detail.replacedChords.map((chord) => formatKeyChord(chord)).join(' / '),
  })}`;
}

function PlanRow({
  row,
  onUseAnyway,
}: {
  row: OrieditaImportRow;
  onUseAnyway: (shortcutId: ShortcutActionId) => void;
}) {
  const { t } = useTranslation();
  // Absence is the whole predicate: the plan only attaches an offer where the
  // blocker may actually be unbound, so the dialog never has to ask again.
  const offer = row.detail.evictionOffer;
  return (
    <div className="settings-shortcuts__row oriedita-import__row">
      <div className="oriedita-import__copy">
        <span className="oriedita-import__action">
          {actionLabel(t, row.shortcutId, row.orieditaAction)}
        </span>
        {/*
          The offer finishes the sentence that explains the problem, rather than
          sitting under it as its own block. A ghost button stacked below the note
          read as neither part of the explanation nor part of the row's actions —
          quiet enough to miss, and detached from the reason someone would want it.
        */}
        <span className="oriedita-import__note">
          {rowNote(t, row)}
          {offer && (
            <>
              {' '}
              <button
                type="button"
                className="oriedita-import__use-anyway"
                aria-label={t(
                  'dialogs:orieditaImport.useAnywayLabel',
                  'Use this key anyway, leaving {{action}} unassigned',
                  { action: actionLabel(t, offer.evictedId, offer.evictedLabel) }
                )}
                /* `takenById` is this row's own target — the key `allowEvictionFor`
                   is named by — not the blocker's. */
                onClick={() => onUseAnyway(offer.takenById)}
              >
                {t('dialogs:orieditaImport.useAnyway', 'Use anyway')}
              </button>
            </>
          )}
        </span>
      </div>
      <span className="oriedita-import__chord">
        {row.outcome.kind === 'apply'
          ? formatKeyChord(row.outcome.chord)
          : // Nothing parsed, so the file's own text is all there is to show; it is
            // the one thing that lets the user recognize which hotkey this was.
            row.sourceKeyStroke || '-'}
      </span>
    </div>
  );
}

function PlanSection({
  title,
  rows,
  onUseAnyway,
  action,
}: {
  title: string;
  rows: OrieditaImportRow[];
  onUseAnyway: (shortcutId: ShortcutActionId) => void;
  /** Optional control in the header, opposite the title. */
  action?: ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="settings-section">
      <div className="settings-section__header">
        <h3 className="settings-section__title">{title}</h3>
        {action}
      </div>
      <div className="settings-shortcuts__table">
        {rows.map((row) => (
          <PlanRow key={row.orieditaAction} row={row} onUseAnyway={onUseAnyway} />
        ))}
      </div>
    </section>
  );
}

/**
 * What the approved rows cost, listed before Apply rather than confirmed after
 * it. Removing a binding the user already has is the one destructive thing an
 * import does, so it is shown as its own group with a way back out — asking
 * again in a modal at Apply time would be asking the same question twice.
 */
function UnbindSection({
  evictions,
  onKeep,
}: {
  evictions: readonly OrieditaImportEviction[];
  onKeep: (shortcutId: ShortcutActionId) => void;
}) {
  const { t } = useTranslation();
  if (evictions.length === 0) return null;
  return (
    <section className="settings-section">
      <h3 className="settings-section__title">
        {t('dialogs:orieditaImport.willUnbind', 'Will be unbound ({{count}})', {
          count: evictions.length,
        })}
      </h3>
      <div className="settings-shortcuts__table">
        {evictions.map((eviction) => (
          <div
            key={eviction.evictedId}
            className="settings-shortcuts__row oriedita-import__row"
          >
            <div className="oriedita-import__copy">
              <span className="oriedita-import__action">
                {actionLabel(t, eviction.evictedId, eviction.evictedLabel)}
              </span>
              <span className="oriedita-import__note">
                {t(
                  'dialogs:orieditaImport.unbindNote',
                  'Gives up this key to {{takenBy}}, and is left unassigned.',
                  { takenBy: actionLabel(t, eviction.takenById, eviction.takenByLabel) }
                )}
              </span>
              <div>
                <Button size="sm" variant="ghost" onClick={() => onKeep(eviction.takenById)}>
                  {t('dialogs:orieditaImport.keepBinding', 'Keep it')}
                </Button>
              </div>
            </div>
            <span className="oriedita-import__chord">{formatKeyChord(eviction.chord)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * An import carries only the hotkeys the user edited in Oriedita, so a real
 * archive lands in the low single digits and the tail is someone who rebound
 * half the keyboard. The ladder is cut to tell those apart without a raw count.
 */
const IMPORT_COUNT_BUCKETS = [0, 1, 5, 15, 30] as const;

export function OrieditaImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const overrides = useShortcutStore((state) => state.overrides);
  // Read alongside `overrides`: an import lands on whichever layout the user is
  // running, and judging collisions against the other one would preview a
  // keyboard they are not on.
  const defaultsSource = useShortcutStore((state) => state.defaultsSource);
  const applyImportedShortcuts = useShortcutStore((state) => state.applyImportedShortcuts);
  const [stage, setStage] = useState<ImportStage>({ kind: 'choose' });
  /** Rows the user pressed "Use anyway" on, by target action. */
  const [allowEvictionFor, setAllowEvictionFor] = useState<ReadonlySet<ShortcutActionId>>(
    () => new Set()
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const allowEviction = useCallback((shortcutId: ShortcutActionId) => {
    setAllowEvictionFor((previous) => new Set(previous).add(shortcutId));
  }, []);

  const revokeEviction = useCallback((shortcutId: ShortcutActionId) => {
    setAllowEvictionFor((previous) => {
      const next = new Set(previous);
      next.delete(shortcutId);
      return next;
    });
  }, []);

  /**
   * Take every offer at once, for an archive whose keymap collides with ours in
   * bulk — clicking through them one at a time is the same decision fifteen
   * times.
   *
   * Approves offers rather than rows: the skipped list also holds rows nothing
   * can rescue (no matching action, not bindable, the browser owns the chord),
   * and this must not pretend otherwise. Each eviction it approves still appears
   * under "will be unbound" before Apply, and `revokeEviction` still takes any
   * single one back, so this is a shortcut through the clicking and not a way
   * around the review.
   *
   * A fixpoint rather than one pass over what is on screen. `offersFor` derives
   * its offers from the *settled* plan, so a row queued behind a second
   * always-present claimant carries no offer until that claimant is evicted —
   * the measured chain being radial snapping holding `R`, which keeps Mirror Line
   * on `M`, which keeps Mountain off it. One pass would approve the front of such
   * a chain and leave the rows behind it skipped, which is the dead end this
   * button exists to remove. Re-planning terminates because the set only grows
   * and is bounded by the number of rows.
   */
  const allowEveryEviction = useCallback(() => {
    if (stage.kind !== 'review') return;
    const next = new Set(allowEvictionFor);
    for (;;) {
      const settled = buildOrieditaImportPlan({
        hotkeys: stage.hotkeys,
        currentOverrides: overrides,
        defaultsSource,
        allowEvictionFor: next,
      });
      const fresh = settled.rows.flatMap((row) => {
        const id = row.detail.evictionOffer?.takenById;
        return id && !next.has(id) ? [id] : [];
      });
      if (fresh.length === 0) break;
      for (const id of fresh) next.add(id);
    }
    const approved = next.size - allowEvictionFor.size;
    if (approved === 0) return;
    setAllowEvictionFor(next);
    // Worth its own event rather than left to the Apply counts: those say how
    // many bindings an import displaced, not whether anyone could face doing it
    // one row at a time. Bucketed, like every count this dialog sends.
    track('oriedita shortcuts override all', {
      overridden_count: bucketCount(approved, IMPORT_COUNT_BUCKETS),
    });
  }, [allowEvictionFor, defaultsSource, overrides, stage]);

  const chooseArchive = useCallback(async () => {
    setStage({ kind: 'reading' });
    // Consent belongs to the archive it was given for, not to the dialog.
    setAllowEvictionFor(new Set());
    try {
      const file = await getFileService().openBinaryFile({
        title: t('dialogs:orieditaImport.openTitle', 'Open Oriedita Settings Export'),
        extensions: ORICONFIG_EXTENSIONS,
      });
      // A dismissed picker is not a failure; it puts the user back where they were.
      if (!file) {
        setStage({ kind: 'choose' });
        return;
      }

      const archive = await readOriconfigArchive(file.bytes);
      if (!archive.ok) {
        setStage({ kind: 'failed', message: archiveFailureMessage(t, archive.reason) });
        return;
      }
      if (archive.unsupportedEntries.some((entry) => entry.name === 'hotkey.properties')) {
        setStage({ kind: 'failed', message: archiveFailureMessage(t, 'entry-failed') });
        return;
      }

      // An export from someone who never edited a hotkey carries no
      // `hotkey.properties` at all. Not an error — there is simply nothing to
      // carry over, and the review says so.
      const properties = archive.entries.get('hotkey.properties');
      setStage({
        kind: 'review',
        hotkeys: properties === undefined ? new Map() : parseJavaProperties(properties),
      });
    } catch {
      // The message deliberately says nothing about the file, since naming it
      // would put a path on screen. What went wrong is a read, either way.
      setStage({
        kind: 'failed',
        message: t('dialogs:orieditaImport.error.notRead', 'That file could not be read.'),
      });
    }
  }, [t]);

  const plan = useMemo(
    () =>
      stage.kind === 'review'
        ? buildOrieditaImportPlan({
            hotkeys: stage.hotkeys,
            currentOverrides: overrides,
            defaultsSource,
            allowEvictionFor,
          })
        : null,
    [allowEvictionFor, defaultsSource, overrides, stage]
  );

  const applied = plan?.rows.filter((row) => row.outcome.kind === 'apply') ?? [];
  // A row that binds the chord the target already has is applied but invisible.
  // Counting those under "will change" overstated the headline several-fold on a
  // clean profile, where most Oriedita defaults already agree with ours.
  const changing = applied.filter((row) => !row.detail.alreadyMatches);
  const unchanged = applied.filter((row) => row.detail.alreadyMatches);
  const skipped = plan?.rows.filter((row) => row.outcome.kind === 'skip') ?? [];
  // Skipped rows something can actually be done about. The rest of the list is
  // rows no approval reaches — unmapped actions, unbindable targets, chords the
  // browser owns — so it is this count, not `skipped.length`, that decides
  // whether a bulk control has anything to offer.
  const offered = skipped.filter((row) => row.detail.evictionOffer);

  const applyPlan = () => {
    if (!plan) return;
    applyImportedShortcuts(plan.overrides);
    // Hand-placed rather than left to the `handleMenuAction` chokepoint: this is
    // not a MENU_ACTION_ID, and the counts are the point — how much of an
    // Oriedita keymap actually survives is the one thing we cannot learn any
    // other way. Bucketed, and no filename, path or chord ever leaves the page.
    track('oriedita shortcuts imported', {
      // Counts what actually changes, not what was written.
      applied_count: bucketCount(changing.length, IMPORT_COUNT_BUCKETS),
      skipped_count: bucketCount(skipped.length, IMPORT_COUNT_BUCKETS),
      evicted_count: bucketCount(plan.evictions.length, IMPORT_COUNT_BUCKETS),
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('dialogs:orieditaImport.title', 'Import Oriedita Shortcuts')}
      className="simple-modal"
      onMouseDown={onClose}
    >
      <div
        role="document"
        className="simple-modal__document oriedita-import"
        /* Width follows the stage — a one-line prompt should not wear the width
           the review table needs. See `.oriedita-import` in theme.css. */
        data-stage={stage.kind}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="simple-modal__header">
          <span>
            <Keyboard size={15} aria-hidden="true" />
            {t('dialogs:orieditaImport.title', 'Import Oriedita Shortcuts')}
          </span>
          <IconButton
            size="sm"
            aria-label={t('dialogs:orieditaImport.close', 'Close Oriedita shortcut import')}
            onClick={onClose}
          >
            <X size={15} />
          </IconButton>
        </header>

        <div className="simple-modal__body oriedita-import__body">
          {stage.kind !== 'review' && (
            <>
              <p className="simple-modal__message">
                {t(
                  'dialogs:orieditaImport.intro',
                  'In Oriedita, open Preferences and choose Export to write a .oriconfig file.'
                )}
              </p>
              {stage.kind === 'failed' && (
                <p className="simple-modal__error" role="alert">
                  {stage.message}
                </p>
              )}
            </>
          )}

          {stage.kind === 'review' && plan && (
            <>
              <section className="settings-section">
                <p className="simple-modal__meta">
                  {stage.hotkeys.size === 0
                    ? t(
                        'dialogs:orieditaImport.noCustomizations',
                        "This export has no edited hotkeys, so there is nothing to carry over. To use Oriedita's layout, turn on Oriedita defaults in Settings ▸ Shortcuts."
                      )
                    : t(
                        'dialogs:orieditaImport.summary',
                        "This applies the hotkeys you changed in Oriedita. Every other shortcut keeps the key it has now — to move the whole keyboard, turn on Oriedita defaults in Settings ▸ Shortcuts."
                      )}
                </p>
              </section>

              <PlanSection
                title={t('dialogs:orieditaImport.willChange', 'Will change ({{count}})', {
                  count: changing.length,
                })}
                rows={changing}
                onUseAnyway={allowEviction}
              />
              <UnbindSection evictions={plan.evictions} onKeep={revokeEviction} />
              <PlanSection
                title={t('dialogs:orieditaImport.alreadyMatches', 'Already matches ({{count}})', {
                  count: unchanged.length,
                })}
                rows={unchanged}
                onUseAnyway={allowEviction}
              />
              <PlanSection
                title={t('dialogs:orieditaImport.skipped', 'Skipped ({{count}})', {
                  count: skipped.length,
                })}
                rows={skipped}
                onUseAnyway={allowEviction}
                action={
                  /* Only worth a header control when it saves more than the one
                     click already sitting in the row. With a single offer the
                     inline "Use anyway" is both nearer and clearer. */
                  offered.length > 1 ? (
                    <button
                      type="button"
                      className="oriedita-import__use-anyway oriedita-import__use-anyway--all"
                      onClick={allowEveryEviction}
                      /* The visible label carries no count on purpose: a chain of
                         offers can free more rows than are showing one right now,
                         so a number here would undercount its own effect. */
                      aria-label={t(
                        'dialogs:orieditaImport.useAllLabel',
                        'Use every skipped key that can override what holds it'
                      )}
                    >
                      {t('dialogs:orieditaImport.useAll', 'Override all')}
                    </button>
                  ) : null
                }
              />
            </>
          )}
        </div>

        <footer className="simple-modal__footer">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('dialogs:common.cancel', 'Cancel')}
          </Button>
          {/*
            One action slot, not two. Before a file is chosen the footer showed a
            permanently disabled Apply while the real action sat in the body as a
            full-width button — two stacked rows of buttons for one decision.
          */}
          {stage.kind !== 'review' ? (
            <Button
              size="sm"
              variant="primary"
              disabled={stage.kind === 'reading'}
              onClick={() => void chooseArchive()}
            >
              <Upload size={14} aria-hidden="true" />
              {stage.kind === 'reading'
                ? t('dialogs:orieditaImport.reading', 'Reading…')
                : t('dialogs:orieditaImport.choose', 'Choose Settings Export')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={!plan || applied.length === 0}
              onClick={applyPlan}
            >
              {t('dialogs:orieditaImport.apply', {
                count: applied.length,
                defaultValue_one: 'Apply {{count}} shortcut',
                defaultValue_other: 'Apply {{count}} shortcuts',
              })}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
