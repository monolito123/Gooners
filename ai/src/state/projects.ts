/** App Builder projects (versions of generated code), persisted in localStorage. */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { GenerationStats } from '../engines/textTypes.ts';
import { uid } from '../lib/format.ts';

export interface AppVersion {
  id: string;
  prompt: string;
  code: string;
  createdAt: number;
  stats?: GenerationStats;
}

export interface AppProject {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  versions: AppVersion[];
  /** Editor contents (may differ from the latest version after manual edits). */
  code: string;
  /** localStorage of the running app, restored between previews. */
  storage: Record<string, string>;
  /** Asset ids made available as asset://name. */
  assetIds: string[];
}

interface ProjectState {
  projects: AppProject[];
  activeId?: string;
  create: (title?: string, code?: string) => string;
  select: (id: string | undefined) => void;
  remove: (id: string) => void;
  patch: (id: string, patch: Partial<AppProject>) => void;
  addVersion: (id: string, version: Omit<AppVersion, 'id' | 'createdAt'>) => void;
}

const MAX_PROJECTS = 60;
const MAX_VERSIONS = 20;

export const useProjects = create<ProjectState>()(
  persist(
    (set) => ({
      projects: [],
      activeId: undefined,
      create: (title = '', code = '') => {
        const id = uid('p_');
        const now = Date.now();
        set((s) => ({
          projects: [{ id, title, createdAt: now, updatedAt: now, versions: [], code, storage: {}, assetIds: [] }, ...s.projects].slice(0, MAX_PROJECTS),
          activeId: id,
        }));
        return id;
      },
      select: (id) => set({ activeId: id }),
      remove: (id) =>
        set((s) => {
          const projects = s.projects.filter((p) => p.id !== id);
          return { projects, activeId: s.activeId === id ? projects[0]?.id : s.activeId };
        }),
      patch: (id, patch) =>
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)) })),
      addVersion: (id, version) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id
              ? {
                  ...p,
                  code: version.code,
                  updatedAt: Date.now(),
                  versions: [...p.versions, { ...version, id: uid('v_'), createdAt: Date.now() }].slice(-MAX_VERSIONS),
                }
              : p,
          ),
        })),
    }),
    {
      name: 'gooners-ai:projects',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ projects: s.projects, activeId: s.activeId }),
    },
  ),
);
