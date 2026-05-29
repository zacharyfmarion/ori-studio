import type { ExamplesResponse, Stage1Response, Stage2Response, Stage3Response, StageInfo } from './types';

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.text();
  const payload = body ? JSON.parse(body) : {};
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }
  return payload as T;
}

export function fetchStages(): Promise<{ stages: StageInfo[] }> {
  return requestJson('/api/stages');
}

export function fetchStage1Examples(): Promise<ExamplesResponse> {
  return requestJson('/api/stage1/examples');
}

export function fetchStage1Example(
  sampleId: string,
  options: { threshold: number; mapSize: number },
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
  options: { threshold: number; mapSize: number },
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
  options: { threshold: number; mapSize: number },
): Promise<Stage3Response> {
  const params = new URLSearchParams({
    threshold: String(options.threshold),
    map_size: String(options.mapSize),
  });
  return requestJson(`/api/stage3/examples/${encodeURIComponent(sampleId)}?${params}`);
}
