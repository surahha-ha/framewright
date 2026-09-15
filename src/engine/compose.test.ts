// framewright — the one draw order for a frame, checked with a fake context.
import { describe, expect, it } from 'vitest';
import { composeFrame, type FrameContext } from './compose';
import { AS_SHOT, type PictureTransform } from './picture';

function fakeCtx() {
  const calls: string[] = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push(
        `rect ${x},${y} ${w}x${h} a=${this.globalAlpha} ${this.fillStyle}`,
      );
    },
    drawImage(img: unknown, x: number, y: number, w: number, h: number) {
      calls.push(
        `img ${(img as { tag: string }).tag} ${x},${y} ${w}x${h} a=${this.globalAlpha}`,
      );
    },
    fillText(text: string) {
      calls.push(`text ${text}`);
    },
    measureText: (text: string) => ({ width: text.length * 10 }),
    // A real context restores its state; the fake keeps that one promise
    // for the alpha, which is what an effect changes (ADR-0017).
    saved: [] as number[],
    save() {
      calls.push('save');
      this.saved.push(this.globalAlpha);
    },
    restore() {
      calls.push('restore');
      this.globalAlpha = this.saved.pop() ?? this.globalAlpha;
    },
    translate(x: number, y: number) {
      calls.push(`translate ${x},${y}`);
    },
    rotate(angle: number) {
      calls.push(`rotate ${Math.round((angle * 180) / Math.PI)}`);
    },
    scale(x: number, y: number) {
      calls.push(`scale ${x},${y}`);
    },
    strokeText(text: string) {
      calls.push(`stroke ${text}`);
    },
    beginPath() {},
    roundRect() {},
    fill() {},
  };
  return { ctx: ctx as unknown as FrameContext, calls };
}

const pic = (tag: string, w = 160, h = 90) =>
  ({ tag, displayWidth: w, displayHeight: h }) as never;

describe('composeFrame', () => {
  it('paints black under everything, so a gap and a missing source are black', () => {
    const { ctx, calls } = fakeCtx();
    composeFrame(ctx, 320, 180, null, null, null);
    expect(calls).toEqual(['rect 0,0 320x180 a=1 #000']);
  });

  it('letterboxes the footage into the box, at full strength', () => {
    const { ctx, calls } = fakeCtx();
    composeFrame(ctx, 320, 320, pic('a'), null, null);
    expect(calls[1]).toBe('img a 0,70 320x180 a=1');
  });

  it('lays the second picture over at its weight, then puts the alpha back', () => {
    const { ctx, calls } = fakeCtx();
    composeFrame(
      ctx,
      320,
      180,
      pic('a'),
      { frame: pic('b'), weight: 0.25 },
      null,
    );
    expect(calls).toEqual([
      'rect 0,0 320x180 a=1 #000',
      'img a 0,0 320x180 a=1',
      'img b 0,0 320x180 a=0.25',
    ]);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('fades to black with a black rectangle at the weight', () => {
    const { ctx, calls } = fakeCtx();
    composeFrame(ctx, 320, 180, pic('a'), { frame: null, weight: 1 }, null);
    expect(calls[2]).toBe('rect 0,0 320x180 a=1 #000');
  });

  it('draws the words last, over the blend', () => {
    const { ctx, calls } = fakeCtx();
    composeFrame(
      ctx,
      320,
      180,
      pic('a'),
      { frame: null, weight: 0.5 },
      { text: '안녕', t: 1 },
    );
    expect(calls[calls.length - 1]).toBe('text 안녕');
    expect(calls.indexOf('text 안녕')).toBeGreaterThan(2);
  });

  it('draws a plain subtitle through exactly the calls it always did — no save, no transform', () => {
    const { ctx, calls } = fakeCtx();
    composeFrame(ctx, 320, 180, pic('a'), null, { text: '안녕', t: 1 });
    expect(calls.slice(2)).toEqual([
      expect.stringMatching(/^rect .* rgba\(0, 0, 0, 0\.62\)$/),
      'text 안녕',
    ]);
  });

  it('applies an effect inside a save/restore, so the next frame starts clean (ADR-0017)', () => {
    const { ctx, calls } = fakeCtx();
    composeFrame(ctx, 320, 180, pic('a'), null, {
      text: '안녕',
      effect: 'fade',
      t: 0.25,
    });
    expect(calls[2]).toBe('save');
    expect(calls[calls.length - 1]).toBe('restore');
    expect(calls).toContain('text 안녕');
    expect(ctx.globalAlpha).toBe(1);
  });
});

describe('composeFrame — where the clip puts its picture (ADR-0014)', () => {
  const t = (extra: Partial<PictureTransform> = {}): PictureTransform => ({
    ...AS_SHOT,
    ...extra,
  });

  it('draws a picture as shot through exactly the calls it always did', () => {
    const { ctx, calls } = fakeCtx();
    composeFrame(ctx, 320, 180, pic('a'), null, null, t());
    expect(calls).toEqual([
      'rect 0,0 320x180 a=1 #000',
      'img a 0,0 320x180 a=1',
    ]);
  });

  it('grows the picture about the centre and moves it by the pan times the zoom', () => {
    const { ctx, calls } = fakeCtx();
    // Half a box of pan at 200% is a whole box: the picture's own edge
    // lands on the box's centre.
    composeFrame(
      ctx,
      320,
      180,
      pic('a'),
      null,
      null,
      t({ zoom: 2, panX: 0.5 }),
    );
    expect(calls[1]).toBe('img a 160,-90 640x360 a=1');
  });

  it('turns the picture about its own centre, and puts the context back', () => {
    const { ctx, calls } = fakeCtx();
    composeFrame(ctx, 320, 180, pic('a'), null, null, t({ rotation: 90 }));
    expect(calls.slice(1)).toEqual([
      'save',
      'translate 160,90',
      'rotate 90',
      'img a -90,-50.625 180x101.25 a=1',
      'restore',
    ]);
  });

  it('draws the second picture where ITS clip puts it, not where this one does', () => {
    const { ctx, calls } = fakeCtx();
    composeFrame(
      ctx,
      320,
      180,
      pic('a'),
      { frame: pic('b'), weight: 0.5, transform: t({ zoom: 2 }) },
      null,
      t({ panX: 0.5 }),
    );
    expect(calls[1]).toBe('img a 160,0 320x180 a=1');
    expect(calls[2]).toBe('img b -160,-90 640x360 a=0.5');
  });
});
