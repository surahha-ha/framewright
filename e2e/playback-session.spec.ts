import { test, expect } from '@playwright/test';
import { pickCodec } from './helpers';

/**
 * PlaybackSession needs real WebCodecs, so it cannot be unit-tested in Node.
 * These tests drive it in a real browser against a synthetic clip encoded on the
 * fly, and they exist because two shipped bugs lived exactly here:
 *
 *  1. a clip starting mid-source (i.e. after a split) played FAST, because the
 *     session answered with the newest *buffered* frame instead of the requested
 *     one while the decoder was still catching up;
 *  2. the fix for (1) stopped consuming frames while undecided, which jammed the
 *     buffer and FROZE playback.
 */
test.describe('PlaybackSession (real WebCodecs)', () => {
  test('pulls frames accurately, mid-stream and to the tail', async ({
    page,
  }) => {
    await page.goto('/');
    const codec = await pickCodec(page);
    test.skip(!codec, 'no usable video codec in this browser');

    const results = await page.evaluate(async (codecName: string) => {
      // A URL the Vite dev server serves and transforms at runtime — not a
      // package specifier. Kept in a variable so TypeScript does not try to
      // resolve it (a `@ts-expect-error` only covers the very next line, which
      // is not where the error lands in a multi-line import call).
      const modulePath = '/src/engine/playbackSession.ts';
      const { PlaybackSession, HOLD } = await import(modulePath);

      const FPS = 30;
      const usFor = (f: number) => Math.round((f * 1e6) / FPS);
      const secFor = (f: number) => f / FPS;

      // --- encode a synthetic clip (GOP 30, so frame 40 is far from its key) ---
      const width = 160;
      const height = 90;
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d')!;
      const samples: any[] = [];
      let description: Uint8Array | undefined;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => {
          const d = meta?.decoderConfig?.description;
          if (d && !description) description = new Uint8Array(d as ArrayBuffer);
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          samples.push({
            cts: chunk.timestamp,
            dts: chunk.timestamp,
            duration: Math.round(1e6 / FPS),
            timescale: 1e6,
            is_sync: chunk.type === 'key',
            data,
          });
        },
        error: (e) => {
          throw e;
        },
      });
      const encCfg: VideoEncoderConfig = {
        codec: codecName,
        width,
        height,
        bitrate: 400_000,
        framerate: FPS,
        latencyMode: 'realtime',
      };
      if (codecName.startsWith('avc1')) encCfg.avc = { format: 'avc' };
      encoder.configure(encCfg);
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgb(${i % 256},${(i * 3) % 256},${(i * 7) % 256})`;
        ctx.fillRect(0, 0, width, height);
        const f = new VideoFrame(canvas, {
          timestamp: usFor(i),
          duration: Math.round(1e6 / FPS),
        });
        encoder.encode(f, { keyFrame: i % 30 === 0 });
        f.close();
      }
      await encoder.flush();
      encoder.close();

      const config: VideoDecoderConfig = {
        codec: codecName,
        codedWidth: width,
        codedHeight: height,
      };
      if (description) config.description = description;

      const out: Record<string, string> = {};
      const check = (name: string, cond: boolean, detail = '') => {
        out[name] = cond ? 'ok' : `FAIL ${detail}`;
      };
      const near = (a: number, b: number) => Math.abs(a - b) <= 1;

      // --- 1. sequential pull returns every frame, in order ---
      {
        const s = new PlaybackSession(samples, config, (e: any) => {
          throw e;
        });
        s.start(0);
        let ok = true;
        let detail = '';
        for (let i = 0; i < 20; i++) {
          const f = await s.awaitFrameFor(secFor(i));
          if (
            !f ||
            f === HOLD ||
            !near((f as VideoFrame).timestamp, usFor(i))
          ) {
            ok = false;
            detail = `frame ${i} -> ${f === HOLD ? 'HOLD' : (f as VideoFrame)?.timestamp}`;
            if (f && f !== HOLD) (f as VideoFrame).close();
            break;
          }
          (f as VideoFrame).close();
        }
        s.stop();
        check('sequential', ok, detail);
      }

      // --- 2. starting mid-source lands on the exact frame (no fast-forward) ---
      {
        const s = new PlaybackSession(samples, config, (e: any) => {
          throw e;
        });
        s.start(secFor(40));
        const f = await s.awaitFrameFor(secFor(40));
        const good =
          !!f && f !== HOLD && near((f as VideoFrame).timestamp, usFor(40));
        check(
          'midStreamExact',
          good,
          f && f !== HOLD
            ? `got frame ${Math.round(((f as VideoFrame).timestamp * FPS) / 1e6)}`
            : String(f),
        );
        if (f && f !== HOLD) (f as VideoFrame).close();

        let contiguous = true;
        for (let i = 41; i < 50 && contiguous; i++) {
          const n = await s.awaitFrameFor(secFor(i));
          contiguous =
            !!n && n !== HOLD && near((n as VideoFrame).timestamp, usFor(i));
          if (n && n !== HOLD) (n as VideoFrame).close();
        }
        s.stop();
        check('midStreamContiguous', contiguous);
      }

      // --- 3. frameFor keeps making progress (no buffer deadlock) ---
      {
        const s = new PlaybackSession(samples, config, (e: any) => {
          throw e;
        });
        s.start(secFor(40));
        let got: VideoFrame | null = null;
        for (let attempt = 0; attempt < 400 && !got; attempt++) {
          got = s.frameFor(secFor(40));
          if (!got) await new Promise((r) => setTimeout(r, 5));
        }
        check(
          'noDeadlock',
          !!got && near(got.timestamp, usFor(40)),
          got ? `ts ${got.timestamp}` : 'never produced a frame',
        );
        got?.close();
        s.stop();
      }

      // --- 4. between frames -> HOLD, not a stall ---
      {
        const s = new PlaybackSession(samples, config, (e: any) => {
          throw e;
        });
        s.start(0);
        const a = await s.awaitFrameFor(secFor(0));
        if (a && a !== HOLD) (a as VideoFrame).close();
        const b = await s.awaitFrameFor(0.5 / FPS);
        check('holdBetweenFrames', b === HOLD, String(b));
        if (b && b !== HOLD) (b as VideoFrame).close();
        s.stop();
      }

      // --- 5. tail frames survive (the decoder is flushed) ---
      {
        const s = new PlaybackSession(samples, config, (e: any) => {
          throw e;
        });
        s.start(secFor(55));
        const f = await s.awaitFrameFor(secFor(59));
        check(
          'tailFlushed',
          !!f && f !== HOLD && near((f as VideoFrame).timestamp, usFor(59)),
          String(f),
        );
        if (f && f !== HOLD) (f as VideoFrame).close();
        const past = await s.awaitFrameFor(secFor(200));
        check('endOfStream', past === null || past === HOLD, String(past));
        if (past && past !== HOLD) (past as VideoFrame).close();
        s.stop();
      }

      return out;
    }, codec!);

    for (const [name, value] of Object.entries(results)) {
      expect(value, name).toBe('ok');
    }
  });

  /**
   * REGRESSION — a file whose presentation does not start at zero used to be
   * decoded two frames early, with its last frames unreachable.
   *
   * Measured in real Chrome against `e2e/fixtures/sample-h264.mp4`: the playhead
   * said 22 / 44 / 69 / 89 while the frame number burnt into the picture read
   * 20 / 42 / 67 / 87. Probing the container explained it exactly — the file has
   * B-frames, its first sample's `cts` is 1024 at timescale 15360 (two frames),
   * and there is no edit list to take that offset back out. The timeline maps
   * frame n to n/fps seconds and matched that against raw `cts`, so every frame
   * was two early and the last two frames of the media could not be reached.
   *
   * The fix is `rebaseToPresentationStart` in demux (ADR-0008): the container
   * offset is taken out at the seam that owns container quirks, so playback,
   * scrub and export all inherit it. This test therefore drives the SAME seam
   * the app does — demux rebase, then the session — rather than the session
   * alone. The test above cannot see any of this because it synthesises samples
   * whose timestamps already start at 0; this one shifts them, which is what a
   * real encoder with B-frames produces.
   */
  test('a source whose presentation does not start at zero is still frame-accurate', async ({
    page,
  }) => {
    await page.goto('/');
    const codec = await pickCodec(page);
    test.skip(!codec, 'no usable video codec in this browser');

    const results = await page.evaluate(async (codecName: string) => {
      const modulePath = '/src/engine/playbackSession.ts';
      const { PlaybackSession, HOLD } = await import(modulePath);
      const demuxPath = '/src/engine/demux.ts';
      const { rebaseToPresentationStart } = await import(demuxPath);

      const FPS = 30;
      const COUNT = 60;
      /**
       * Both shapes a container can hand us. `+2` is what an unsigned-`ctts`
       * B-frame encoder leaves behind (the real fixture). `-2` is the same thing
       * expressed with signed `ctts` v1 offsets — the first picture sits BEFORE
       * zero, where no non-negative timeline position can ask for it.
       */
      const OFFSETS = [2, -2];
      const usFor = (f: number) => Math.round((f * 1e6) / FPS);
      const secFor = (f: number) => f / FPS;

      const width = 160;
      const height = 90;
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d')!;
      const samples: any[] = [];
      let description: Uint8Array | undefined;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => {
          const d = meta?.decoderConfig?.description;
          if (d && !description) description = new Uint8Array(d as ArrayBuffer);
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          samples.push({
            cts: chunk.timestamp,
            dts: chunk.timestamp,
            duration: Math.round(1e6 / FPS),
            timescale: 1e6,
            is_sync: chunk.type === 'key',
            data,
          });
        },
        error: (e) => {
          throw e;
        },
      });
      const encCfg: VideoEncoderConfig = {
        codec: codecName,
        width,
        height,
        bitrate: 400_000,
        framerate: FPS,
        latencyMode: 'realtime',
      };
      if (codecName.startsWith('avc1')) encCfg.avc = { format: 'avc' };
      encoder.configure(encCfg);
      for (let i = 0; i < COUNT; i++) {
        ctx.fillStyle = `rgb(${i % 256},${(i * 3) % 256},${(i * 7) % 256})`;
        ctx.fillRect(0, 0, width, height);
        const f = new VideoFrame(canvas, {
          timestamp: usFor(i),
          duration: Math.round(1e6 / FPS),
        });
        encoder.encode(f, { keyFrame: i % 30 === 0 });
        f.close();
      }
      await encoder.flush();
      encoder.close();

      const config: VideoDecoderConfig = {
        codec: codecName,
        codedWidth: width,
        codedHeight: height,
      };
      if (description) config.description = description;

      const out: Record<string, string> = {};
      // Frame numbers count from the first PRESENTED picture, so no offset is
      // subtracted here — if one were needed, the fix would not be a fix.
      const nth = (f: any) =>
        f && f !== HOLD ? Math.round((f.timestamp * FPS) / 1e6) : String(f);

      for (const offsetFrames of OFFSETS) {
        const key = offsetFrames > 0 ? 'late' : 'early';
        const shift = usFor(offsetFrames);
        const shifted = samples.map((s) => ({
          ...s,
          cts: s.cts + shift,
          dts: s.dts + shift,
        }));
        // The samples reach the decode path the way the app delivers them:
        // through demux, which takes the container's offset out.
        const rebased = rebaseToPresentationStart(shifted);
        const playable = rebased.samples;

        // Timeline frame 0 is the FIRST frame of the media, whatever the
        // container's clock happens to start at.
        {
          const s = new PlaybackSession(playable, config, (e: any) => {
            throw e;
          });
          s.start(0);
          const f = await s.awaitFrameFor(secFor(0));
          out[`${key}Head`] = nth(f) === 0 ? 'ok' : `FAIL got ${nth(f)}`;
          if (f && f !== HOLD) (f as VideoFrame).close();
          s.stop();
        }

        // ...and the last timeline frame is the last frame of the media, not
        // the one `offsetFrames` before it.
        {
          const s = new PlaybackSession(playable, config, (e: any) => {
            throw e;
          });
          s.start(secFor(COUNT - 5));
          const f = await s.awaitFrameFor(secFor(COUNT - 1));
          out[`${key}Tail`] =
            nth(f) === COUNT - 1 ? 'ok' : `FAIL got ${nth(f)}`;
          if (f && f !== HOLD) (f as VideoFrame).close();
          s.stop();
        }

        // ...and every frame in between, so this cannot pass on the two ends
        // while the middle is off by one.
        {
          const s = new PlaybackSession(playable, config, (e: any) => {
            throw e;
          });
          s.start(0);
          let bad = '';
          for (let i = 0; i < COUNT && !bad; i++) {
            const f = await s.awaitFrameFor(secFor(i));
            if (nth(f) !== i) bad = `frame ${i} -> ${nth(f)}`;
            if (f && f !== HOLD) (f as VideoFrame).close();
          }
          out[`${key}EveryFrame`] = bad ? `FAIL ${bad}` : 'ok';
          s.stop();
        }

        // Reported last on purpose: the frame checks above are the point, and
        // seeing THEM fail first is what tells you the mapping broke.
        out[`${key}OffsetReported`] =
          Math.abs(rebased.startOffsetSec - offsetFrames / FPS) < 1e-6
            ? 'ok'
            : `FAIL got ${rebased.startOffsetSec}`;
      }

      return out;
    }, codec!);

    for (const [name, value] of Object.entries(results)) {
      expect(value, name).toBe('ok');
    }
  });
});
