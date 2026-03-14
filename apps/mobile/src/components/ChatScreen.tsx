import { useState, useCallback, useEffect, useRef } from 'react';
import type { WebSocketMessage } from '../hooks/useWebSocket';

interface Project {
  id: string;
  name: string;
  path?: string;
}

interface Session {
  id: string;
  name?: string;
  model?: string;
  created_at?: string;
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  thinking?: string;
}

interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
  model?: string;
  timestamp?: string;
  duration_ms?: number;
  cost?: number;
}

interface ChatScreenProps {
  connected: boolean;
  send: (data: Record<string, unknown>) => void;
  lastMessage: WebSocketMessage | null;
  onDisconnect: () => void;
}

export default function ChatScreen({ connected, send, lastMessage, onDisconnect }: ChatScreenProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Request projects on connect
  useEffect(() => {
    if (connected) {
      send({ action: 'list_projects' });
    }
  }, [connected, send]);

  // Handle incoming messages
  useEffect(() => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case 'projects':
        setProjects(lastMessage.data as Project[]);
        break;

      case 'sessions':
        setSessions(lastMessage.data as Session[]);
        break;

      case 'messages':
        setMessages(lastMessage.data as Message[]);
        setStreaming(false);
        break;

      case 'claude_event': {
        const evt = lastMessage.data as Record<string, unknown>;
        const eventType = evt.event_type as string;

        if (eventType === 'message_start' || eventType === 'content_block_start') {
          setStreaming(true);
        } else if (eventType === 'message_stop' || eventType === 'message_complete') {
          setStreaming(false);
          // Refresh messages when done
          if (activeSession) {
            send({ action: 'get_messages', session_id: activeSession.id });
          }
        }
        break;
      }

      case 'error':
        console.error('Server error:', lastMessage.message);
        break;
    }
  }, [lastMessage, activeSession, send]);

  // Auto-scroll on new messages or streaming
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const selectProject = useCallback((project: Project) => {
    setActiveProject(project);
    setActiveSession(null);
    setMessages([]);
    setSessions([]);
    send({ action: 'list_sessions', project_id: project.id });
  }, [send]);

  const selectSession = useCallback((session: Session) => {
    setActiveSession(session);
    setMessages([]);
    send({ action: 'get_messages', session_id: session.id });
    setDrawerOpen(false);
  }, [send]);

  const handleSend = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !activeSession) return;

    send({
      action: 'send_message',
      session_id: activeSession.id,
      message: input.trim(),
      model: 'sonnet',
    });

    // Optimistically add the user message
    setMessages(prev => [...prev, {
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    }]);

    setInput('');
    setStreaming(true);
  }, [input, activeSession, send]);

  const handleStop = useCallback(() => {
    if (activeSession) {
      send({ action: 'stop', session_id: activeSession.id });
      setStreaming(false);
    }
  }, [activeSession, send]);

  const formatTime = (ts?: string) => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const renderContent = (content: string | ContentBlock[]) => {
    if (typeof content === 'string') {
      return <div className="message-content">{content}</div>;
    }

    return content.map((block, i) => {
      switch (block.type) {
        case 'thinking':
          return <ThinkingBlock key={i} text={block.thinking || ''} />;

        case 'tool_use':
          return (
            <div key={i} className="tool-block">
              <span className="tool-icon">&triangleright;</span>
              <span className="tool-name">{block.name}</span>
              {block.input && 'path' in block.input && (
                <span className="tool-path">{String(block.input.path)}</span>
              )}
            </div>
          );

        case 'text':
          return (
            <div key={i} className="message-content">{block.text}</div>
          );

        default:
          return null;
      }
    });
  };

  const statusClass = streaming ? 'streaming' : connected ? 'connected' : 'disconnected';

  return (
    <div className="chat-screen">
      {/* Drawer overlay */}
      <div
        className={`drawer-overlay ${drawerOpen ? 'open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />

      {/* Drawer */}
      <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-title">&gt; codebook remote</div>
          <div className="drawer-status">
            {connected ? 'connected' : 'disconnected'}
          </div>
        </div>

        <div className="drawer-list">
          <div className="drawer-section">
            <div className="drawer-section-title">projects</div>
          </div>
          {projects.map(p => (
            <button
              key={p.id}
              className={`drawer-item ${activeProject?.id === p.id ? 'active' : ''}`}
              onClick={() => selectProject(p)}
            >
              <span className="drawer-item-icon">/</span>
              <span className="drawer-item-text">{p.name}</span>
            </button>
          ))}

          {activeProject && sessions.length > 0 && (
            <>
              <div className="drawer-section">
                <div className="drawer-section-title">sessions</div>
              </div>
              {sessions.map(s => (
                <button
                  key={s.id}
                  className={`drawer-item ${activeSession?.id === s.id ? 'active' : ''}`}
                  onClick={() => selectSession(s)}
                >
                  <span className="drawer-item-icon">&gt;</span>
                  <span className="drawer-item-text">
                    {s.name || s.id.slice(0, 8)}
                  </span>
                </button>
              ))}
              <div style={{ padding: '8px 16px' }}>
                <button className="new-session-btn">
                  + new session
                </button>
              </div>
            </>
          )}
        </div>

        <div className="drawer-footer">
          <button className="disconnect-btn" onClick={onDisconnect}>
            disconnect
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="chat-header">
        <button className="hamburger-btn" onClick={() => setDrawerOpen(true)}>
          &#8801;
        </button>
        <div className="header-info">
          <div className="header-project">
            {activeProject?.name || 'no project selected'}
          </div>
          {activeSession && (
            <div className="header-session">
              &gt; {activeSession.name || activeSession.id.slice(0, 8)}
            </div>
          )}
        </div>
        <div className={`status-dot ${statusClass}`} />
      </div>

      {/* Messages */}
      <div className="messages-area">
        {!activeSession ? (
          <div className="empty-state">
            <div>no session selected</div>
            <div className="hint">tap &#8801; to pick a project and session</div>
          </div>
        ) : messages.length === 0 && !streaming ? (
          <div className="empty-state">
            <div>no messages yet</div>
            <div className="hint">type a message below to start</div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div key={i} className="message">
                <div className="message-header">
                  <span className={`message-role ${msg.role}`}>
                    &gt; {msg.role === 'user' ? 'you' : 'claude'}
                  </span>
                  {msg.model && (
                    <span className="message-model">{msg.model}</span>
                  )}
                  <span className="message-time">{formatTime(msg.timestamp)}</span>
                </div>
                {renderContent(msg.content)}
                {msg.duration_ms != null && msg.cost != null && (
                  <div className="cost-line">
                    {(msg.duration_ms / 1000).toFixed(1)}s &middot; ${msg.cost.toFixed(3)}
                  </div>
                )}
              </div>
            ))}
            {streaming && (
              <div className="streaming-indicator">
                <span className="streaming-dot" />
                <span className="streaming-dot" />
                <span className="streaming-dot" />
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      {activeSession && (
        <form className="input-bar" onSubmit={handleSend}>
          <span className="input-prefix">$</span>
          <input
            className="input-field"
            type="text"
            placeholder="type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
          />
          {streaming ? (
            <button type="button" className="send-btn stop" onClick={handleStop}>
              stop
            </button>
          ) : (
            <button type="submit" className="send-btn" disabled={!input.trim()}>
              send
            </button>
          )}
        </form>
      )}
    </div>
  );
}

/* Collapsible thinking block */
function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="thinking-block">
      <button className="thinking-toggle" onClick={() => setOpen(!open)}>
        <span className={`thinking-arrow ${open ? 'open' : ''}`}>&#9654;</span>
        <span>// thinking</span>
      </button>
      {open && <div className="thinking-content">{text}</div>}
    </div>
  );
}
