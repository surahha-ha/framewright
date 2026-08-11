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
      const { PlaybackSession, HOLD } = await import(
        '/src/engine/playbackSession.ts'
      );

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
          if (!f || f === HOLD || !near((f as VideoFrame).timestamp, usFor(i))) {
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
});
