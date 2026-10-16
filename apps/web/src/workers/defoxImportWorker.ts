import { expose } from 'comlink';
import { renderDefox } from '../diagram/import/defoxRenderer.js';
const api = { renderDefox };
export type DefoxImportWorkerApi = typeof api;
expose(api);
