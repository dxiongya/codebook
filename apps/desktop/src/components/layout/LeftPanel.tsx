import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as api from '../../lib/api';

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

  // Close context menu on any click
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
      // Update local state
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

  // Cache session counts per project (so collapsed projects show correct count)
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    // Load counts for all projects
    projects.forEach(async (p) => {
      try {
        const s = await api.listSessions(p.id);
        setSessionCounts((prev) => ({ ...prev, [p.id]: s.length }));
      } catch { /* ignore */ }
    });
  }, [projects]);

  // Update cache when sessions change for the active project
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

  const formatTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  };

  return (
    <div
      data-no-select
      className="flex flex-col h-full"
      style={{ background: '#0A0A0A', borderRight: '1px solid #2a2a2a' }}
    >
      {/* window controls + logo — single row */}
      <div
        className="flex items-center shrink-0"
        onMouseDown={(e) => {
          const tag = (e.target as HTMLElement).tagName.toLowerCase();
          if (tag === 'div') getCurrentWindow().startDragging();
        }}
        style={{ height: 42, padding: '0 16px', gap: 10, borderBottom: '1px solid #2a2a2a' }}
      >
        {/* traffic lights */}
        <div className="flex items-center" style={{ gap: 6, flexShrink: 0 }}>
          <span onClick={() => getCurrentWindow().close()} style={{ width: 11, height: 11, borderRadius: '50%', background: '#FF5F57', cursor: 'pointer' }} />
          <span onClick={() => getCurrentWindow().minimize()} style={{ width: 11, height: 11, borderRadius: '50%', background: '#FEBC2E', cursor: 'pointer' }} />
          <span onClick={() => getCurrentWindow().toggleMaximize()} style={{ width: 11, height: 11, borderRadius: '50%', background: '#28C840', cursor: 'pointer' }} />
        </div>
        {/* logo */}
        <span style={{ color: '#10B981', fontSize: 16, fontWeight: 700, lineHeight: 1 }}>{'>'}</span>
        <span style={{ color: '#FAFAFA', fontSize: 14, fontWeight: 500, lineHeight: 1 }}>codebook</span>
        <span style={{ color: '#6B7280', fontSize: 10, lineHeight: 1 }}>v0.1</span>
      </div>

      {/* search */}
      <div
        className="flex items-center shrink-0"
        style={{ padding: '8px 16px', gap: 8, height: 33 }}
      >
        <span style={{ color: '#6B7280', fontSize: 14 }}>/</span>
        <span style={{ color: '#4B5563', fontSize: 13 }}>search projects...</span>
      </div>

      {/* projects list */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '8px 0' }}>
        <div
          className="flex items-center justify-between"
          style={{ padding: '6px 16px' }}
        >
          <span style={{ color: '#6B7280', fontSize: 12 }}>// projects</span>
          <span
            onClick={handleAddProject}
            style={{ color: '#10B981', fontSize: 13, cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
          >
            [+]
          </span>
        </div>

        {projects.map((project) => {
          const isExpanded = activeProjectId === project.id;

          return (
            <div key={project.id}>
              <button
                onClick={() => {
                  if (isExpanded) {
                    useAppStore.setState({
                      activeProjectId: null,
                      activeSessionId: null,
                      sessions: [],
                      references: [],
                      messages: [],
                      checkpoints: [],
                    });
                  } else {
                    selectProject(project.id);
                  }
                }}
                className="w-full text-left flex items-center"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, type: 'project', id: project.id, name: project.name });
                }}
                style={{
                  padding: '8px 16px',
                  gap: 8,
                  background: 'transparent',
                  border: 'none',
                  borderLeft: isExpanded ? '2px solid #10B981' : '2px solid transparent',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ color: isExpanded ? '#10B981' : '#6B7280', fontSize: 14 }}>
                  {isExpanded ? '▾' : '▸'}
                </span>
                <span style={{ color: '#FAFAFA', fontSize: 14, flex: 1 }}>{project.name}/</span>
                {isExpanded && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      useAppStore.getState().setRightPanelTab('config');
                    }}
                    style={{ color: '#4B5563', fontSize: 14, cursor: 'pointer', padding: '0 4px' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#FAFAFA')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#4B5563')}
                    title="project config"
                  >
                    ⚙
                  </span>
                )}
                {!isExpanded && (
                  <span style={{ color: '#4B5563', fontSize: 12 }}>
                    [{sessionCounts[project.id] ?? 0}]
                  </span>
                )}
              </button>

              {isExpanded && (
                <div style={{ paddingBottom: 4 }}>
                  {/* sessions */}
                  <div style={{ padding: '4px 0 0 20px' }}>
                    {sessions.map((session) => {
                      const isActive = activeSessionId === session.id;
                      return (
                        <div
                          key={session.id}
                          className="flex items-center"
                          onClick={() => selectSession(session.id)}
                          style={{
                            padding: '7px 10px',
                            gap: 8,
                            cursor: 'pointer',
                            borderLeft: isActive ? '2px solid #10B981' : '2px solid transparent',
                            marginLeft: -2,
                          }}
                        >
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: isActive && isStreaming ? '#F59E0B' : isActive ? '#10B981' : '#4B5563',
                            flexShrink: 0,
                            animation: isActive && isStreaming ? 'pulse 1.5s ease-in-out infinite' : 'none',
                          }} />
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
                                color: '#10B981', fontSize: 13, flex: 1,
                                background: '#0A0A0A', border: '1px solid #10B981',
                                padding: '1px 4px', outline: 'none', fontFamily: 'inherit',
                              }}
                            />
                          ) : (
                            <span
                              onDoubleClick={(e) => { e.stopPropagation(); startRename(session.id, session.name); }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setContextMenu({ x: e.clientX, y: e.clientY, type: 'session', id: session.id, name: session.name });
                              }}
                              style={{
                                color: isActive ? '#10B981' : '#9CA3AF',
                                fontSize: 13, flex: 1,
                              }}
                            >
                              {session.name}
                            </span>
                          )}
                          <span style={{ color: '#4B5563', fontSize: 12 }}>
                            {formatTime(session.updated_at)}
                          </span>
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSession(session.id);
                            }}
                            style={{
                              color: '#4B5563', fontSize: 14, cursor: 'pointer',
                              padding: '0 4px', lineHeight: 1,
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#EF4444')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = '#4B5563')}
                            title="delete session"
                          >
                            ×
                          </span>
                        </div>
                      );
                    })}
                    {sessions.length === 0 && (
                      <div style={{ padding: '7px 10px', color: '#4B5563', fontSize: 13 }}>
                        no sessions yet
                      </div>
                    )}
                  </div>

                  {/* new session */}
                  <div
                    onClick={handleNewSession}
                    className="flex items-center"
                    style={{
                      padding: '8px 10px 8px 20px', cursor: 'pointer', gap: 6,
                      borderTop: '1px solid #1a1a1a', marginTop: 2,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a1a')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ color: '#10B981', fontSize: 14 }}>+</span>
                    <span style={{ color: '#6B7280', fontSize: 13 }}>new session</span>
                  </div>

                  {/* references */}
                  <div style={{ padding: '6px 0 0 0', borderTop: '1px solid #1a1a1a', marginTop: 4 }}>
                    <div
                      className="flex items-center justify-between"
                      style={{ padding: '6px 16px 4px 20px' }}
                    >
                      <span style={{ color: '#4B5563', fontSize: 12 }}>// refs</span>
                      <span
                        onClick={handleAddReference}
                        style={{ color: '#06B6D4', fontSize: 13, cursor: 'pointer' }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
                      >
                        [+]
                      </span>
                    </div>
                    <div style={{ paddingLeft: 20 }}>
                      {references.map((ref) => (
                        <div
                          key={ref.id}
                          className="flex items-center"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', ref.path);
                            e.dataTransfer.effectAllowed = 'copy';
                          }}
                          style={{ padding: '5px 10px', gap: 6, cursor: 'grab' }}
                        >
                          <span style={{ color: '#06B6D4', fontSize: 13 }}>→</span>
                          <span style={{ color: '#06B6D4', fontSize: 13, flex: 1, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={ref.path}
                          >
                            {ref.label ?? ref.path.split('/').filter(Boolean).pop() ?? ref.path}/
                          </span>
                          <span
                            onClick={() => removeReference(ref.id)}
                            style={{ color: '#4B5563', fontSize: 14, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#EF4444')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = '#4B5563')}
                            title="remove reference"
                          >
                            ×
                          </span>
                        </div>
                      ))}
                      {references.length === 0 && (
                        <div style={{ padding: '5px 10px', color: '#4B5563', fontSize: 12 }}>
                          no refs
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              )}
            </div>
          );
        })}

        {projects.length === 0 && (
          <div style={{ padding: '12px 16px', color: '#4B5563', fontSize: 13 }}>
            no projects — click [+] to add
          </div>
        )}
      </div>

      {/* footer */}
      <div
        className="shrink-0"
        style={{ borderTop: '1px solid #2a2a2a', padding: '12px 16px' }}
      >
        <div className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', flexShrink: 0 }} />
          <span style={{ color: '#10B981', fontSize: 12 }}>remote: connected</span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ color: '#6B7280', fontSize: 12 }}>$ daxiongya</span>
          <span
            onClick={() => useAppStore.getState().setSettingsOpen(true)}
            style={{ color: '#6B7280', fontSize: 14, cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#FAFAFA')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
          >[⚙]</span>
        </div>
      </div>

      {/* context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
            background: '#161616',
            border: '1px solid #333',
            borderRadius: 6,
            padding: '4px',
            minWidth: 160,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(8px)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'session' && (
            <>
              <div
                onClick={() => { startRename(contextMenu.id, contextMenu.name); setContextMenu(null); }}
                style={{ padding: '5px 12px', fontSize: 12, color: '#e0e0e0', cursor: 'pointer', borderRadius: 4 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#10B981', e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = '#e0e0e0')}
              >
                rename
              </div>
              <div
                onClick={() => { deleteSession(contextMenu.id); setContextMenu(null); }}
                style={{ padding: '5px 12px', fontSize: 12, color: '#e0e0e0', cursor: 'pointer', borderRadius: 4 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#EF4444', e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = '#e0e0e0')}
              >
                delete
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
                style={{ padding: '5px 12px', fontSize: 12, color: '#e0e0e0', cursor: 'pointer', borderRadius: 4 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#10B981', e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = '#e0e0e0')}
              >
                open in finder
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
                style={{ padding: '5px 12px', fontSize: 12, color: '#e0e0e0', cursor: 'pointer', borderRadius: 4 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#10B981', e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = '#e0e0e0')}
              >
                open in terminal
              </div>
              <div
                onClick={() => { useAppStore.getState().setRightPanelTab('config'); setContextMenu(null); }}
                style={{ padding: '5px 12px', fontSize: 12, color: '#e0e0e0', cursor: 'pointer', borderRadius: 4 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#10B981', e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = '#e0e0e0')}
              >
                config
              </div>
              <div style={{ height: 1, background: '#2a2a2a', margin: '3px 8px' }} />
              <div
                onClick={() => { useAppStore.getState().deleteProject(contextMenu.id); setContextMenu(null); }}
                style={{ padding: '5px 12px', fontSize: 12, color: '#e0e0e0', cursor: 'pointer', borderRadius: 4 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#EF4444', e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = '#e0e0e0')}
              >
                remove from codebook
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
