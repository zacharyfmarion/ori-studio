import { onEngineLost } from '../../engines/engineHost';

/** The crease-pattern engine went away while a capture waited on it. */
export class CaptureEngineLostError extends Error {
  constructor() {
    super('The crease-pattern engine stopped before the picture was captured');
    this.name = 'CaptureEngineLostError';
  }
}

/**
 * `work`, unless the crease-pattern engine is lost first (D4): a call on a dead
 * worker never settles, and a capture that waited on one forever would leave
 * its step "capturing" for good. Rejects with {@link CaptureEngineLostError}.
 */
export function abandonOnEngineLoss<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = onEngineLost(({ engine }) => {
      if (engine !== 'oristudio-cp') return;
      stop();
      reject(new CaptureEngineLostError());
    });
    work.then(
      (value) => {
        stop();
        resolve(value);
      },
      (error: unknown) => {
        stop();
        reject(error);
      }
    );
  });
}
