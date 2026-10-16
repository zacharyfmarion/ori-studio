import { keptPicture } from '../../store/workspaceStore/diagramCapture';
import { createCpTaskSession, type CpTaskSession } from '../../engines/cpTaskSession';
import { decodeCpGeometryToSnapshot, type CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { createBoundCpCaptureRuntime } from '../../store/workspaceStore/cpFoldRuntimeBindings';
import { captureStep, fixedPicture } from '../capture/captureFolded';
import { chooseStepCreases } from '../capture/captureCreases';
import {
  createStep,
  type DiagramStep,
  type DiagramStyle,
  type KnownDiagramAsset,
} from '../document/diagramDocument';
import type { DefoxEntry } from './defoxRenderer.js';
import { geometryBounds } from './batchPlacement';

export interface PreparedCp {
  geometry: CpGeometryTransport;
  steps: DiagramStep[];
  assets: KnownDiagramAsset[];
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
      assets: KnownDiagramAsset[] = [],
      notices: string[] = [];
    try {
      const prepared = await session.run(
        async () => {
          handle = await api.loadCp(text, name);
          const geometry = await api.documentGeometry(handle);
          geometryBounds(geometry);
          const document = decodeCpGeometryToSnapshot(geometry);
          const segmentation = await api.segmentationArtifacts(handle);
          return { geometry, document, segmentation };
        },
        signal,
        30_000,
      );
      const { geometry, document, segmentation } = prepared;
      const regions = resolveCpSegments(segmentation);
      if (defox && regions.length !== 1)
        throw new Error(
          'This saved Defox view does not have exactly one paper region; importing its linked view is unsupported.',
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
                  segmentation,
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
            notices.push('No folded solution was found; the crease pattern preview is retained.');
          } catch (error) {
            if (signal.aborted) throw error;
            status = foldSignal.aborted ? 'pending' : 'failed';
            notices.push(
              foldSignal.aborted
                ? 'Folding deferred.'
                : 'Fold failed or exceeded its time limit; the crease pattern preview is retained.',
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
          segmentation,
          scope,
          render: { mode: 'crease-pattern', rotationDeg: 0 },
          style,
        });
        if (preview.status !== 'captured') continue;
        if (defox) {
          const creases = chooseStepCreases(document, scope, segmentation);
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
        steps.push({
          ...createStep(),
          text: 'Imported crease pattern has no resolvable paper region.',
          importStatus: 'failed',
        });
        notices.push('No resolvable paper region; geometry will still be appended to Edit.');
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
