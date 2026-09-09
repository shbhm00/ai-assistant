import { TimeoutError } from '../errors/errors';
import { onAbort } from './cancellation';

export interface TimeoutOptions {
  timeoutMs: number;
  message?: string;
  signal?: AbortSignal;
}

/**
 * Races a promise against a timeout. Clears the timer on settle.
 */
export async function withTimeout<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const { timeoutMs, message, signal: parent } = options;

  if (timeoutMs <= 0) {
    const controller = new AbortController();
    if (parent?.aborted) {
      throw parent.reason ?? new TimeoutError('Aborted before start');
    }
    return factory(parent ?? controller.signal);
  }

  const controller = new AbortController();
  const detachParent = onAbort(parent, () => {
    controller.abort(parent?.reason);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        const error = new TimeoutError(message ?? `Operation timed out after ${timeoutMs}ms`, {
          details: { timeoutMs },
        });
        controller.abort(error);
        reject(error);
      }, timeoutMs);

      factory(controller.signal).then(resolve, reject);
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    detachParent();
  }
}
