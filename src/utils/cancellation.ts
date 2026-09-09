import { CancellationError } from '../errors/errors';

/**
 * Creates a linked AbortController that aborts when either the parent
 * signal aborts or {@link cancel} is called.
 */
export interface CancelScope {
  signal: AbortSignal;
  cancel: (reason?: string) => void;
  isCancelled: () => boolean;
}

export function createCancelScope(parent?: AbortSignal): CancelScope {
  const controller = new AbortController();
  let cancelled = false;

  const onParentAbort = () => {
    if (!cancelled) {
      cancelled = true;
      controller.abort(parent?.reason ?? new CancellationError());
    }
  };

  if (parent) {
    if (parent.aborted) {
      onParentAbort();
    } else {
      parent.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cancel: (reason = 'Request was cancelled') => {
      if (!cancelled) {
        cancelled = true;
        controller.abort(new CancellationError(reason));
      }
    },
    isCancelled: () => cancelled || controller.signal.aborted,
  };
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const reason = signal.reason;
    if (reason instanceof CancellationError) {
      throw reason;
    }
    throw new CancellationError(
      reason instanceof Error ? reason.message : 'Request was cancelled'
    );
  }
}

export function onAbort(
  signal: AbortSignal | undefined,
  callback: () => void
): () => void {
  if (!signal) {
    return () => undefined;
  }
  if (signal.aborted) {
    callback();
    return () => undefined;
  }
  signal.addEventListener('abort', callback, { once: true });
  return () => signal.removeEventListener('abort', callback);
}
