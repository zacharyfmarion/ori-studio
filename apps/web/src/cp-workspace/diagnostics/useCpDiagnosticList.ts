/**
 * Everything the diagnostic HUD needs from the store, and nothing else.
 *
 * The HUD takes no props. It is mounted inside the crease-pattern panel's
 * viewport, but the panel is a composition site — it should not be assembling a
 * status object, holding an entry list, and adapting a select callback on the
 * HUD's behalf. So the bindings live here, beside the modules they derive from,
 * and `CpDiagnosticHud` calls this directly.
 *
 * The subscriptions are deliberately narrow. The HUD sits above a canvas that
 * re-renders on nearly every interaction; selecting whole slices here would make
 * every drag re-render a list that has not changed.
 */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
import { diagnosticHudStatus, isDiagnosticResultOperation, type CpDiagnosticHudStatus } from './hudStatus';

const EMPTY_ENTRIES: readonly OristudioCpDiagnosticEntry[] = [];

export interface CpDiagnosticList {
  /** The diagnostics the list renders. */
  entries: readonly OristudioCpDiagnosticEntry[];
  /** The collapsed HUD's headline, or null when there is nothing to report. */
  status: CpDiagnosticHudStatus | null;
  activeId: string | null;
  selectDiagnostic: (id: string) => void;
}

export function useCpDiagnosticList(): CpDiagnosticList {
  const { t } = useTranslation();
  const camvResult = useWorkspaceStore((state) => state.oristudioCpCamvResult);
  const lastCommandResult = useWorkspaceStore(
    (state) => state.oristudioCpDocument?.lastCommandResult ?? null
  );
  const camvIssuesVisible = useWorkspaceStore(
    (state) => state.oristudioCpViewport.camvIssuesVisible !== false
  );
  const activeId = useWorkspaceStore((state) => state.oristudioCpActiveDiagnosticId);
  const setActive = useWorkspaceStore((state) => state.setOristudioCpActiveDiagnostic);

  const status = useMemo(() => {
    const camvStatus = camvIssuesVisible
      ? diagnosticHudStatus(t, camvResult, { issueOnly: true })
      : null;
    const commandStatus =
      !camvIssuesVisible && lastCommandResult?.operation === 'CheckCamv'
        ? null
        : diagnosticHudStatus(t, lastCommandResult);
    return camvStatus ?? commandStatus;
  }, [camvIssuesVisible, camvResult, lastCommandResult, t]);

  const entries = useMemo(() => {
    const hudResult =
      camvIssuesVisible && diagnosticHudStatus(t, camvResult, { issueOnly: true }) !== null
        ? camvResult
        : !camvIssuesVisible && lastCommandResult?.operation === 'CheckCamv'
          ? null
          : lastCommandResult;
    if (!hudResult || !isDiagnosticResultOperation(hudResult.operation)) return EMPTY_ENTRIES;
    return hudResult.diagnostic_entries ?? EMPTY_ENTRIES;
  }, [camvIssuesVisible, camvResult, lastCommandResult, t]);

  const selectDiagnostic = useCallback((id: string) => setActive(id), [setActive]);

  return { entries, status, activeId, selectDiagnostic };
}
