import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { SendToEditButtonModel } from '../../designKinds/sendToEditActions';
import { foldCommand, type FoldAction, type FoldCommand } from '../../fold/foldActions';
import { useFoldTools } from '../../fold/tools/foldToolState';
import { stepCountLabel } from '../../fold/sequence/foldSequenceWords';
import { useFitLevel } from '../../hooks/useFitLevel';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import { ViewportToolbarOverflowMenu } from '../panels/ViewportToolbarOverflowMenu';
import type { ViewportToolbarAction, ViewportToolbarOverflowGroup } from '../panels/viewportToolbarLayout';
import { Button } from '../ui/Button';
import { SplitButton } from '../ui/SplitButton';
import { TouchHistoryButtons } from '../ui/TouchHistoryButtons';
import { FoldActionIcon } from './FoldActionIcon';
import styles from './FoldHeader.module.css';

/**
 * A catalog command as a header button: its icon, label and gating. One that
 * takes a tool in hand is shown pressed while that tool is (`active`), in the
 * border and fill alone, so nothing beside it moves.
 */
function CommandButton({
  command,
  active,
  label = command.label,
  className,
}: {
  command: FoldCommand;
  active?: boolean;
  /** A shorter name than the menus give it, with the full one as its tooltip. */
  label?: string;
  className?: string;
}) {
  return (
    <Button
      size="sm"
      variant="secondary"
      className={className}
      disabled={command.disabled}
      title={command.hint ?? (label === command.label ? undefined : command.label)}
      isActive={active}
      aria-pressed={active === undefined ? undefined : active}
      onClick={command.run}
    >
      <FoldActionIcon icon={command.icon} />
      {label}
    </Button>
  );
}

/** A catalog command as a row of the phone's `⋯` menu. */
function commandRow(command: FoldCommand | undefined, opensDialog: boolean): ViewportToolbarAction | null {
  return command
    ? {
        kind: 'action',
        id: command.id,
        label: command.label,
        title: command.hint,
        icon: <FoldActionIcon icon={command.icon} />,
        disabled: command.disabled,
        opensDialog,
        onSelect: command.run,
      }
    : null;
}

/**
 * What the header gives up, a level at a time, while its row is too narrow
 * for it (`useFitLevel`). A tablet's — or a narrow window's — first moves the
 * verbs but Export into the `⋯` menu, then Export too, which is the phone's
 * arrangement; a phone's, whose verbs are always the menu, then drops the
 * Tools pill's word and keeps the tool's glyph. A wide enough row gives up
 * nothing, as before.
 */
const HEADER_FIT_LEVELS = 3;
const PHONE_FIT_LEVELS = 2;

/**
 * The verbs for the whole sequence as the `⋯` menu holds them, in the
 * header's order: Unfold to step; Import CP; Send to Edit and its variants,
 * as the split button offers them; and the two exports, unless Export is
 * still a button of its own (`exports: false`).
 */
function menuVerbGroups(
  actions: readonly FoldAction[],
  sendToEditButton: SendToEditButtonModel | undefined,
  exports: boolean
): ViewportToolbarOverflowGroup[] {
  const sendToEdit = foldCommand(actions, 'send-to-edit');
  const send: (ViewportToolbarAction | null)[] =
    sendToEdit && sendToEditButton
      ? [
          {
            kind: 'action',
            id: sendToEdit.id,
            label: sendToEditButton.label,
            title: sendToEditButton.title,
            icon: <FoldActionIcon icon={sendToEdit.icon} />,
            disabled: sendToEditButton.disabled,
            onSelect: sendToEditButton.run,
          },
          ...sendToEditButton.actions.map(
            (variant): ViewportToolbarAction => ({
              kind: 'action',
              id: `${sendToEdit.id}-${variant.id}`,
              // A variant names the verb itself ("Send to Edit (include circles)").
              label: variant.label,
              title: variant.title,
              icon: <FoldActionIcon icon={sendToEdit.icon} />,
              disabled: sendToEditButton.disabled || variant.disabled,
              onSelect: variant.onSelect,
            })
          ),
        ]
      : [commandRow(sendToEdit, false)];
  const groups: { id: string; items: (ViewportToolbarAction | null)[] }[] = [
    // Repeat is the wide header's alone: the rail, or a phone's tool sheet, offers it.
    { id: 'return', items: [commandRow(foldCommand(actions, 'unfold-to'), false)] },
    { id: 'in', items: [commandRow(foldCommand(actions, 'import-cp'), true)] },
    { id: 'send', items: send },
    {
      id: 'out',
      items: exports
        ? [commandRow(foldCommand(actions, 'export-fold'), true), commandRow(foldCommand(actions, 'export-steps'), true)]
        : [],
    },
  ];
  return groups
    .map((group) => ({ id: group.id, items: group.items.filter((item): item is ViewportToolbarAction => item !== null) }))
    .filter((group) => group.items.length > 0);
}

