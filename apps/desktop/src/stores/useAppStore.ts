import { create } from 'zustand';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  Project,
  Session,
  Message,
  ReferenceDir,
  ClaudeEvent,
  DisplayBlock,
  Checkpoint,
} from '../types';
import * as api from '../lib/api';

// ---------- helpers ----------

export interface DisplayMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  blocks: DisplayBlock[];
  model: string | null;
  cost: number | null;
  duration_ms: number | null;
  created_at: string;
}

function parseContentBlocks(content: string): DisplayBlock[] {
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [{ type: 'text', content }];
    return parsed.map((block: any): DisplayBlock => {
      switch (block.type) {
        case 'thinking':
          return {
            type: 'thinking',
            content: block.thinking ?? block.content ?? '',
            chars: (block.thinking ?? block.content ?? '').length,
          };
        case 'tool_use':
          // Handle both DisplayBlock format (tool, path) and Claude format (name, input)
          if (block.tool) {
            // Already in DisplayBlock format (loaded from DB)
            return block as DisplayBlock;
          }
          return {
            type: 'tool_use',
            tool: block.name ?? 'unknown',
            path:
              block.input?.file_path ??
              block.input?.path ??
              block.input?.filePath,
            command: block.input?.command,
          };
        case 'text':
          return { type: 'text', content: block.text ?? block.content ?? '' };
        default:
          return { type: 'text', content: JSON.stringify(block) };
      }
    });
  } catch {
    // Not JSON – plain text
    return content.length > 0 ? [{ type: 'text', content }] : [];
  }
}

function toDisplayMessage(msg: Message): DisplayMessage {
  const blocks =
    msg.role === 'assistant' ? parseContentBlocks(msg.content) : [];
  return { ...msg, blocks };
}

// ---------- store ----------

interface AppState {
  // data
  projects: Project[];
  sessions: Session[];
  references: ReferenceDir[];
  messages: DisplayMessage[];

  // active selections
  activeProjectId: string | null;
  activeSessionId: string | null;

  // streaming
  isStreaming: boolean;
  streamingBlocks: DisplayBlock[];

  // meta
  totalCost: number;
  model: string;

  // context window usage
  contextUsage: { used: number; total: number; percent: number };

  // checkpoints
  checkpoints: Checkpoint[];

  // UI layout (preserved from original)
  leftPanelWidth: number;
  rightPanelWidth: number;
  settingsOpen: boolean;
  rightPanelTab: 'git' | 'files';

  // actions – data
  init: () => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  createProject: (name: string, path: string) => Promise<void>;
  createSession: (name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  addReference: (path: string, label?: string) => Promise<void>;
  removeReference: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  stopStreaming: () => Promise<void>;
  handleClaudeEvent: (event: ClaudeEvent) => void;
  setModel: (model: string) => void;

  // actions – UI layout
  setLeftPanelWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setSettingsOpen: (open: boolean) => void;
  setRightPanelTab: (tab: 'git' | 'files') => void;
}

let _unlisten: UnlistenFn | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  // data
  projects: [],
  sessions: [],
  references: [],
  messages: [],

  // active
  activeProjectId: null,
  activeSessionId: null,

  // streaming
  isStreaming: false,
  streamingBlocks: [],

  // meta
  totalCost: 0,
  model: 'sonnet',

  // context window usage
  contextUsage: { used: 0, total: 0, percent: 0 },

  // checkpoints
  checkpoints: [],

  // UI
  leftPanelWidth: 260,
  rightPanelWidth: 340,
  settingsOpen: false,
  rightPanelTab: 'git',

  // -------- data actions --------

  init: async () => {
    try {
      const projects = await api.listProjects();
      set({ projects });

      // Set up claude-event listener once
      if (!_unlisten) {
        _unlisten = await listen('claude-event', (event) => {
          // event.payload is the ClaudeEvent from Rust (with session_id, event_type/type, data)
          const payload = event.payload as any;
          get().handleClaudeEvent(payload);
        });
      }

      // Auto-select first project if any
      if (projects.length > 0) {
        await get().selectProject(projects[0].id);
      }
    } catch (err) {
      console.error('Failed to init:', err);
    }
  },

  selectProject: async (id: string) => {
    set({
      activeProjectId: id,
      activeSessionId: null,
      sessions: [],
      references: [],
      messages: [],
      streamingBlocks: [],
      isStreaming: false,
    });
    try {
      const [sessions, references] = await Promise.all([
        api.listSessions(id),
        api.listReferences(id),
      ]);
      set({ sessions, references });

      // Try importing CLI sessions for this project
      const activeProject = get().projects.find((p) => p.id === id);
      if (activeProject) {
        try {
          const imported = await api.importCliSessions(activeProject.path, id);
          if (imported.length > 0) {
            set((s) => ({ sessions: [...s.sessions, ...imported] }));
          }
        } catch {
          /* ignore if import fails */
        }
      }

      // Auto-select first session if any
      const allSessions = get().sessions;
      if (allSessions.length > 0) {
        await get().selectSession(allSessions[0].id);
      }
    } catch (err) {
      console.error('Failed to load project data:', err);
    }
  },

