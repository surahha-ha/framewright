// framewright — WebAudio playback of the timeline's audio.
// Every segment from the (pure) schedule becomes one buffer source started at a
// precise time on the audio clock. The audio clock is then the MASTER clock for
// playback: video follows it, which is what keeps A/V in sync.

import { scheduleGain, type AudioSegment } from './audioSchedule';

const START_LEAD_SEC = 0.05; // a beat to schedule everything before it plays

export class AudioPlayer {
  private ctx: AudioContext;
  private sources: AudioBufferSourceNode[] = [];
  /** One per faded segment (ADR-0012); disconnected with its source. */
  private gains: GainNode[] = [];
  private startedAt = 0;
  private active = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /** Schedule all segments. Returns the audio-clock time playback begins at. */
  start(
    segments: AudioSegment[],
    getBuffer: (assetId: string) => AudioBuffer | null,
  ): number {
    this.stop();
    const t0 = this.ctx.currentTime + START_LEAD_SEC;
    for (const seg of segments) {
      const buffer = getBuffer(seg.assetId);
      if (!buffer) continue;
      const offset = Math.min(Math.max(0, seg.offsetSec), buffer.duration);
      const duration = Math.min(seg.durationSec, buffer.duration - offset);
      if (duration <= 0) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      if (seg.gain) {
        // The ramp rides the same clock as the start times, so it lands on
        // the same frames the picture blends on.
        const gain = this.ctx.createGain();
        scheduleGain(gain.gain, seg.gain, t0);
        source.connect(gain);
        gain.connect(this.ctx.destination);
        this.gains.push(gain);
      } else {
        source.connect(this.ctx.destination);
      }
      source.start(t0 + seg.whenSec, offset, duration);
      this.sources.push(source);
    }
    this.startedAt = t0;
    this.active = true;
    return t0;
  }

  /** Seconds of timeline elapsed since start (negative lead clamped to 0). */
  elapsedSec(): number {
    if (!this.active) return 0;
    return Math.max(0, this.ctx.currentTime - this.startedAt);
  }

  /**
   * Only claim the master clock when audio is genuinely running. If the context
   * is suspended (autoplay policy) its clock is frozen — following it would
   * freeze the picture too, so the caller falls back to wall time.
   */
  get isActive(): boolean {
    return (
      this.active && this.sources.length > 0 && this.ctx.state === 'running'
    );
  }

  get scheduledCount(): number {
    return this.sources.length;
  }

  stop(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      source.disconnect();
    }
    for (const gain of this.gains) gain.disconnect();
    this.gains = [];
    this.sources = [];
    this.active = false;
  }
}
