// framewright — the decoder pool behind playback and export (ADR-0012).
import { describe, expect, it } from 'vitest';
import { FeedPool, type FeedSession } from './feeds';
import { FPS_30 } from './time';
import { HOLD } from './playbackSession';

/** A frame stand-in that remembers whether it was closed. */
function fakeFrame(tag: string) {
  return {
    tag,
    closed: false,
    close() {
      this.closed = true;
    },
  };
}
type Fake = ReturnType<typeof fakeFrame>;

/** A session that hands out one fake frame per pull and logs its life. */
function fakeSession(log: string[], name: string) {
  let n = 0;
  const session: FeedSession & { frames: Fake[] } = {
    frames: [],
    start(fromSec) {
      log.push(`${name} start ${fromSec}`);
    },
    frameFor() {
      const f = fakeFrame(`${name}#${n++}`);
      session.frames.push(f);
      return f as unknown as VideoFrame;
    },
    async awaitFrameFor() {
      const f = fakeFrame(`${name}#${n++}`);
      session.frames.push(f);
      return f as unknown as VideoFrame;
    },
    stop() {
      log.push(`${name} stop`);
    },
  };
  return session;
}

function pool(log: string[]) {
  let opened = 0;
  const sessions: ReturnType<typeof fakeSession>[] = [];
  const p = new FeedPool((assetId) => {
    if (assetId === 'gone') return null;
    const s = fakeSession(log, `${assetId}/${opened++}`);
    sessions.push(s);
    return s;
  }, FPS_30);
  return { p, sessions };
}

describe('FeedPool', () => {
  it('opens one session for a source and keeps it while the frames run on', () => {
    const log: string[] = [];
    const { p } = pool(log);
    p.begin();
    const a = p.feed({ assetId: 'a', sourceFrame: 10 });
    p.end();
    p.begin();
    const again = p.feed({ assetId: 'a', sourceFrame: 11 });
    p.end();
    expect(again).toBe(a);
    expect(log).toEqual([`a/0 start ${10 / 30}`]);
  });

  it('re-opens on a backward jump or another source, and drops what is unused', () => {
    const log: string[] = [];
    const { p } = pool(log);
    p.begin();
    p.feed({ assetId: 'a', sourceFrame: 50 });
    p.end();
    p.begin();
    p.feed({ assetId: 'a', sourceFrame: 10 }); // backwards
    p.end();
    expect(log).toEqual([
      `a/0 start ${50 / 30}`,
      `a/1 start ${10 / 30}`,
      'a/0 stop',
    ]);
  });

  it('serves two sources at once — the two sides of a dissolve', () => {
    const log: string[] = [];
    const { p } = pool(log);
    p.begin();
    const a = p.feed({ assetId: 'a', sourceFrame: 30 });
    const b = p.feed({ assetId: 'b', sourceFrame: 0 });
    p.end();
    expect(a).not.toBe(b);
    expect(p.size).toBe(2);
    // The next frame: both continue, nothing re-opens.
    p.begin();
    expect(p.feed({ assetId: 'b', sourceFrame: 1 })).toBe(b);
    expect(p.feed({ assetId: 'a', sourceFrame: 31 })).toBe(a);
    p.end();
    expect(log.filter((l) => l.endsWith('stop'))).toEqual([]);
  });

  it('keeps the same session across the cut: the overhang IS the continuation', () => {
    // a is primary, then b; after the cut a is the blend under b — the same
    // decoder, the same forward run, never restarted.
    const log: string[] = [];
    const { p } = pool(log);
    p.begin();
    const a = p.feed({ assetId: 'a', sourceFrame: 29 });
    p.end();
    p.begin();
    const b = p.feed({ assetId: 'b', sourceFrame: 0 });
    const under = p.feed({ assetId: 'a', sourceFrame: 30 });
    p.end();
    expect(under).toBe(a);
    expect(b).not.toBe(a);
    expect(log.filter((l) => l.includes('a/')).length).toBe(1);
  });

  it('answers the same want twice with the same feed', () => {
    // A dissolve across a split of one shot asks for the identical frame on
    // both sides; a second decoder for it would be pure waste.
    const log: string[] = [];
    const { p } = pool(log);
    p.begin();
    const one = p.feed({ assetId: 'a', sourceFrame: 5 });
    const two = p.feed({ assetId: 'a', sourceFrame: 5 });
    p.end();
    expect(two).toBe(one);
    expect(p.size).toBe(1);
  });

  it('holds the newest picture and closes the one before it', () => {
    const log: string[] = [];
    const { p, sessions } = pool(log);
    p.begin();
    const a = p.feed({ assetId: 'a', sourceFrame: 0 })!;
    expect(p.pull(a, 0)).toBe(true);
    const first = a.current as unknown as Fake;
    expect(first.tag).toBe('a/0#0');
    expect(p.pull(a, 1 / 30)).toBe(true);
    expect(first.closed).toBe(true);
    expect((a.current as unknown as Fake).tag).toBe('a/0#1');
    p.end();
    // Stopping closes the held picture too.
    p.stopAll();
    expect(sessions[0].frames.every((f) => f.closed)).toBe(true);
    expect(log).toContain('a/0 stop');
  });

  it('reports a held frame and an exhausted source distinctly, for export', async () => {
    const log: string[] = [];
    const { p, sessions } = pool(log);
    p.begin();
    const a = p.feed({ assetId: 'a', sourceFrame: 0 })!;
    expect(await p.pullWait(a, 0)).toBe('frame');
    const kept = a.current;
    sessions[0].awaitFrameFor = async () => HOLD;
    expect(await p.pullWait(a, 1 / 30)).toBe('hold');
    expect(a.current).toBe(kept); // still the last real picture
    sessions[0].awaitFrameFor = async () => null;
    expect(await p.pullWait(a, 2 / 30)).toBe('missing');
    expect(a.current).toBeNull();
    expect((kept as unknown as Fake).closed).toBe(true);
  });

  it('is null for a source that cannot be opened', () => {
    const log: string[] = [];
    const { p } = pool(log);
    p.begin();
    expect(p.feed({ assetId: 'gone', sourceFrame: 0 })).toBeNull();
    p.end();
    expect(p.size).toBe(0);
  });
});

describe('FeedPool — one feed asked twice in one frame', () => {
  it('keeps the picture the first pull produced when the second pull holds', async () => {
    // A dissolve across a split of one shot: primary and blend are the same
    // want, answered by one feed, pulled twice. The second pull sees nothing
    // newer (HOLD) and must not close what the first handed out.
    const log: string[] = [];
    let n = 0;
    const session: FeedSession = {
      start() {},
      frameFor: () => null,
      awaitFrameFor: async () =>
        n++ === 0 ? (fakeFrame('only') as unknown as VideoFrame) : HOLD,
      stop() {
        log.push('stop');
      },
    };
    const p = new FeedPool(() => session, FPS_30);
    p.begin();
    const primary = p.feed({ assetId: 'a', sourceFrame: 5 })!;
    expect(await p.pullWait(primary, 5 / 30)).toBe('frame');
    const first = primary.current as unknown as Fake;
    const blend = p.feed({ assetId: 'a', sourceFrame: 5 })!;
    expect(blend).toBe(primary);
    expect(await p.pullWait(blend, 5 / 30)).toBe('hold');
    expect(primary.current).toBe(first);
    expect(first.closed).toBe(false);
    p.end();
    expect(log).toEqual([]);
  });
});
