// framewright — playback clock.
// Master clock derives the current frame from elapsed wall time * fps.
// The engine NEVER uses Date.now() for timing decisions elsewhere; playback
// position always flows from here so preview stays reproducible.

import type { Rational } from './types';

export class Player {
  private raf = 0;
  private startWall = 0;
  private startFrame = 0;
  playing = false;

  constructor(
    private fps: Rational,
    private totalFrames: number,
    private onFrame: (frame: number) => void,
    private onEnd?: () => void,
  ) {}

  play(fromFrame: number): void {
    this.playing = true;
    this.startFrame = fromFrame;
    this.startWall = performance.now();
    const tick = () => {
      if (!this.playing) return;
      const elapsedSec = (performance.now() - this.startWall) / 1000;
      const frame =
        this.startFrame + Math.floor((elapsedSec * this.fps.num) / this.fps.den);
      if (frame >= this.totalFrames) {
        this.onFrame(Math.max(0, this.totalFrames - 1));
        this.pause();
        this.onEnd?.();
        return;
      }
      this.onFrame(frame);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause(): void {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
