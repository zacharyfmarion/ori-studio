import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { handleMenuAction, type MenuActionId } from '../commands/menuActions';
import type { WorkspaceCapabilityId } from '../lib/workspaceCapabilities';
import { useWorkspaceCapabilities } from '../store/workspaceStore/useWorkspaceCapabilities';

/**
 * The sheet transforms, as a toolbar can mount them.
 *
 * The verbs themselves are the menu's — same ids, same capability gates, same
 * dispatch — so this binds rather than declares. Going through
 * `handleMenuAction` is what keeps that true: the packing pane's buttons and the
 * Design menu run one code path, and the analytics chokepoint there covers both
 * without a second hand-placed event.
 */

export type BpSheetTransformIcon = 'rotate-right' | 'rotate-left' | 'flip-h' | 'flip-v';

/**
 * An id that is both a command the menu dispatches and a capability the shell
 * gates. Every verb offered on two surfaces has to be both, and spelling it as
 * the overlap is what stops one arriving without the other.
 */
type BpSheetTransformId = Extract<MenuActionId, WorkspaceCapabilityId>;

export interface BpSheetTransformAction {
  id: BpSheetTransformId;
  icon: BpSheetTransformIcon;
  /** Tooltip: what it does, or why it cannot run. */
  title: string;
  disabled: boolean;
  run: () => void;
}

const TRANSFORMS: { id: BpSheetTransformId; icon: BpSheetTransformIcon }[] = [
  { id: 'bp.layout.rotateRight', icon: 'rotate-right' },
  { id: 'bp.layout.rotateLeft', icon: 'rotate-left' },
  { id: 'bp.layout.flipHorizontal', icon: 'flip-h' },
  { id: 'bp.layout.flipVertical', icon: 'flip-v' },
];

/** `<label> — <why>`, so a disabled button still says which verb it is. */
function tooltip(t: TFunction, label: string, reason: string): string {
  return label === reason
    ? label
    : t('common:capability.labelWithReason', '{{label}} — {{reason}}', { label, reason });
}

export function useBpSheetTransforms(): BpSheetTransformAction[] {
  const { t } = useTranslation();
  const capabilities = useWorkspaceCapabilities();
  return useMemo(
    () =>
      TRANSFORMS.map(({ id, icon }) => {
        const capability = capabilities[id];
        return {
          id,
          icon,
          title: tooltip(t, capability.label, capability.reason),
          disabled: !capability.enabled,
          run: () => void handleMenuAction(id),
        };
      }),
    [capabilities, t],
  );
}
