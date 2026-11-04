import { expose } from 'comlink';
import { drawDefoxStep, openDefox } from '../diagram/import/defoxRenderer.js';
const api = { openDefox, drawDefoxStep };
export type DefoxImportWorkerApi = typeof api;
expose(api);
