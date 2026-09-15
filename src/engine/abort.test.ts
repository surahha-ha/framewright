// framewright — waiting on something that cannot itself be cancelled, and
// still answering a cancel.
import { describe, expect, it, vi } from 'vitest';
import { raceAbort } from './abort';

const never = new Promise<boolean>(() => {});

describe('raceAbort', () => {
  it('passes the value through when nothing is aborted, signal or not', async () => {
    await expect(raceAbort(Promise.resolve(true))).resolves.toBe(true);
    const ctl = new AbortController();
    await expect(raceAbort(Promise.resolve(7), ctl.signal)).resolves.toBe(7);
  });

  it('refuses at once when the signal is already aborted', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(raceAbort(never, ctl.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('lets a cancel through while the wait is still pending', async () => {
    const ctl = new AbortController();
    const waiting = raceAbort(never, ctl.signal);
    ctl.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('leaves no listener behind once the wait has settled', async () => {
    const ctl = new AbortController();
    const add = vi.spyOn(ctl.signal, 'addEventListener');
    const remove = vi.spyOn(ctl.signal, 'removeEventListener');
    await raceAbort(Promise.resolve(1), ctl.signal);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    await expect(
      raceAbort(Promise.reject(new Error('x')), ctl.signal),
    ).rejects.toThrow('x');
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