/**
 * The Fold workspace's header (plan D14, shot-0): the count of steps, then
 * the verbs that act on the whole sequence — Unfold to step and Repeat, which
 * take their tools in hand and show pressed while they are; Import CP, Send to
 * Edit, and the exports — as the action catalog words and gates them
 * (`fold/foldActions`), so they read here as they do in the menus. Repeat is
 * left to the rail where the header is narrow (`wideOnly`).
 *
 * Send to Edit is the design kinds' split button when `sendToEdit` is given
 * (its variants behind the caret), and the catalog's plain button otherwise.
 *
 * It wears the shared `panel-toolbar` frame, so it meets the Step pane's tab
 * bar at the same height. On a coarse pointer it carries undo and redo and the
 * slot the touch drawer seats its pill in (`drawerSlot`): the canvas pill lane
 * would sit over this header. The header keeps to one row, as Edit's touch
 * chrome does: what does not fit goes into one `⋯` menu, as Edit's bar
 * collapses into its own (see `HEADER_FIT_LEVELS`), never off the row. On
 * a phone the count is left to the strip's numbers, the verbs are always the
 * menu, and the Tools pill (`tools`) sits beside the drawer's, so the paper
 * keeps the height; the starred tools and the pane switch are on the canvas's
 * bar. Presentation only: the verbs and every call are props, and the tool in
 * hand is read to show its button pressed.
 */
export function FoldHeader({
  stepCount,
  actions,
  sendToEdit: sendToEditButton,
  drawerSlot,
  tools,
}: {
  /** The steps that fold on the path shown: turns are not counted. */
  stepCount: number;
  /** The catalog, for the step on screen. */
  actions: readonly FoldAction[];
  /**
   * Send to Edit as the shared split button model (`useFoldSendToEditButton`),
   * built over the catalog's Send to Edit: its gate and its tooltip are the
   * model's, so a reason it is disabled is said in the one place.
   */
  sendToEdit?: SendToEditButtonModel;
  /** Where the touch layer seats the Step pane's pill (`viewDrawerSlot`). */
  drawerSlot: Ref<HTMLDivElement>;
  /**
   * A phone's Tools pill (`FoldToolsTrigger`), left of the drawer's: the two
   * pills at the top of the screen, as Edit's Tools and View float over its
   * canvas. `compact` while the row has no room for its word.
   */
  tools?: (options: { compact: boolean }) => ReactNode;
}) {
  const { t } = useTranslation();
  const phone = useIsPhoneLayout();
  const { level, rowRef } = useFitLevel(phone ? PHONE_FIT_LEVELS : HEADER_FIT_LEVELS);
  // The verbs are one menu on a phone, and on a tablet whose row cannot hold them.
  const verbsMenu = phone || level >= 1;
  const exportButton = !phone && level < 2;
  const unfold = foldCommand(actions, 'unfold-to');
  const repeat = foldCommand(actions, 'repeat');
  // Unfold to step and Repeat take their tools in hand: pressed while they are.
  const tool = useFoldTools((state) => state.tool);
  const importCp = foldCommand(actions, 'import-cp');
  const sendToEdit = foldCommand(actions, 'send-to-edit');
  const exportFold = foldCommand(actions, 'export-fold');
  const exportSteps = foldCommand(actions, 'export-steps');
  return (
    <div
      ref={rowRef}
      className={`panel-toolbar ${styles.header}`}
      data-phone={phone || undefined}
      data-fit-level={level}
    >
      {!phone && <span className={styles.count}>{stepCountLabel(t, stepCount)}</span>}
      <div className={`panel-toolbar__group ${styles.actions}`}>
        <TouchHistoryButtons />
        {verbsMenu ? (
          <ViewportToolbarOverflowMenu
            groups={menuVerbGroups(actions, sendToEditButton, !exportButton)}
            label={
              exportButton
                ? t('panels:fold.header.moreVerbsButExport', 'Unfold, import and send')
                : t('panels:fold.header.moreVerbs', 'Import, send and export')
            }
            side="bottom"
          />
        ) : (
          <>
            {unfold && <CommandButton command={unfold} active={tool === 'unfold-to'} />}
            {repeat && (
              <CommandButton
                command={repeat}
                active={tool === 'repeat'}
                label={t('panels:fold.repeat.label', 'Repeat')}
                className={styles.wideOnly}
              />
            )}
            {importCp && <CommandButton command={importCp} />}
            {sendToEdit &&
              (sendToEditButton ? (
                <SplitButton
                  size="sm"
                  variant="secondary"
                  icon={<FoldActionIcon icon={sendToEdit.icon} />}
                  label={sendToEditButton.label}
                  title={sendToEditButton.title}
                  disabled={sendToEditButton.disabled}
                  onClick={sendToEditButton.run}
                  menuLabel={sendToEditButton.menuLabel}
                  actions={sendToEditButton.actions}
                />
              ) : (
                <CommandButton command={sendToEdit} />
              ))}
          </>
        )}
        {/* The primary verb, the last a tablet's row gives up. */}
        {exportButton && exportFold && (
          <SplitButton
            size="sm"
            variant="primary"
            icon={<FoldActionIcon icon={exportFold.icon} />}
            label={exportFold.label}
            title={exportFold.hint}
            disabled={exportFold.disabled}
            onClick={exportFold.run}
            menuLabel={t('panels:fold.header.moreExports', 'More ways to export')}
            actions={
              exportSteps
                ? [
                    {
                      id: exportSteps.id,
                      label: exportSteps.label,
                      title: exportSteps.hint,
                      disabled: exportSteps.disabled,
                      opensDialog: true,
                      onSelect: exportSteps.run,
                    },
                  ]
                : []
            }
          />
        )}
        {tools?.({ compact: phone && level >= 1 })}
        <div className="panel-toolbar__pills" ref={drawerSlot} />
      </div>
    </div>
  );
}
