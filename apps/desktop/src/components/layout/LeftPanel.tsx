import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { open } from '@tauri-apps/plugin-dialog';
import * as api from '../../lib/api';
import {
  Plus,
  MessageSquare,
  FolderOpen,
  Settings,
  Menu,
} from 'lucide-react';

// Deterministic color for project dot
const PROJECT_COLORS = ['var(--cb-accent)', 'var(--cb-accent-green)', 'var(--cb-accent-blue)', 'var(--cb-accent-purple)', 'var(--cb-accent-red)', 'var(--cb-accent)', 'var(--cb-accent-cyan)'];
function projectColor(index: number) {
  return PROJECT_COLORS[index % PROJECT_COLORS.length];
}

export function LeftPanel() {
  const {
    projects,
    sessions,
    references,
    activeProjectId,
    activeSessionId,
    selectProject,
    selectSession,
    createProject,
    createSession,
    addReference,
    removeReference,
    deleteSession,
    isStreaming,
  } = useAppStore();

  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number;
    type: 'session' | 'project';
    id: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const startRename = (sessionId: string, currentName: string) => {
    setRenamingId(sessionId);
    setRenameValue(currentName);
  };

  const commitRename = async () => {
    if (renamingId && renameValue.trim()) {
      await api.renameSession(renamingId, renameValue.trim());
      useAppStore.setState((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === renamingId ? { ...sess, name: renameValue.trim() } : sess
        ),
      }));
    }
    setRenamingId(null);
    setRenameValue('');
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    projects.forEach(async (p) => {
      try {
        const s = await api.listSessions(p.id);
        setSessionCounts((prev) => ({ ...prev, [p.id]: s.length }));
      } catch { /* ignore */ }
    });
  }, [projects]);

  useEffect(() => {
    if (activeProjectId) {
      setSessionCounts((prev) => ({ ...prev, [activeProjectId]: sessions.length }));
    }
  }, [sessions.length, activeProjectId]);

  const handleAddProject = async () => {
    const selected = await open({ directory: true });
    if (typeof selected === 'string') {
      const name = selected.split('/').filter(Boolean).pop() ?? 'untitled';
      await createProject(name, selected);
    }
  };

  const handleAddReference = async () => {
    const selected = await open({ directory: true });
    if (typeof selected === 'string') {
      const label = selected.split('/').filter(Boolean).pop() ?? undefined;
      await addReference(selected, label);
    }
  };

  const handleNewSession = async () => {
    const name = `session ${sessions.length + 1}`;
    await createSession(name);
  };

  // Draggable divider between projects and sessions
  const [projectsHeight, setProjectsHeight] = useState(200);
  const dividerDragging = useRef(false);
  const dividerStartY = useRef(0);
  const dividerStartH = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dividerDragging.current) return;
      const delta = e.clientY - dividerStartY.current;
      const containerH = containerRef.current?.clientHeight ?? 600;
      const next = Math.min(containerH * 0.6, Math.max(80, dividerStartH.current + delta));
      setProjectsHeight(next);
    };
    const onMouseUp = () => {
      if (dividerDragging.current) {
        dividerDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-no-select
      className="flex flex-col h-full"
      style={{ background: 'var(--cb-bg-sidebar)', borderRight: '1px solid var(--cb-border)' }}
    >
      {/* PROJECTS header (fixed) */}
      <div className="flex items-center justify-between shrink-0" style={{ padding: '10px 16px 4px 16px' }}>
        <span style={{ color: 'var(--cb-accent)', fontSize: 10, fontWeight: 600, letterSpacing: 1, opacity: 0.6 }}>PROJECTS</span>
        <Plus
          size={14}
          style={{ color: 'var(--cb-text-dim)', cursor: 'pointer' }}
          onClick={handleAddProject}
        />
      </div>

      {/* PROJECTS list (scrollable) */}
      <div className="shrink-0 overflow-y-auto" style={{ padding: '0 8px', height: projectsHeight }}>
        <div className="flex flex-col" style={{ gap: 2 }}>
          {projects.map((project, idx) => {
            const isActive = activeProjectId === project.id;
            return (
              <div
                key={project.id}
                onClick={() => selectProject(project.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, type: 'project', id: project.id, name: project.name });
                }}
                className="flex items-center cursor-pointer"
                style={{
                  padding: '8px 10px',
                  gap: 8,
                  borderRadius: 8,
                  background: isActive ? 'var(--cb-bg-elevated)' : 'transparent',
                }}
              >
                <div
                  style={{
                    width: 8, height: 8, borderRadius: 4, flexShrink: 0,
                    background: projectColor(idx),
                  }}
                />
                <span
                  style={{
                    color: isActive ? 'var(--cb-text-primary)' : 'var(--cb-text-muted)',
                    fontSize: 12,
                    fontWeight: isActive ? 500 : 400,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {project.name}
                </span>
                {isActive && (
                  <span style={{ color: 'var(--cb-text-dim)', fontSize: 10 }}>
                    {sessionCounts[project.id] ?? 0}
                  </span>
                )}
              </div>
            );
          })}

          {projects.length === 0 && (
            <div
              onClick={handleAddProject}
              className="flex items-center cursor-pointer"
              style={{ padding: '8px 10px', gap: 6, borderRadius: 8 }}
            >
              <Plus size={14} style={{ color: 'var(--cb-text-dim)' }} />
              <span style={{ color: 'var(--cb-text-dim)', fontSize: 12 }}>Add project</span>
            </div>
          )}
        </div>
      </div>

      {/* Draggable divider */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          dividerDragging.current = true;
          dividerStartY.current = e.clientY;
          dividerStartH.current = projectsHeight;
          document.body.style.cursor = 'row-resize';
          document.body.style.userSelect = 'none';
        }}
        className="shrink-0 cursor-row-resize group"
        style={{ height: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div style={{ width: 40, height: 2, background: 'var(--cb-border)', borderRadius: 2, transition: 'background 0.15s' }}
          className="group-hover:!bg-[#E5A54B]"
        />
      </div>

      {/* Divider between projects and sessions */}
      {activeProjectId && (
        <div className="shrink-0" style={{ padding: '6px 16px', borderBottom: '1px solid var(--cb-border)' }}>
          <span style={{ color: 'var(--cb-accent)', fontSize: 10, fontWeight: 600, letterSpacing: 1, opacity: 0.6 }}>SESSIONS</span>
        </div>
      )}

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '4px 8px' }}>
        {activeProjectId && sessions.map((session) => {
          const isActive = activeSessionId === session.id;
          return (
            <div
              key={session.id}
              onClick={() => selectSession(session.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ x: e.clientX, y: e.clientY, type: 'session', id: session.id, name: session.name });
              }}
              className="flex items-center"
              style={{
                padding: '10px 12px',
                gap: 8,
                borderRadius: 8,
                cursor: 'pointer',
                background: isActive ? 'var(--cb-bg-elevated)' : 'transparent',
                borderLeft: isActive ? '2px solid var(--cb-accent)' : '2px solid transparent',
              }}
            >
              <MessageSquare
                size={14}
                style={{ color: isActive ? 'var(--cb-accent)' : 'var(--cb-text-dim)', flexShrink: 0 }}
              />
              <div className="flex-1 min-w-0">
                {renamingId === session.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                      if (e.key === 'Escape') cancelRename();
                    }}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      color: 'var(--cb-accent)', fontSize: 12, width: '100%',
                      background: 'var(--cb-bg-primary)', border: '1px solid var(--cb-accent)',
                      padding: '1px 4px', outline: 'none', borderRadius: 4,
                    }}
                  />
                ) : (
                  <>
                    <div className="flex items-center" style={{ gap: 6 }}>
                      <div
                        onDoubleClick={(e) => { e.stopPropagation(); startRename(session.id, session.name); }}
                        style={{
                          color: isActive ? 'var(--cb-text-primary)' : 'var(--cb-text-muted)',
                          fontSize: 12,
                          fontWeight: isActive ? 500 : 400,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        {session.name}
                      </div>
                      <span style={{
                        fontSize: 9, fontWeight: 500, flexShrink: 0,
                        padding: '1px 5px', borderRadius: 4,
                        background: 'var(--cb-bg-active)',
                        color: session.cli_type === 'codex' ? 'var(--cb-accent-green)'
                          : session.cli_type === 'gemini' ? 'var(--cb-accent-blue)'
                          : isActive ? 'var(--cb-accent)' : 'var(--cb-text-dim)',
                      }}>
                        {session.cli_type || 'claude'}
                      </span>
                      {isActive && isStreaming && (
                        <div style={{
                          width: 6, height: 6, borderRadius: 3, flexShrink: 0,
                          background: 'var(--cb-accent)', animation: 'pulse 1.5s ease-in-out infinite',
                        }} />
                      )}
                    </div>
                    <div style={{ color: 'var(--cb-text-dim)', fontSize: 10, marginTop: 2 }}>
                      {new Date(session.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {activeProjectId && sessions.length === 0 && (
          <div
            onClick={handleNewSession}
            className="flex items-center cursor-pointer"
            style={{ padding: '10px 12px', gap: 8, borderRadius: 8 }}
          >
            <Plus size={14} style={{ color: 'var(--cb-text-dim)' }} />
            <span style={{ color: 'var(--cb-text-dim)', fontSize: 12 }}>New session</span>
          </div>
        )}

        {activeProjectId && sessions.length > 0 && (
          <div
            onClick={handleNewSession}
            className="flex items-center cursor-pointer"
            style={{ padding: '8px 12px', gap: 6, marginTop: 2 }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cb-bg-elevated)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Plus size={12} style={{ color: 'var(--cb-text-dim)' }} />
            <span style={{ color: 'var(--cb-text-dim)', fontSize: 11 }}>New session</span>
          </div>
        )}
      </div>

      {/* References */}
      {activeProjectId && (
        <div style={{ borderTop: '1px solid var(--cb-border)', padding: '8px 8px 4px 8px' }}>
          <div className="flex items-center justify-between" style={{ padding: '4px 8px' }}>
            <span style={{ color: 'var(--cb-accent)', fontSize: 10, fontWeight: 600, letterSpacing: 1, opacity: 0.6 }}>REFERENCES</span>
            <Plus
              size={12}
              style={{ color: 'var(--cb-text-dim)', cursor: 'pointer' }}
              onClick={handleAddReference}
            />
          </div>
          {references.map((ref) => (
            <div
              key={ref.id}
              className="flex items-center"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', ref.path);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              style={{ padding: '4px 8px', gap: 6, borderRadius: 6, cursor: 'grab' }}
            >
              <FolderOpen size={12} style={{ color: 'var(--cb-accent-blue)', flexShrink: 0 }} />
              <span
                style={{
                  color: 'var(--cb-text-muted)', fontSize: 11, flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
                title={ref.path}
              >
                {ref.label ?? ref.path.split('/').filter(Boolean).pop() ?? ref.path}
              </span>
              <span
                onClick={() => removeReference(ref.id)}
                style={{ color: 'var(--cb-text-dim)', fontSize: 12, cursor: 'pointer', padding: '0 2px' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--cb-accent-red)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--cb-text-dim)')}
              >
                ×
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Bottom bar */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{ borderTop: '1px solid var(--cb-border)', padding: '8px 16px' }}
      >
        <Settings
          size={15}
          style={{ color: 'var(--cb-text-dim)', cursor: 'pointer' }}
          onClick={() => useAppStore.getState().setSettingsOpen(true)}
        />
        <Menu size={15} style={{ color: 'var(--cb-text-dim)', cursor: 'pointer' }} />
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
            background: 'var(--cb-bg-elevated)',
            border: '1px solid var(--cb-border)',
            borderRadius: 8,
            padding: 4,
            minWidth: 160,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'session' && (
            <>
              <div
                onClick={() => { startRename(contextMenu.id, contextMenu.name); setContextMenu(null); }}
                style={{ padding: '6px 12px', fontSize: 12, color: 'var(--cb-text-primary)', cursor: 'pointer', borderRadius: 6 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cb-accent)', e.currentTarget.style.color = 'var(--cb-bg-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = 'var(--cb-text-primary)')}
              >
                Rename
              </div>
              <div
                onClick={() => { deleteSession(contextMenu.id); setContextMenu(null); }}
                style={{ padding: '6px 12px', fontSize: 12, color: 'var(--cb-text-primary)', cursor: 'pointer', borderRadius: 6 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cb-accent-red)', e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = 'var(--cb-text-primary)')}
              >
                Delete
              </div>
            </>
          )}
          {contextMenu.type === 'project' && (
            <>
              <div
                onClick={() => {
                  const p = projects.find((pr) => pr.id === contextMenu.id);
                  if (p) { import('@tauri-apps/plugin-opener').then((m) => m.revealItemInDir(p.path)); }
                  setContextMenu(null);
                }}
                style={{ padding: '6px 12px', fontSize: 12, color: 'var(--cb-text-primary)', cursor: 'pointer', borderRadius: 6 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cb-accent)', e.currentTarget.style.color = 'var(--cb-bg-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = 'var(--cb-text-primary)')}
              >
                Open in Finder
              </div>
              <div
                onClick={async () => {
                  const p = projects.find((pr) => pr.id === contextMenu.id);
                  if (p) {
                    const terminal = await api.getSetting('preferred_terminal').catch(() => null);
                    import('@tauri-apps/api/core').then((m) => m.invoke('open_in_terminal', { path: p.path, terminal })).catch(() => {});
                  }
                  setContextMenu(null);
                }}
                style={{ padding: '6px 12px', fontSize: 12, color: 'var(--cb-text-primary)', cursor: 'pointer', borderRadius: 6 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cb-accent)', e.currentTarget.style.color = 'var(--cb-bg-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = 'var(--cb-text-primary)')}
              >
                Open in Terminal
              </div>
              <div
                onClick={() => { useAppStore.getState().setRightPanelTab('config'); setContextMenu(null); }}
                style={{ padding: '6px 12px', fontSize: 12, color: 'var(--cb-text-primary)', cursor: 'pointer', borderRadius: 6 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cb-accent)', e.currentTarget.style.color = 'var(--cb-bg-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = 'var(--cb-text-primary)')}
              >
                Config
              </div>
              <div style={{ height: 1, background: 'var(--cb-border)', margin: '3px 8px' }} />
              <div
                onClick={() => { useAppStore.getState().deleteProject(contextMenu.id); setContextMenu(null); }}
                style={{ padding: '6px 12px', fontSize: 12, color: 'var(--cb-text-primary)', cursor: 'pointer', borderRadius: 6 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cb-accent-red)', e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = 'var(--cb-text-primary)')}
              >
                Remove from Codebook
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
