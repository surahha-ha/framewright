// The document has to remember WHERE an asset's file was stored, or the media
// store is write-only and the reload still asks for the file. Recording it is a
// document edit, so it goes through the command spine like everything else
// (CLAUDE.md rule 2).
import { describe, expect, it } from 'vitest';
import { createEditor } from './command';
import { createProject } from './project';
import type { Project } from './types';

function withAsset(extra: { opfsKey?: string; startOffsetSec?: number } = {}) {
  const project: Project = {
    ...createProject(),
    assets: [
      {
        id: 'asset_1',
        kind: 'video',
        name: 'clip.mp4',
        meta: {
          durationSec: 3,
          ...('startOffsetSec' in extra
            ? { startOffsetSec: extra.startOffsetSec }
            : {}),
        },
        ...(extra.opfsKey ? { opfsKey: extra.opfsKey } : {}),
      },
    ],
  };
  return createEditor(project);
}

const asset = (e: ReturnType<typeof createEditor>) => e.project.assets[0];

describe('asset.attachMedia', () => {
  it('records where the file was stored', () => {
    const editor = withAsset();
    expect(
      editor.dispatch('asset.attachMedia', {
        assetId: 'asset_1',
        opfsKey: 'media_abc',
      }),
    ).toBe(true);
    expect(asset(editor).opfsKey).toBe('media_abc');
  });

  it('records the source offset alongside it, so the pre-ADR-0008 warning stops repeating', () => {
    const editor = withAsset();
    editor.dispatch('asset.attachMedia', {
      assetId: 'asset_1',
      opfsKey: 'media_abc',
      startOffsetSec: 0.0667,
    });
    expect(asset(editor).meta.startOffsetSec).toBeCloseTo(0.0667);
  });

  it('is undoable, and undo puts back exactly what was there before', () => {
    const editor = withAsset({ opfsKey: 'media_old', startOffsetSec: 0.5 });
    editor.dispatch('asset.attachMedia', {
      assetId: 'asset_1',
      opfsKey: 'media_new',
      startOffsetSec: 0.25,
    });
    expect(editor.undo()).toBe(true);
    expect(asset(editor).opfsKey).toBe('media_old');
    expect(asset(editor).meta.startOffsetSec).toBe(0.5);
  });

  it('undo restores "never had an offset", not "offset zero"', () => {
    // The absence of startOffsetSec is meaningful: it is what tells a re-link
    // that this asset predates the offset correction (ADR-0008).
    const editor = withAsset();
    editor.dispatch('asset.attachMedia', {
      assetId: 'asset_1',
      opfsKey: 'media_new',
      startOffsetSec: 0.25,
    });
    editor.undo();
    expect('startOffsetSec' in asset(editor).meta).toBe(false);
  });

  it('refuses when nothing would change, so a re-link cannot pile up empty undo steps', () => {
    const editor = withAsset({ opfsKey: 'media_abc', startOffsetSec: 0.25 });
    expect(
      editor.canRun('asset.attachMedia', {
        assetId: 'asset_1',
        opfsKey: 'media_abc',
        startOffsetSec: 0.25,
      }),
    ).toBe(false);
    expect(editor.canUndo()).toBe(false);
  });

  it('refuses an asset the document does not have', () => {
    const editor = withAsset();
    expect(
      editor.canRun('asset.attachMedia', {
        assetId: 'asset_9',
        opfsKey: 'media_abc',
      }),
    ).toBe(false);
  });

  it('leaves the clips alone — attaching media is not an edit to the cut', () => {
    const editor = withAsset();
    const before = JSON.stringify(editor.project.tracks);
    editor.dispatch('asset.attachMedia', {
      assetId: 'asset_1',
      opfsKey: 'media_abc',
    });
    expect(JSON.stringify(editor.project.tracks)).toBe(before);
  });
});
