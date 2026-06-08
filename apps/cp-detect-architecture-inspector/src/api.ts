import type {
  ExamplesResponse,
  Stage1Response,
  Stage2Response,
  Stage3Response,
  Stage4Response,
  Stage5Response,
  Stage5bResponse,
  Stage6Response,
  StageInfo,
} from './types';

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.text();
  const payload = body ? JSON.parse(body) : {};
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }
  return payload as T;
}

type StageQueryOptions = { threshold: number; mapSize: number };
type CandidateStageQueryOptions = StageQueryOptions & {
  strategy: string;
  legacyLowThreshold: number;
  legacySnapRadiusPx: number;
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

export function fetchStage3Examples(): Promise<ExamplesResponse> {
  return requestJson('/api/stage3/examples');
}

export function fetchStage3Example(
  sampleId: string,
  options: StageQueryOptions,
): Promise<Stage3Response> {
  const params = new URLSearchParams({
    threshold: String(options.threshold),
    map_size: String(options.mapSize),
  });
  return requestJson(`/api/stage3/examples/${encodeURIComponent(sampleId)}?${params}`);
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
  });
  return requestJson(`/api/stage6/examples/${encodeURIComponent(sampleId)}?${params}`);
}
