import type { TFunction } from 'i18next';
import { foldToolLabel, lineModeSteps } from '../foldToolCatalog';
import { lineModeInput } from '../foldToolRegistry';
import {
  layersSection,
  lineModeNotes,
  lineModeSelect,
  queuedNote,
  settingsMeta,
  type FoldToolHost,
  type FoldToolWindowModel,
  type FoldToolWindowVerbs,
  type FoldToolWindowView,
} from '../foldToolWindow';
import { foldRefusalNotice, sectionFlapNames } from '../refusalNotice';

export function pleatToolWindow(
  t: TFunction,
  view: FoldToolWindowView,
  verbs: FoldToolWindowVerbs,
  host: FoldToolHost,
): FoldToolWindowModel {
  const title = foldToolLabel(t, 'pleat'),
    disabled = view.readOnly !== null,
    preview = view.preview;
  const second = view.secondLineMode ?? 'free';
  const firstCount = lineModeInput(view.lineMode).steps.length;
  const finish = host.coarse
    ? t('tools:fold.steps.commitTouch', 'Tap {{action}} to fold.', {
        action: title,
      })
    : t(
        'tools:fold.steps.commitOrClick',
        'Press Enter, or click {{action}}, to fold.',
        { action: title },
      );
  return {
    phase: preview ? 'preview' : 'locate',
    title,
    meta: settingsMeta(t, 2),
    instructions: {
      heading: t('tools:fold.window.instructions', 'Instructions'),
      intro: t(
        'tools:fold.pleat.intro',
        'Locate the mountain line first, then the valley line, on the model before it folds.',
      ),
      items: preview
        ? [
            t(
              'tools:fold.pleat.layers',
              'Choose the flap to pleat. The end beyond the valley line folds back.',
            ),
            finish,
          ]
        : [
            ...lineModeSteps(t, view.lineMode, host.coarse).map((instruction) =>
              t(
                'tools:fold.pleat.mountainInstruction',
                'Mountain line: {{instruction}}',
                { instruction },
              ),
            ),
            ...lineModeSteps(t, second, host.coarse).map((instruction) =>
              t(
                'tools:fold.pleat.valleyInstruction',
                'Valley line: {{instruction}}',
                { instruction },
              ),
            ),
            finish,
          ],
      current: preview
        ? 0
        : Math.min(view.picks, firstCount + lineModeInput(second).steps.length),
      notes: [
        ...lineModeNotes(t, view.picks < firstCount ? view.lineMode : second, host, view.freeLineSnap),
        // Both folds are tried for every way each lands: seconds on a busy
        // model. Escape, which the notes above name, stops it with the picks.
        ...(preview?.searching ? [t('tools:fold.pleat.searching', 'Working out how the pleat’s layers can stack…')] : []),
        ...(preview ? queuedNote(t, preview) : []),
      ],
    },
    lineMode: preview
      ? null
      : {
          ...lineModeSelect(t, view, { ...verbs, selectLineMode: (mode) => verbs.selectLineMode(mode, 'first') }),
          label: t('tools:fold.pleat.mountainLine', 'Mountain line'),
        },
    secondLine: preview
      ? undefined
      : {
          ...lineModeSelect(t, { ...view, lineMode: second }, { ...verbs, selectLineMode: (mode) => verbs.setSecondLineMode?.(mode) }),
          label: t('tools:fold.pleat.valleyLine', 'Valley line'),
        },
    kind: null,
    divide: null,
    movingSide: preview
      ? {
          label: t('tools:fold.window.movingSide', 'Moving side'),
          swapLabel: t('tools:fold.window.swap', 'Swap'),
          shortcut: 'fold.swapSide',
          disabled,
          swap: verbs.swapSide,
        }
      : null,
    layers: preview ? layersSection(t, preview, verbs, disabled, host.coarse) : null,
    refusal: preview?.refused
      ? foldRefusalNotice(
          t,
          preview.refused,
          {
            kind: 'pleat',
            readOnly: disabled,
            ...sectionFlapNames(preview.section),
          },
          verbs,
        )
      : null,
    footer: preview
      ? {
          cancel: {
            label: t('tools:fold.window.cancel', 'Cancel'),
            shortcut: 'viewport.cancel',
            disabled: false,
            run: verbs.cancel,
          },
          commit: {
            label: title,
            shortcut: 'fold.commit',
            disabled: disabled || preview.landing || preview.refused !== null,
            run: verbs.commit,
          },
        }
      : null,
  };
}
