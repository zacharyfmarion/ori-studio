/**
 * The escape hatch. Emitted to `dist/sw-kill.js` beside `sw.js`, and registered
 * by nobody until it is needed.
 *
 * To use it: change `SERVICE_WORKER_URL` in `register.ts` to `/sw-kill.js` and
 * deploy. A registration whose script URL changes is replaced, this worker
 * skips the waiting phase, takes over every open page, empties the caches and
 * unregisters itself. One line, one deploy, minutes.
 *
 * It exists because the failure mode it covers is the one a service worker
 * uniquely has: a bad worker keeps serving after the bad deploy is rolled back,
 * because the client already has it. Without a lever like this the recovery is
 * asking people to clear site data, which on an installed app means deleting it.
 * The cost of carrying it is a few hundred bytes nobody fetches.
 *
 * Deliberately not part of `sw.ts`. A kill switch that shares a file with the
 * thing it kills is a kill switch that can be broken by the same bug.
 */

interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface KillGlobalScopeLike {
  readonly clients: { claim(): Promise<void> };
  readonly registration: { unregister(): Promise<boolean> };
  skipWaiting(): Promise<void>;
  addEventListener(
    type: 'install' | 'activate',
    listener: (event: ExtendableEventLike) => void
  ): void;
}

const worker = self as unknown as KillGlobalScopeLike;

worker.addEventListener('install', (event) => {
  // The one worker that *should* skip waiting: the point is to displace a
  // worker that is currently misbehaving, not to queue behind it.
  event.waitUntil(worker.skipWaiting());
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      await worker.clients.claim();
      await worker.registration.unregister();
    })()
  );
});
