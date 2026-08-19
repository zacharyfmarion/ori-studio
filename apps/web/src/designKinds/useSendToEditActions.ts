import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { selectOristudioBpDocument } from '../store/workspaceStore/designTabs';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useWorkspaceCapabilities } from '../store/workspaceStore/useWorkspaceCapabilities';
import type { SplitButtonAction } from '../components/ui/SplitButton';
import { sendToEditMenuLabel, sendToEditPrimary, sendToEditVariants } from './sendToEditActions';
import type { DesignKindId } from './types';

export interface SendToEditButtonModel {
  label: string;
  title: string;
  disabled: boolean;
  menuLabel: string;
  actions: SplitButtonAction[];
  run: () => void;
}

/**
 * The Send to Edit button's whole model for one kind: labels, gating, and the
 * calls behind them.
 *
 * Here rather than in the toolbar because the toolbar is a composition site —
 * it should mount a `SplitButton` and pass it this, not assemble a bag of store
 * callbacks inline. The two kinds differ only in which store action runs and
 * what makes it available, so both are expressed as data over one shape.
 */
export function useSendToEditActions(kind: DesignKindId): SendToEditButtonModel | null {
  const { t } = useTranslation();
  const capabilities = useWorkspaceCapabilities();
  const sendTreeToEdit = useWorkspaceStore((state) => state.sendTreeCreasePatternToEdit);
  const sendBpToEdit = useWorkspaceStore((state) => state.sendOristudioBpToEdit);
  const hasBpDocument = useWorkspaceStore((state) => selectOristudioBpDocument(state) !== null);
  const bpBusy = useWorkspaceStore((state) => state.oristudioBpBusy);

  // `cp.build` is the TreeMaker gate: Send to Edit needs exactly what building a
  // crease pattern needs, so it reads that capability rather than inventing a
  // second predicate that could disagree with it.
  const buildCp = capabilities['cp.build'];

  return useMemo(() => {
    const send =
      kind === 'treemaker'
        ? { run: sendTreeToEdit, disabled: !buildCp.enabled, reason: buildCp.reason }
        : kind === 'box-pleat'
          ? { run: sendBpToEdit, disabled: !hasBpDocument || bpBusy, reason: undefined }
          : null;
    if (!send) return null;

    const primary = sendToEditPrimary(t);
    return {
      label: primary.label,
      title: send.disabled && send.reason ? send.reason : primary.title,
      disabled: send.disabled,
      menuLabel: sendToEditMenuLabel(t),
      run: () => void send.run(primary.includeCircles),
      actions: sendToEditVariants(kind, t).map((variant) => ({
        id: variant.id,
        label: variant.label,
        title: variant.title,
        onSelect: () => void send.run(variant.includeCircles),
      })),
    };
  }, [
    kind,
    t,
    sendTreeToEdit,
    sendBpToEdit,
    buildCp.enabled,
    buildCp.reason,
    hasBpDocument,
    bpBusy,
  ]);
}
