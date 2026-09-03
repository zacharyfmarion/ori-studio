/**
 * The pure edges of a detection, shared by the wasm worker and the desktop's
 * native client: which sources a run resolved to, how a decoded report is
 * stamped with them, and the contract a recognize-only run must meet. None of
 * this touches wasm, ORT, or Tauri.
 */
import {
  CP_DETECT_DEFAULT_LINE_EVIDENCE_SOURCE,
  type CpDetectFoldResult,
  type CpDetectJunctionSource,
  type CpDetectLineEvidenceSource,
  type CpDetectWorkerRunOptions,
} from '../engine/cpDetectTypes';
import type { WasmErrorEnvelope } from '../engine/types';

export type DecodedFold = {
  fold_json: string;
  report: CpDetectFoldResult['detectorReport'];
};

export function resolveLineEvidenceSource(
  value: CpDetectWorkerRunOptions['lineEvidenceSource']
): CpDetectLineEvidenceSource {
  if (value === undefined || value === null || value === CP_DETECT_DEFAULT_LINE_EVIDENCE_SOURCE) {
    return CP_DETECT_DEFAULT_LINE_EVIDENCE_SOURCE;
  }
  if (value === 'dense-model') {
    return 'dense-model';
  }
  throw new Error(`Unsupported CP detector line evidence source: ${String(value)}`);
}

export function withLineEvidenceSource<T extends DecodedFold>(
  decoded: T,
  lineEvidenceSource: CpDetectLineEvidenceSource
): T {
  return {
    ...decoded,
    report: {
      ...decoded.report,
      quality_report: {
        ...(decoded.report.quality_report ?? {}),
        line_evidence_source: lineEvidenceSource,
      },
    },
  };
}

export function detectedJunctionSource(
  report: CpDetectFoldResult['detectorReport'],
  fallback: CpDetectJunctionSource
): CpDetectJunctionSource {
  const source = report.quality_report?.junction_source;
  return source === 'dense-model' || source === 'line-arrangement' || source === 'vertex-refiner-v3'
    ? source
    : fallback;
}

export function recognizeContractError(detail: string): WasmErrorEnvelope {
  return {
    code: 'cp_detect_recognize_contract',
    message:
      `Recognize-only was requested but ${detail}. The generated wasm bridge is probably ` +
      'stale — rebuild it with `npm --workspace @treemaker/web run build:oristudio-cp-detect-wasm`.',
  };
}
