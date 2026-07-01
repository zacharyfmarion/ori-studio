import type {
  ExamplesResponse,
  MapPayload,
  Stage1Response,
  Stage2Response,
  Stage4Response,
  Stage5Response,
  Stage5bResponse,
  Stage6Response,
  StageInfo,
} from './types';

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.text();
  const payload = body ? parseJsonOrNull(body) : null;
  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : body.trim() || `Request failed: ${response.status}`;
    throw new Error(error);
  }
  return payload as T;
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type StageQueryOptions = { threshold: number; mapSize: number };
type CandidateStageQueryOptions = StageQueryOptions & {
  strategy: string;
  legacyLowThreshold: number;
  legacySnapRadiusPx: number;
  exactSolveTimeoutSeconds: number;
};

export function fetchStages(): Promise<{ stages: StageInfo[] }> {
  return requestJson('/api/stages');
}

export function fetchStage1Examples(): Promise<ExamplesResponse> {
  return requestJson('/api/stage1/examples');
}

export function fetchStage1Example(
  sampleId: string,
  options: StageQueryOptions,
): Promise<Stage1Response> {
  const params = new URLSearchParams({
    threshold: String(options.threshold),
    map_size: String(options.mapSize),
  });
  return requestJson(`/api/stage1/examples/${encodeURIComponent(sampleId)}?${params}`);
}

export function fetchStage1FullMap(
  sampleId: string,
  mapId: string,
  options: { threshold: number },
): Promise<MapPayload> {
  const params = new URLSearchParams({
    map: mapId,
    threshold: String(options.threshold),
  });
  return requestJson(`/api/stage1/fullmap/${encodeURIComponent(sampleId)}?${params}`);
}

export function fetchStage2Examples(): Promise<ExamplesResponse> {
  return requestJson('/api/stage2/examples');
}

export function fetchStage2Example(
  sampleId: string,
  options: StageQueryOptions,
): Promise<Stage2Response> {
  const params = new URLSearchParams({
    threshold: String(options.threshold),
    map_size: String(options.mapSize),
  });
  return requestJson(`/api/stage2/examples/${encodeURIComponent(sampleId)}?${params}`);
}

export function fetchStage4Examples(): Promise<ExamplesResponse> {
  return requestJson('/api/stage4/examples');
}

export function fetchStage4Example(
  sampleId: string,
  options: StageQueryOptions,
): Promise<Stage4Response> {
  const params = new URLSearchParams({
    threshold: String(options.threshold),
    map_size: String(options.mapSize),
  });
  return requestJson(`/api/stage4/examples/${encodeURIComponent(sampleId)}?${params}`);
}

export function fetchStage5Examples(): Promise<ExamplesResponse> {
  return requestJson('/api/stage5/examples');
}

export function fetchStage5Example(
  sampleId: string,
  options: CandidateStageQueryOptions,
): Promise<Stage5Response> {
  const params = new URLSearchParams({
    threshold: String(options.threshold),
    map_size: String(options.mapSize),
    strategy: options.strategy,
    legacy_low_threshold: String(options.legacyLowThreshold),
    legacy_snap_radius_px: String(options.legacySnapRadiusPx),
    exact_solve_timeout_seconds: String(options.exactSolveTimeoutSeconds),
  });
  return requestJson(`/api/stage5/examples/${encodeURIComponent(sampleId)}?${params}`);
}

export function fetchStage5bExamples(): Promise<ExamplesResponse> {
  return requestJson('/api/stage5b/examples');
}

export function fetchStage5bExample(
  sampleId: string,
  options: CandidateStageQueryOptions,
): Promise<Stage5bResponse> {
  const params = new URLSearchParams({
    threshold: String(options.threshold),
    map_size: String(options.mapSize),
    strategy: options.strategy,
    legacy_low_threshold: String(options.legacyLowThreshold),
    legacy_snap_radius_px: String(options.legacySnapRadiusPx),
    exact_solve_timeout_seconds: String(options.exactSolveTimeoutSeconds),
  });
  return requestJson(`/api/stage5b/examples/${encodeURIComponent(sampleId)}?${params}`);
}

export function fetchStage6Examples(): Promise<ExamplesResponse> {
  return requestJson('/api/stage6/examples');
}

export function fetchStage6Example(
  sampleId: string,
  options: CandidateStageQueryOptions,
): Promise<Stage6Response> {
  const params = new URLSearchParams({
    threshold: String(options.threshold),
    map_size: String(options.mapSize),
    strategy: options.strategy,
    legacy_low_threshold: String(options.legacyLowThreshold),
    legacy_snap_radius_px: String(options.legacySnapRadiusPx),
    exact_solve_timeout_seconds: String(options.exactSolveTimeoutSeconds),
  });
  return requestJson(`/api/stage6/examples/${encodeURIComponent(sampleId)}?${params}`);
}
