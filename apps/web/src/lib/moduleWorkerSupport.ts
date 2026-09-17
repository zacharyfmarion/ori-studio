/**
 * Does this browser honour `new Worker(url, { type: 'module' })`?
 *
 * Every engine in the app is a module worker (`engines/engineHost.ts`), and the bundler
 * writes them as ES modules with `import.meta.url` in the wasm loader. A browser without
 * module workers does not refuse the option — it *ignores* it and starts a classic worker,
 * which then fails to parse at the first `import.meta`. That reached production as
 * ORI-STUDIO-B: Firefox 96 on Linux (module workers arrived in 114), four
 * `SyntaxError: import.meta may only appear in a module` from the CP worker on the welcome
 * screen, and an app that could not do anything from there on. The user got a generic
 * "worker stopped" toast and no explanation.
 *
 * Feature-detected rather than sniffed, and by observation rather than by the option
 * getter trick: an engine can read `type` from the options dictionary and still start a
 * classic worker, so the only reliable question is what kind of worker actually came up.
 * Top-level `this` is the one thing a script can report that differs between the two —
 * `undefined` in a module, the global scope in a classic script — and a script that is
 * only that line parses as either.
 */

export type ModuleWorkerSupport = 'supported' | 'unsupported' | 'unknown';

const PROBE_SOURCE = 'self.postMessage(this === undefined ? "module" : "classic")';

type WorkerConstructor = new (url: string, options?: WorkerOptions) => Worker;

/**
 * Resolves `unsupported` only on the positive evidence of a classic worker starting.
 *
 * Everything else that can go wrong — no `Worker` at all, a CSP that forbids `blob:`
 * workers, an `error` event from the probe itself — resolves `unknown`: those say nothing
 * about module support, and the app must not refuse to start on them. A real engine
 * failure still surfaces through the engine's own diagnostics.
 */
export function probeModuleWorkerSupport(
  WorkerCtor: WorkerConstructor | undefined = globalThis.Worker
): Promise<ModuleWorkerSupport> {
  return new Promise((resolve) => {
    if (typeof WorkerCtor !== 'function' || typeof URL.createObjectURL !== 'function') {
      resolve('unknown');
      return;
    }

    let url: string;
    let worker: Worker;
    try {
      url = URL.createObjectURL(new Blob([PROBE_SOURCE], { type: 'text/javascript' }));
    } catch {
      resolve('unknown');
      return;
    }
    try {
      worker = new WorkerCtor(url, { type: 'module' });
    } catch {
      URL.revokeObjectURL(url);
      resolve('unknown');
      return;
    }

    const settle = (result: ModuleWorkerSupport) => {
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    worker.addEventListener('message', (event: MessageEvent) => {
      settle(event.data === 'classic' ? 'unsupported' : 'supported');
    });
    worker.addEventListener('error', (event) => {
      // The probe's own failure is nobody's crash: keep it off `window.onerror`, where it
      // would be reported as one.
      event.preventDefault();
      settle('unknown');
    });
  });
}
