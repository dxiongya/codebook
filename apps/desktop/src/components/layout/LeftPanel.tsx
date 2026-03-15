import { useAppStore } from '../../stores/useAppStore';
import { open } from '@tauri-apps/plugin-dialog';

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
  } = useAppStore();

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
      className="flex flex-col h-full"
      style={{ background: '#0A0A0A', borderRight: '1px solid #2a2a2a' }}
    >
      {/* logo — design: padding [16,20], gap 8, height 58px */}
      <div
        className="flex items-center shrink-0"
        style={{ padding: '16px 20px', gap: 8, borderBottom: '1px solid #2a2a2a' }}
      >
        <span style={{ color: '#10B981', fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{'>'}</span>
        <span style={{ color: '#FAFAFA', fontSize: 16, fontWeight: 500, lineHeight: 1.3 }}>codebook</span>
        <span style={{ color: '#6B7280', fontSize: 10, lineHeight: 1 }}>v0.1</span>
      </div>

      {/* search — design: padding [8,16], gap 8, height 33px */}
      <div
        className="flex items-center shrink-0"
        style={{ padding: '8px 16px', gap: 8, height: 33 }}
      >
        <span style={{ color: '#6B7280', fontSize: 13 }}>/</span>
        <span style={{ color: '#4B5563', fontSize: 12 }}>search projects...</span>
      </div>

      {/* projects list — design: padding [8,0], flex-1 */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '8px 0' }}>
        {/* section header — design: padding [6,16], space_between */}
        <div
          className="flex items-center justify-between"
          style={{ padding: '6px 16px' }}
        >
          <span style={{ color: '#6B7280', fontSize: 12 }}>// projects</span>
          <span
            onClick={handleAddProject}
            style={{ color: '#10B981', fontSize: 12, cursor: 'pointer' }}
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
              {/* project row — design: padding [8,16], gap 6 */}
              <button
                onClick={() => selectProject(project.id)}
                className="w-full text-left flex items-center"
                style={{
                  padding: '7px 16px',
                  gap: 6,
                  background: 'transparent',
                  border: 'none',
                  borderLeft: isExpanded ? '2px solid #10B981' : '2px solid transparent',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ color: isExpanded ? '#10B981' : '#6B7280', fontSize: 10 }}>
                  {isExpanded ? '▾' : '▸'}
                </span>
                <span style={{ color: '#FAFAFA', fontSize: 13 }}>{project.name}/</span>
                {isExpanded && activeSessionId && (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', flexShrink: 0 }} />
                )}
                {!isExpanded && (
                  <span style={{ marginLeft: 'auto', color: '#4B5563', fontSize: 10 }}>
                    [{sessions.length}]
                  </span>
                )}
              </button>

              {/* expanded content */}
              {isExpanded && (
                <div style={{ paddingBottom: 4 }}>
                  {/* sessions — indented list */}
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
                            background: isActive ? '#10B981' : '#4B5563',
                            flexShrink: 0,
                          }} />
                          <span style={{
                            color: isActive ? '#10B981' : '#9CA3AF',
                            fontSize: 13, flex: 1,
                          }}>
                            {session.name}
                          </span>
                          <span style={{ color: '#4B5563', fontSize: 11 }}>
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
                      <div style={{ padding: '7px 10px', color: '#4B5563', fontSize: 12 }}>
                        no sessions yet
                      </div>
                    )}
                  </div>

                  {/* new session button */}
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
                    <span style={{ color: '#10B981', fontSize: 13 }}>+</span>
                    <span style={{ color: '#6B7280', fontSize: 12 }}>new session</span>
                  </div>

                  {/* references */}
                  <div style={{ padding: '6px 0 0 0', borderTop: '1px solid #1a1a1a', marginTop: 4 }}>
                    <div
                      className="flex items-center justify-between"
                      style={{ padding: '6px 16px 4px 20px' }}
                    >
                      <span style={{ color: '#4B5563', fontSize: 11 }}>// refs</span>
                      <span
                        onClick={handleAddReference}
                        style={{ color: '#06B6D4', fontSize: 11, cursor: 'pointer' }}
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
                          <span style={{ color: '#06B6D4', fontSize: 11 }}>→</span>
                          <span style={{ color: '#06B6D4', fontSize: 12, flex: 1, opacity: 0.85 }}>
                            {ref.label ?? ref.path.split('/').filter(Boolean).pop() ?? ref.path}/
                          </span>
                          <span
                            onClick={() => removeReference(ref.id)}
                            style={{ color: '#4B5563', fontSize: 13, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#EF4444')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = '#4B5563')}
                            title="remove reference"
                          >
                            ×
                          </span>
                        </div>
                      ))}
                      {references.length === 0 && (
                        <div style={{ padding: '5px 10px', color: '#4B5563', fontSize: 11 }}>
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
          <div style={{ padding: '12px 16px', color: '#4B5563', fontSize: 12 }}>
            no projects — click [+] to add
          </div>
        )}
      </div>

      {/* footer — design: padding [12,16], border-top, gap 8 between rows */}
      <div
        className="shrink-0"
        style={{ borderTop: '1px solid #2a2a2a', padding: '12px 16px' }}
      >
        <div className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', flexShrink: 0 }} />
          <span style={{ color: '#10B981', fontSize: 11 }}>remote: connected</span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ color: '#6B7280', fontSize: 11 }}>$ daxiongya</span>
          <span style={{ color: '#6B7280', fontSize: 11, cursor: 'pointer' }}>[⚙]</span>
        </div>
      </div>
    </div>
  );
}
