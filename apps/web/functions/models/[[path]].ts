import { handleModels, preflight, type ModelsContext, type ModelsEdgeCache } from '../_lib/models';

function edgeCache(): ModelsEdgeCache | null {
  const store = (globalThis as { caches?: { default?: ModelsEdgeCache } }).caches?.default;
  return store ?? null;
}

export async function onRequestGet(context: ModelsContext): Promise<Response> {
  return handleModels(context, edgeCache());
}

export async function onRequestHead(context: ModelsContext): Promise<Response> {
  return handleModels(context, edgeCache());
}

export async function onRequestOptions(): Promise<Response> {
  return preflight();
}
