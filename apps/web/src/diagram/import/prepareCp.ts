import { keptPicture } from '../../store/workspaceStore/diagramCapture';
import i18n from '../../i18n';
import { CpTaskTimeoutError, createCpTaskSession, type CpTaskSession } from '../../engines/cpTaskSession';
import { decodeCpGeometryToSnapshot, type CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { createBoundCpCaptureRuntime } from '../../store/workspaceStore/cpFoldRuntimeBindings';
import { captureStep, fixedPicture } from '../capture/captureFolded';
import { chooseStepCreases } from '../capture/captureCreases';
import {
  createStep,
  type DiagramStep,
  type DiagramStyle,
  type DiagramPictureAsset,
} from '../document/diagramDocument';
import type { DefoxEntry } from './defoxRenderer.js';
import { geometryBounds } from './batchPlacement';

export interface PreparedCp {
  geometry: CpGeometryTransport;
  steps: DiagramStep[];
  assets: DiagramPictureAsset[];
  notices: string[];
}
/** One task session reused until cancellation/timeout; no handles escape it. */
export class CpImportPreparer {
  private session: CpTaskSession | null = null;
  async close(): Promise<void> {
    const session = this.session;
    this.session = null;
    await session?.close();
  }
  async prepare(
    text: string,
    name: string,
    style: DiagramStyle,
    signal: AbortSignal,
    foldSignal: AbortSignal,
    timeoutMs: number,
    defox?: Extract<DefoxEntry, { ok: true }>,
  ): Promise<PreparedCp> {
    let session = (this.session ??= await createCpTaskSession(signal));
    let api = session.client;
    let handle: number | undefined;
    const steps: DiagramStep[] = [],
      assets: DiagramPictureAsset[] = [],
      notices: string[] = [];
    try {
      const prepared = await session.run(
        async () => {
          handle = await api.loadCp(text, name);
          const geometry = await api.documentGeometry(handle);
          geometryBounds(geometry);
          const document = decodeCpGeometryToSnapshot(geometry);
          const sheets = new CpSheetIndex(await api.sheetIndex(handle));
          return { geometry, document, sheets };
        },
        signal,
        30_000,
      );
      const { geometry, document, sheets } = prepared;
      const regions = sheetRegions(sheets);
      if (defox && regions.length !== 1)
        throw new Error(
          i18n.t(
            'panels:diagram.import.defoxRegions',
            'This saved view doesn’t have exactly one paper region, so it can’t be linked to its crease pattern.',
          ),
        );
      const stopFolding = AbortSignal.any([signal, foldSignal]);
      for (const region of regions) {
        const scope = { kind: 'segment' as const, region: regionReferenceFor(region) };
        let status: 'pending' | 'failed' = 'pending';
        if (!defox && !stopFolding.aborted) {
          try {
            if (this.session !== session) {
              session = this.session ??= await createCpTaskSession(signal);
              api = session.client;
              handle = await session.run(() => api.loadCp(text, name), signal);
            }
            const runtime = createBoundCpCaptureRuntime(api, handle!, session.runId);
            const result = await session.run(
              () =>
                captureStep(runtime, {
                  document,
                  sheets,
                  scope,
                  render: { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 },
                  style,
                }),
              stopFolding,
              timeoutMs,
            );
            if (result.status === 'captured' && !result.noLayerOrder) {
              const kept = await keptPicture(result.captured, result.source.render, style);
              if (kept.asset) assets.push(kept.asset);
              steps.push({ ...createStep(), source: result.source, picture: kept.picture });
              continue;
            }
            status = 'failed';
            notices.push(
              i18n.t('panels:diagram.import.noSolution', 'No folded state was found; the step keeps its crease pattern.'),
            );
          } catch (error) {
            if (signal.aborted) throw error;
            status = foldSignal.aborted ? 'pending' : 'failed';
            // Said apart: a longer limit helps a fold that ran out of time, never one the engine refused.
            notices.push(
              foldSignal.aborted
                ? i18n.t('panels:diagram.import.foldDeferred', 'Folding was left for later; the step keeps its crease pattern.')
                : error instanceof CpTaskTimeoutError
                  ? i18n.t(
                      'panels:diagram.import.foldTimeout',
                      'Folding took longer than the time limit; the step keeps its crease pattern.',
                    )
                  : i18n.t('panels:diagram.import.foldFailed', 'Folding failed; the step keeps its crease pattern.'),
            );
            await this.close();
          }
        }
        if (signal.aborted) throw new DOMException('Import cancelled', 'AbortError');
        // This path is pure for a crease-pattern view, even after a solve's
        // disposable session was terminated. Successful folds never pay for it.
        const runtime = createBoundCpCaptureRuntime(api, handle!, session.runId);
        const preview = await captureStep(runtime, {
          document,
          sheets,
          scope,
          render: { mode: 'crease-pattern', rotationDeg: 0 },
          style,
        });
        if (preview.status !== 'captured') continue;
        if (defox) {
          const creases = chooseStepCreases(document, scope, sheets);
          steps.push({
            ...createStep(),
            source: {
              ...preview.source,
              fingerprint:
                creases.status === 'found' ? creases.creases.fingerprint : preview.source.fingerprint,
              render: { mode: 'defox', snapshot: defox.snapshot },
            },
            picture: fixedPicture(defox.svg),
          });
          break;
        }
        const kept = await keptPicture(preview.captured, preview.source.render, style);
        if (kept.asset) assets.push(kept.asset);
        steps.push({ ...createStep(), source: preview.source, picture: kept.picture, importStatus: status });
      }
      if (!steps.length) {
        // No sentence goes into the step: its text is the author's, saved and printed as theirs.
        steps.push({ ...createStep(), importStatus: 'failed' });
        notices.push(
          i18n.t('panels:diagram.import.noRegion', 'No paper region was found; the crease pattern is still added to Edit.'),
        );
      }
      return { geometry, steps, assets, notices };
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      if (handle !== undefined && this.session === session)
        await api.freeDocument(handle).catch(() => undefined);
    }
  }
}