  selectSession: async (id: string) => {
    set({
      activeSessionId: id,
      messages: [],
      streamingBlocks: [],
      isStreaming: false,
      checkpoints: [],
    });
    try {
      const [rawMessages, checkpoints, contextStr] = await Promise.all([
        api.getMessages(id),
        api.getCheckpoints(id),
        api.getSetting(`context_${id}`).catch(() => null),
      ]);
      const messages = rawMessages.map(toDisplayMessage);

      // Restore context usage
      let contextUsage = { used: 0, total: 0, percent: 0 };
      if (contextStr) {
        try { contextUsage = JSON.parse(contextStr); } catch { /* ignore */ }
      }

      // Compute total cost from session data
      const { sessions } = get();
      const session = sessions.find((s) => s.id === id);
      set({
        messages,
        checkpoints,
        contextUsage,
        totalCost: session?.total_cost ?? 0,
        model: session?.model ?? 'sonnet',
      });

      // Check if there's an active Claude process for this session
      try {
        const streaming = await api.isSessionStreaming(id);
        if (streaming) {
          // Get accumulated blocks from the buffer
          const buffer = await api.getStreamingBuffer(id);
          // Parse buffer into DisplayBlocks
          const blocks: DisplayBlock[] = buffer.flatMap((contentArray: any) => {
            if (!Array.isArray(contentArray)) return [];
            return contentArray.map((block: any): DisplayBlock => {
              if (block.type === 'thinking') {
                return {
                  type: 'thinking',
                  content: block.thinking ?? block.content ?? '',
                  chars: (block.thinking ?? block.content ?? '').length,
                };
              }
              if (block.type === 'tool_use') {
                const input = block.input ?? {};
                return {
                  type: 'tool_use',
                  tool: block.name ?? 'unknown',
                  path: input.file_path ?? input.path ?? input.filePath,
                  command: input.command,
                };
              }
              if (block.type === 'text') {
                return { type: 'text', content: block.text ?? block.content ?? '' };
              }
              return { type: 'text', content: JSON.stringify(block) };
            });
          });
          set({ isStreaming: true, streamingBlocks: blocks });
        }
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  },

  createProject: async (name: string, path: string) => {
    try {
      const project = await api.createProject(name, path);
      set((s) => ({ projects: [...s.projects, project] }));
      await get().selectProject(project.id);
      // Auto-create first session so user can start chatting immediately
      await get().createSession('session 1');
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  },

  createSession: async (name: string) => {
    const { activeProjectId } = get();
    if (!activeProjectId) return;
    try {
      const session = await api.createSession(activeProjectId, name);
      set((s) => ({ sessions: [...s.sessions, session] }));
      await get().selectSession(session.id);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  },

  deleteProject: async (id: string) => {
    try {
      await api.deleteProject(id);
      const { activeProjectId } = get();
      set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
      if (activeProjectId === id) {
        const remaining = get().projects;
        if (remaining.length > 0) {
          await get().selectProject(remaining[0].id);
        } else {
          set({
            activeProjectId: null,
            activeSessionId: null,
            sessions: [],
            references: [],
            messages: [],
          });
        }
      }
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  },

  deleteSession: async (id: string) => {
    try {
      await api.deleteSession(id);
      const { activeSessionId } = get();
      set((s) => ({ sessions: s.sessions.filter((sess) => sess.id !== id) }));
      if (activeSessionId === id) {
        const remaining = get().sessions;
        if (remaining.length > 0) {
          await get().selectSession(remaining[0].id);
        } else {
          set({ activeSessionId: null, messages: [] });
        }
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  },

  addReference: async (path: string, label?: string) => {
    const { activeProjectId } = get();
    if (!activeProjectId) return;
    try {
      const ref = await api.addReference(activeProjectId, path, label);
      set((s) => ({ references: [...s.references, ref] }));
    } catch (err) {
      console.error('Failed to add reference:', err);
    }
  },

  removeReference: async (id: string) => {
    try {
      await api.removeReference(id);
      set((s) => ({ references: s.references.filter((r) => r.id !== id) }));
    } catch (err) {
      console.error('Failed to remove reference:', err);
    }
  },

  sendMessage: async (content: string) => {
    const { activeSessionId, activeProjectId, model, projects } = get();
    if (!activeSessionId || !content.trim()) return;
    try {
      // Save user message to DB
      const saved = await api.saveMessage(activeSessionId, 'user', content);
      const displayMsg = toDisplayMessage(saved);
      set((s) => ({
        messages: [...s.messages, displayMsg],
        isStreaming: true,
        streamingBlocks: [],
      }));

      // Create checkpoint before sending to Claude
      const project = projects.find((p) => p.id === activeProjectId);
      if (project) {
        try {
          const snapshot = await api.getGitSnapshot(project.path);
          const checkpoint = await api.saveCheckpoint(
            activeSessionId,
            saved.id,
            snapshot.commit_hash || null,
            snapshot.diff_summary || null,
            project.path,
          );
          set((s) => ({ checkpoints: [...s.checkpoints, checkpoint] }));
        } catch (cpErr) {
          console.error('Failed to create checkpoint:', cpErr);
        }
      }

      // Send to Claude
      await api.sendChatMessage(activeSessionId, content, model);
    } catch (err) {
      console.error('Failed to send message:', err);
      set({ isStreaming: false });
    }
  },

  stopStreaming: async () => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    try {
      await api.stopChat(activeSessionId);
      set({ isStreaming: false });
    } catch (err) {
      console.error('Failed to stop chat:', err);
    }
  },

  handleClaudeEvent: (rawEvent: ClaudeEvent) => {
    // Rust emits: { session_id, type, data }
    // We need to handle the actual structure from claude.rs
    const evt = rawEvent as any;
    const eventType: string = evt.event_type ?? evt.type ?? '';
    const data = evt.data ?? {};

    switch (eventType) {
      case 'system_init':
        // Store claude_session_id from data.session_id if needed
        break;

      case 'assistant': {
        // data.content is an array of Claude content blocks
        const content = data.content ?? [];
        if (!Array.isArray(content)) break;

        const newBlocks: DisplayBlock[] = content.map((block: any): DisplayBlock => {
          if (block.type === 'thinking') {
            return {
              type: 'thinking',
              content: block.thinking ?? block.content ?? '',
              chars: (block.thinking ?? block.content ?? '').length,
            };
          }
          if (block.type === 'tool_use') {
            const input = block.input ?? {};
            return {
              type: 'tool_use',
              tool: block.name ?? 'unknown',
              path: input.file_path ?? input.path ?? input.filePath,
              command: input.command,
            };
          }
          if (block.type === 'text') {
            return { type: 'text', content: block.text ?? block.content ?? '' };
          }
          return { type: 'text', content: JSON.stringify(block) };
        });

        // Accumulate blocks (each assistant event may add more)
        set((s) => ({ streamingBlocks: [...s.streamingBlocks, ...newBlocks] }));
        break;
      }

      case 'result': {
        // data has total_cost_usd, duration_ms, result, modelUsage, etc.
        const cost = data.total_cost_usd ?? 0;
        const duration = data.duration_ms ?? 0;

        // Extract context window usage from modelUsage
        if (data.modelUsage && typeof data.modelUsage === 'object') {
          const models = Object.values(data.modelUsage) as any[];
          if (models.length > 0) {
            const m = models[0];
            const total = m.contextWindow ?? 0;
            const used =
              (m.inputTokens ?? 0) +
              (m.outputTokens ?? 0) +
              (m.cacheCreationInputTokens ?? 0) +
              (m.cacheReadInputTokens ?? 0);
            const percent = total > 0 ? Math.round((used / total) * 100) : 0;
            set({ contextUsage: { used, total, percent } });
            // Persist to DB for session restore
            const { activeSessionId: sid } = get();
            if (sid) {
              api.setSetting(`context_${sid}`, JSON.stringify({ used, total, percent })).catch(() => {});
            }
          }
        }

        const { streamingBlocks, activeSessionId } = get();
        if (activeSessionId && streamingBlocks.length > 0) {
          const assistantMsg: DisplayMessage = {
            id: crypto.randomUUID(),
            session_id: activeSessionId,
            role: 'assistant',
            content: '',
            blocks: streamingBlocks,
            model: get().model,
            cost,
            duration_ms: duration,
            created_at: new Date().toISOString(),
          };

          // Also save to DB
          api.saveMessage(
            activeSessionId,
            'assistant',
            JSON.stringify(streamingBlocks),
            get().model,
            cost,
            duration,
          ).catch(console.error);

          set((s) => ({
            messages: [...s.messages, assistantMsg],
            streamingBlocks: [],
            totalCost: s.totalCost + cost,
            isStreaming: false,
          }));
        } else {
          set({ isStreaming: false, streamingBlocks: [] });
        }
        break;
      }

      default:
        // 'done', 'error', 'rate_limit_event', etc.
        if (eventType === 'error') {
          console.error('Claude error:', data);
        }
        // Don't set isStreaming false here — 'result' already does it
        break;
    }
  },

  setModel: (model: string) => set({ model }),

  // -------- UI layout actions --------

  setLeftPanelWidth: (width) => set({ leftPanelWidth: width }),
  setRightPanelWidth: (width) => set({ rightPanelWidth: width }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
}));
