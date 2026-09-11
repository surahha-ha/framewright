// framewright — the box's shape as commands (ADR-0015).
//
// Three commands, one per preset: 가로 (16:9), 세로 (9:16), 정사각 (1:1).
// Each is one `setTimeline` op — the box takes another size, the frame rate
// stays — and its inverse is the box as it was. Nothing on any clip is
// rewritten: a picture is fitted into the new box by the same rectangle it
// always was (`pictureRect`), and a pan the new box cannot show is read at
// the new limit, never changed (the sound ceiling's rule). The sentence
// says where to go when a clip's picture no longer covers the box.
//
// The commands refuse an EMPTY project. The first import sets the box from
// the footage (`Editor.importAsset`), so a shape chosen before it would be
// overwritten by it — silently, on the very next step.

import type { Command, EditorCtx } from './commands';
import {
  FRAME_LABEL,
  FRAME_SHAPES,
  describeFrame,
  frameShapeOf,
  frameSize,
  type FrameHints,
  type FrameShape,
} from './frame';
import { clipEmptySides, clipFillZoom, pictureTransform } from './picture';
import { videoTrack } from './timeline';
import type { Project } from './types';

const ICON: Record<FrameShape, string> = {
  landscape: '▬',
  portrait: '▮',
  square: '■',
};

const IMPORT_FIRST = '영상을 먼저 넣어 주세요.';

function decide(ctx: EditorCtx, shape: FrameShape) {
  if (ctx.project.assets.length === 0) return null;
  const { width, height } = ctx.project.timeline;
  if (frameShapeOf(width, height) === shape) return null;
  return frameSize(shape, width, height);
}

/** What THIS box does to the clips' pictures: which of the two things the
 *  sentence should say. Read from the document after the change. */
export function frameHints(project: Project): FrameHints {
  const clips = videoTrack(project).clips;
  return {
    uncovered: clips.some((clip) => clipEmptySides(project, clip).length > 0),
    overzoomed: clips.some(
      (clip) =>
        pictureTransform(clip).zoom > 1 &&
        pictureTransform(clip).zoom > clipFillZoom(project, clip),
    ),
  };
}

function frameCommand(shape: FrameShape): Command {
  const label = `${FRAME_LABEL[shape]} 영상으로 바꾸기`;
  return {
    id: `frame.${shape}`,
    label,
    icon: ICON[shape],
    hidden: true,
    done(before, after) {
      const size = decide(before, shape);
      return size
        ? describeFrame(
            shape,
            size.width,
            size.height,
            frameHints(after.project),
          )
        : '';
    },
    disabledReason(ctx) {
      return ctx.project.assets.length === 0
        ? IMPORT_FIRST
        : `지금 ${FRAME_LABEL[shape]} 영상이에요.`;
    },
    canRun: (ctx) => decide(ctx, shape) !== null,
    run(ctx) {
      const size = decide(ctx, shape);
      if (!size) throw new Error(`frame.${shape}: nothing to change`);
      const timeline = ctx.project.timeline;
      return {
        forward: [
          { kind: 'setTimeline', config: { fps: timeline.fps, ...size } },
        ],
        inverse: [{ kind: 'setTimeline', config: timeline }],
      };
    },
  };
}

export const FRAME_COMMANDS: Command[] = FRAME_SHAPES.map(frameCommand);
