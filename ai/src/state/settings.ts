/** User settings, persisted in localStorage. */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CloudProviderId } from '../engines/cloud.ts';
import { DEFAULT_CHAT_MODEL, DEFAULT_CODE_MODEL, type DiffusionModelId, type TextModelInfo } from '../engines/models.ts';

export type Language = 'pt' | 'en';

export interface Persona {
  id: string;
  name: { en: string; pt: string };
  prompt: string;
}

export const PERSONAS: Persona[] = [
  {
    id: 'gooners',
    name: { en: 'Gooners (default)', pt: 'Gooners (padrão)' },
    prompt:
      'You are Gooners AI, a helpful assistant that runs entirely on the user\'s device. Answer clearly and directly. Use Markdown for structure and fenced code blocks for code. Reply in the language the user writes in.',
  },
  {
    id: 'coder',
    name: { en: 'Programmer', pt: 'Programador' },
    prompt:
      'You are a senior software engineer. Give correct, idiomatic, complete code in fenced blocks with the language name, then a brief explanation. Point out bugs and edge cases. Reply in the user\'s language.',
  },
  {
    id: 'writer',
    name: { en: 'Creative writer', pt: 'Escritor criativo' },
    prompt: 'You are an imaginative writer. Write vivid, original prose and poetry with strong imagery and voice. Reply in the user\'s language.',
  },
  {
    id: 'tutor',
    name: { en: 'Tutor', pt: 'Professor' },
    prompt:
      'You are a patient tutor. Explain step by step with simple examples, check understanding, and avoid jargon unless you define it. Reply in the user\'s language.',
  },
  {
    id: 'concise',
    name: { en: 'Concise', pt: 'Direto ao ponto' },
    prompt: 'Answer in as few words as possible while staying accurate. No preamble. Reply in the user\'s language.',
  },
];

export interface SettingsState {
  language: Language;
  temperature: number;
  topP: number;
  maxTokens: number;
  personaId: string;
  systemPrompt: string;
  chatModelId: string;
  codeModelId: string;
  /** Load the last used model at startup when its weights are already cached. */
  autoLoad: boolean;
  lastModelId?: string;
  customModels: TextModelInfo[];
  appMaxTokens: number;
  sandboxNetwork: boolean;
  gpuWarningDismissed: boolean;
  /** Image model chosen in the Image/Video studios (default depends on the GPU). */
  imageModelId?: DiffusionModelId;
  imageCpu: boolean;
  /** Cloud provider shown in Settings → Cloud. */
  cloudProvider: CloudProviderId;
  /** API keys per provider; kept in this browser and only sent to that provider. */
  cloudKeys: Partial<Record<CloudProviderId, string>>;
  /** Base URL of the custom OpenAI-compatible server. */
  cloudBaseUrl: string;
  /** Cloud models the user picked (so saved ids keep resolving). */
  cloudModels: TextModelInfo[];
  /** Image engine in the Image Studio. */
  imageEngine: 'local' | 'cloud' | 'abstract';
  cloudImageModel?: string;
  set: (patch: Partial<Omit<SettingsState, 'set' | 'reset'>>) => void;
  reset: () => void;
}

const browserLanguage = (): Language => (typeof navigator !== 'undefined' && /^pt\b/i.test(navigator.language) ? 'pt' : 'en');

export const DEFAULT_SETTINGS = {
  language: browserLanguage(),
  temperature: 0.7,
  topP: 0.95,
  maxTokens: 1024,
  personaId: 'gooners',
  systemPrompt: PERSONAS[0].prompt,
  chatModelId: DEFAULT_CHAT_MODEL,
  codeModelId: DEFAULT_CODE_MODEL,
  autoLoad: true,
  lastModelId: undefined,
  customModels: [] as TextModelInfo[],
  appMaxTokens: 2500,
  sandboxNetwork: false,
  gpuWarningDismissed: false,
  imageModelId: undefined as DiffusionModelId | undefined,
  imageCpu: false,
  cloudProvider: 'openrouter' as CloudProviderId,
  cloudKeys: {} as Partial<Record<CloudProviderId, string>>,
  cloudBaseUrl: 'http://localhost:11434/v1',
  cloudModels: [] as TextModelInfo[],
  imageEngine: 'local' as 'local' | 'cloud' | 'abstract',
  cloudImageModel: undefined as string | undefined,
};

/** Every non-catalog model the user added (Hugging Face, custom MLC, cloud). */
export function userModels(state: Pick<SettingsState, 'customModels' | 'cloudModels'>): TextModelInfo[] {
  return [...state.customModels, ...state.cloudModels];
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
      // Resetting preferences keeps API keys and added models.
      reset: () =>
        set((s) => ({ ...DEFAULT_SETTINGS, language: browserLanguage(), cloudKeys: s.cloudKeys, cloudModels: s.cloudModels, customModels: s.customModels })),
    }),
    { name: 'gooners-ai:settings', version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);
