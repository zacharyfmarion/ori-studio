import { expose } from 'comlink';
import { oristudioCpWorkerApi } from './oristudioCpWorkerApi';

export type { OristudioCpWorkerApi } from './oristudioCpWorkerApi';

expose(oristudioCpWorkerApi);
