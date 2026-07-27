// framewright — app state (zustand).
import { create } from 'zustand';
import type { Asset, Project } from '../engine/types';

interface State {
  project: Project | null;
  currentFrame: number;
  isPlaying: boolean;
  status: string;
  setProject: (p: Project) => void;
  addVideoAsset: (asset: Asset, durationFrames: number) => void;
  setCurrentFrame: (f: number) => void;
  setPlaying: (b: boolean) => void;
  setStatus: (s: string) => void;
}

export const useStore = create<State>((set) => ({
  project: null,
  currentFrame: 0,
  isPlaying: false,
  status: '영상을 불러오세요.',
  setProject: (project) => set({ project }),
  addVideoAsset: (asset, durationFrames) =>
    set((state) => {
      if (!state.project) return state;
      const tracks = state.project.tracks.map((t) =>
        t.type === 'video'
          ? {
              ...t,
              clips: [
                ...t.clips,
                {
                  id: 'clip_' + asset.id,
                  assetId: asset.id,
                  startFrame: 0,
                  inFrame: 0,
                  outFrame: durationFrames,
                },
              ],
            }
          : t,
      );
      return {
        project: {
          ...state.project,
          tracks,
          assets: [...state.project.assets, asset],
        },
      };
    }),
  setCurrentFrame: (currentFrame) => set({ currentFrame }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setStatus: (status) => set({ status }),
}));
