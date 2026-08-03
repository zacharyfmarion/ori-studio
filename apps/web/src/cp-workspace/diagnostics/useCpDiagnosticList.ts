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
import { diagnosticHudStatus, type CpDiagnosticHudStatus } from './hudStatus';
import { visibleCpDiagnosticEntries } from './visibleEntries';

export interface CpDiagnosticList {
  /** Every diagnostic currently on the canvas, in kernel order. */
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

  // The same call the canvas overlay makes.
  //
  // This used to be its own rule that picked ONE result — the CAMV overlay, or
  // the last command's findings — while the canvas concatenated both. With the
  // overlay on and a Check1 result present, the canvas drew markers the list had
  // no row for: clickable, framed by the store, and unselectable from here.
  //
  // `visibleEntries.ts` already says why there is one function: markers, this
  // list, and what a jump-to-diagnostic can reach all ask the same question.
  const entries = useMemo(
    () => visibleCpDiagnosticEntries(camvResult, lastCommandResult, camvIssuesVisible),
    [camvIssuesVisible, camvResult, lastCommandResult]
  );

  const selectDiagnostic = useCallback((id: string) => setActive(id), [setActive]);

  return { entries, status, activeId, selectDiagnostic };
}
