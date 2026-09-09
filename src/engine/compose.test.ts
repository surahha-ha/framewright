// framewright — the one draw order for a frame, checked with a fake context.
import { describe, expect, it } from 'vitest';
import { composeFrame, type FrameContext } from './compose';

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
    save() {},
    restore() {},
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
    composeFrame(ctx, 320, 180, pic('a'), { frame: null, weight: 0.5 }, '안녕');
    expect(calls[calls.length - 1]).toBe('text 안녕');
    expect(calls.indexOf('text 안녕')).toBeGreaterThan(2);
  });
});
