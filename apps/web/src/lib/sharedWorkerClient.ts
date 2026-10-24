import { wrap, type Remote } from 'comlink';

/** Optional bounded idle retention lets expensive static backends survive view changes. */
export function createSharedWorkerClient<Api>(create: () => Worker, idleMs = 0) {
  let worker: Worker | null = null;
  let client: Remote<Api> | null = null;
  let references = 0;
  let failure: Error | null = null;
  const pending = new Set<(error: Error) => void>();
  let idle: ReturnType<typeof setTimeout> | null = null;
  const fail = (error: Error) => {
    failure = error;
    for (const reject of [...pending]) reject(error);
  };
  return {
    retain(): Remote<Api> {
      if (idle !== null) clearTimeout(idle);
      idle = null;
      if (failure && references === 0) {
        worker?.terminate();
        worker = null;
        client = null;
      }
      if (!client) {
        worker = create();
        client = wrap<Api>(worker);
        failure = null;
        worker.addEventListener?.('error', () => fail(new Error('The rendering worker stopped unexpectedly')));
        worker.addEventListener?.('messageerror', () =>
          fail(new Error('The rendering worker returned an unreadable message'))
        );
      }
      references += 1;
      return client;
    },
    release() {
      references = Math.max(0, references - 1);
      if (references) return;
      const close = () => {
        idle = null;
        worker?.terminate();
        fail(new Error('The rendering session was closed'));
        worker = null;
        client = null;
      };
      if (idle !== null) clearTimeout(idle);
      if (idleMs > 0 && !failure) idle = setTimeout(close, idleMs);
      else close();
    },
    peek: () => client,
    count: () => references,
    /** Reject pending RPCs on worker failure; Comlink alone leaves them pending forever. */
    call<T>(work: (api: Remote<Api>) => Promise<T>, timeoutMs = 120_000, discard?: (result: T) => void): Promise<T> {
      if (!client || failure) return Promise.reject(failure ?? new Error('The rendering session is not open'));
      const api = client;
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = () => {
          settled = true;
          clearTimeout(timer);
          pending.delete(failed);
        };
        const failed = (error: Error) => {
          finish();
          reject(error);
        };
        const timer = setTimeout(() => failed(new Error('The rendering worker did not finish in time')), timeoutMs);
        pending.add(failed);
        Promise.resolve()
          .then(() => work(api))
          .then((result) => {
            if (settled) {
              discard?.(result);
              return;
            }
            finish();
            resolve(result);
          }, failed);
      });
    },
  };
}
