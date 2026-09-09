import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useTranslation } from 'react-i18next';
import { Check, Pencil } from 'lucide-react';
import { MenuIconButton } from '../../components/ui/MenuIconButton';
import { CpToolGlyph } from '../toolCatalog/cpToolGlyph';
import { cpActionLabel } from '../../i18n/cpVocab';
import {
  cpActionByOperation,
  type OristudioCpCommandActionDefinition,
} from '../../lib/oristudioCpActions';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { useWorkspaceStore } from '../../store/workspaceStore';

/**
 * The repair tools a solve region offers, on the chip that runs the solve.
 *
 * # Why they are here as well as on the rail
 *
 * Steering a solve is a loop: run it, look at where a junction landed, pin it,
 * run it again. The rail is at the other side of the window from the Solve
 * button, and the tools that belong to this loop are two of about sixty there —
 * so the loop cost a hunt through a tool grid on every turn. These are the same
 * two tools, reachable without leaving the thing being repaired.
 *
 * It is a *shortcut*, not a second implementation: the items dispatch through
 * `requestOristudioCpAction`, which is the same channel the menu bar and the
 * command palette use, and the panel arms the tool exactly as a rail click
 * would. Nothing about the tool changes because it was reached from here.
 *
 * # Why only on the solve chip
 *
 * The base suppression chip is what the rail tool makes — a plain box that
 * silences checks over a library fragment or a work-in-progress corner. Pinning
 * is a repair verb, and a repair verb on a box that is not repairing anything is
 * a control with nothing to act on. `SolveRegionChip` composes this in; the base
 * chip cannot reach it.
 *
 * # The list is data
 *
 * Two entries today, and a third is one line. That is the point: the plan for
 * this flow expects more repair verbs, and the shape they take here — arm a
 * tool, tick the armed one — does not change when one is added.
 */

/**
 * The tools the menu offers, in the order the loop uses them: hold a junction,
 * then move the ones that are wrong.
 *
 * Both are Ori Studio originals sitting together in the rail's Transform group,
 * which is not a coincidence — they are the two halves of "where does this
 * vertex belong", and this menu is where that question gets asked.
 */
const REPAIR_TOOL_OPERATIONS: readonly OristudioCpOperationId[] = ['VertexPin', 'VertexMove'];

export function RegionRepairToolMenu() {
  const { t } = useTranslation();
  const activeToolId = useWorkspaceStore((state) => state.oristudioCpActiveToolId);
  const requestAction = useWorkspaceStore((state) => state.requestOristudioCpAction);

  const tools = REPAIR_TOOL_OPERATIONS.map(cpActionByOperation).filter(
    (action): action is OristudioCpCommandActionDefinition => action !== undefined
  );
  if (tools.length === 0) return null;

  const armed = tools.some((action) => action.id === activeToolId);

  return (
    <DropdownMenu.Root>
      {/* Pressed while one of its tools is armed, for the reason `MenuIconButton`
          documents: the closed button is otherwise the only thing on screen that
          could say the canvas is in pin mode, and the rail is off in another
          pane. */}
      <MenuIconButton
        label={t('panels:cpRegion.repairTools', 'Repair tools')}
        icon={<Pencil size={14} />}
        isActive={armed}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="context-menu"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          loop
        >
          {tools.map((action) => (
            <DropdownMenu.CheckboxItem
              key={action.id}
              className="context-menu__item"
              checked={action.id === activeToolId}
              // Closes on select, unlike the suppressed-checks menu beside it:
              // these are modes rather than a set, so exactly one press is ever
              // wanted and staying open would leave a menu over the canvas the
              // armed tool is waiting to be used on.
              onSelect={() => requestAction(action.operationId)}
            >
              {/* The tool's own glyph leads, and the tick moves to the trailing
                  edge rather than sharing the slot with it (the pattern
                  `ViewportToolbarOverflowMenu` uses). Sharing would hide the
                  glyph on exactly the tool that is armed — and the glyph is what
                  ties this row to the rail button for the same tool, which is
                  the thing someone is looking for when they open this menu. */}
              <span className="context-menu__icon">
                <CpToolGlyph action={action} size={14} />
              </span>
              <span className="context-menu__label">{cpActionLabel(t, action)}</span>
              <span className="context-menu__icon" aria-hidden="true">
                {action.id === activeToolId && <Check size={12} />}
              </span>
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
