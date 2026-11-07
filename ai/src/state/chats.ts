/** Chat sessions, persisted in localStorage. Streaming text stays out of here until a turn ends. */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { GenerationStats } from '../engines/textTypes.ts';
import { uid } from '../lib/format.ts';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  stats?: GenerationStats;
  modelLabel?: string;
  error?: string;
  /** The user's message asked for an app: offer to build it in the App Builder. */
  appIntent?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

interface ChatState {
  sessions: ChatSession[];
  activeId?: string;
  create: () => string;
  select: (id: string) => void;
  remove: (id: string) => void;
  rename: (id: string, title: string) => void;
  append: (sessionId: string, message: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string }) => string;
  update: (sessionId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  truncateAfter: (sessionId: string, messageId: string) => void;
  clear: () => void;
}

const MAX_SESSIONS = 200;

export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 48 ? `${clean.slice(0, 46)}…` : clean || '…';
}

export const useChats = create<ChatState>()(
  persist(
    (set) => ({
      sessions: [],
      activeId: undefined,
      create: () => {
        const id = uid('c_');
        const now = Date.now();
        set((s) => ({ sessions: [{ id, title: '', createdAt: now, updatedAt: now, messages: [] }, ...s.sessions].slice(0, MAX_SESSIONS), activeId: id }));
        return id;
      },
      select: (id) => set({ activeId: id }),
      remove: (id) =>
        set((s) => {
          const sessions = s.sessions.filter((c) => c.id !== id);
          return { sessions, activeId: s.activeId === id ? sessions[0]?.id : s.activeId };
        }),
      rename: (id, title) => set((s) => ({ sessions: s.sessions.map((c) => (c.id === id ? { ...c, title } : c)) })),
      append: (sessionId, message) => {
        const id = message.id ?? uid('m_');
        const now = Date.now();
        set((s) => ({
          sessions: s.sessions.map((c) =>
            c.id === sessionId
              ? {
                  ...c,
                  title: c.title || (message.role === 'user' ? titleFrom(message.content) : c.title),
                  updatedAt: now,
                  messages: [...c.messages, { ...message, id, createdAt: now }],
                }
              : c,
          ),
        }));
        return id;
      },
      update: (sessionId, messageId, patch) =>
        set((s) => ({
          sessions: s.sessions.map((c) =>
            c.id === sessionId
              ? { ...c, updatedAt: Date.now(), messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) }
              : c,
          ),
        })),
      truncateAfter: (sessionId, messageId) =>
        set((s) => ({
          sessions: s.sessions.map((c) => {
            if (c.id !== sessionId) return c;
            const idx = c.messages.findIndex((m) => m.id === messageId);
            return idx < 0 ? c : { ...c, messages: c.messages.slice(0, idx + 1) };
          }),
        })),
      clear: () => set({ sessions: [], activeId: undefined }),
    }),
    {
      name: 'gooners-ai:chats',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ sessions: s.sessions, activeId: s.activeId }),
    },
  ),
);

export const activeSession = (): ChatSession | undefined => {
  const { sessions, activeId } = useChats.getState();
  return sessions.find((c) => c.id === activeId);
};
