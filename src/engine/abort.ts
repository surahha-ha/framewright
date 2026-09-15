// framewright — answering a cancel while waiting on something that cannot
// itself be cancelled (a font file on its way, ADR-0018).
//
// The exporter checks its signal between frames; a wait it cannot break
// into needs the signal raced against it, or Cancel does nothing until the
// wait ends on its own — which a stalled fetch never does.

export function abortError(): DOMException {
  return new DOMException('취소됨', 'AbortError');
}

/** The promise's own outcome, unless the signal fires first — then an
 *  `AbortError`, at once. The listener is removed either way. */
export function raceAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    const done = () => signal.removeEventListener('abort', onAbort);
    promise.then(
      (value) => {
        done();
        resolve(value);
      },
      (reason: unknown) => {
        done();
        reject(reason);
      },
    );
  });
}
