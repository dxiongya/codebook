import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore, type DisplayMessage } from '../../stores/useAppStore';
import type { DisplayBlock, DisplayThinkingBlock, DisplayToolBlock, DisplayTextBlock, Checkpoint } from '../../types';
import * as api from '../../lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Sparkles, Brain, Terminal, Pencil, Eye, Search, ChevronDown, History, CirclePlus, Image, Send, Plug, Wrench } from 'lucide-react';

/* ── sub-components ────────────────────────────────────────── */

const ICON_SIZE = 13;

function StreamTimer() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <span style={{ color: 'var(--cb-text-dim)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
      {m > 0 ? `${m}m ${s}s` : `${s}s`}
    </span>
  );
}
const ICON_STYLE = { flexShrink: 0 } as const;

// Color per tool type — icon and name share the same color
function toolColor(tool: string): string {
  const t = tool.toLowerCase();
  if (t === 'edit' || t === 'write') return '#D4915E';     // warm orange
  if (t === 'bash') return '#5B9FD4';                       // ocean blue
  if (t === 'read') return '#6DA88C';                       // sage green
  if (t === 'glob' || t === 'grep') return '#6DA88C';       // sage green
  if (t.startsWith('mcp_') || t.startsWith('mcp__')) return '#9B8EC4'; // lavender
  if (t === 'agent') return '#C47A9B';                      // rose
  if (t === 'toolsearch' || t === 'todowrite' || t === 'todoread') return '#C47A9B'; // rose
  return '#8A9AA5';                                         // slate
}

function ToolIcon({ tool }: { tool: string }) {
  const color = toolColor(tool);
  const t = tool.toLowerCase();
  if (t === 'edit' || t === 'write') return <Pencil size={ICON_SIZE} style={{ ...ICON_STYLE, color }} />;
  if (t === 'bash') return <Terminal size={ICON_SIZE} style={{ ...ICON_STYLE, color }} />;
  if (t === 'read') return <Eye size={ICON_SIZE} style={{ ...ICON_STYLE, color }} />;
  if (t === 'glob' || t === 'grep') return <Search size={ICON_SIZE} style={{ ...ICON_STYLE, color }} />;
  if (t.startsWith('mcp_') || t.startsWith('mcp__')) return <Plug size={ICON_SIZE} style={{ ...ICON_STYLE, color }} />;
  return <Wrench size={ICON_SIZE} style={{ ...ICON_STYLE, color }} />;
}

function toolDisplayName(tool: string): string {
  const t = tool.toLowerCase();
  if (t === 'edit' || t === 'write') return 'Apply Patch';
  if (t === 'bash') return 'Shell Command';
  if (t === 'read') return 'Read File';
  if (t === 'glob' || t === 'grep') return 'Search';
  // MCP tools: show server + method
  if (t.startsWith('mcp__')) {
    const parts = tool.replace(/^mcp__/, '').split('__');
    if (parts.length >= 2) return `${parts[0]}:${parts.slice(1).join('.')}`;
    return parts[0];
  }
  if (t.startsWith('mcp_')) {
    return tool.replace(/^mcp_/, '');
  }
  return tool;
}

function ThinkingBlockView({ block }: { block: DisplayThinkingBlock }) {
  const [expanded, setExpanded] = useState(false);
  // Extract first meaningful line as summary
  const summary = block.content.split('\n').find(l => l.trim().length > 0)?.trim().slice(0, 80) || '';

  return (
    <div
      className="flex items-center"
      role="button"
      tabIndex={0}
      onClick={() => setExpanded(!expanded)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
      style={{ cursor: 'pointer', gap: 8, padding: '4px 0', paddingLeft: 0, marginLeft: 0 }}
    >
      {/* timeline dot */}
      <Brain size={ICON_SIZE} style={{ color: 'var(--cb-accent-purple)', flexShrink: 0 }} />
      {/* content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center" style={{ gap: 6, lineHeight: '18px' }}>
          <span style={{ color: 'var(--cb-accent-purple)', fontSize: 11, fontWeight: 400 }}>Thinking</span>
          <span style={{ color: 'var(--cb-text-dim)', fontSize: 11, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {summary ? `**${summary}**` : ''}
          </span>
          <span style={{ color: 'var(--cb-text-dim)', fontSize: 10, flexShrink: 0 }}>
            {block.chars > 1000 ? `${(block.chars / 1000).toFixed(1)}k` : block.chars} chars
          </span>
        </div>
        {expanded && (
          <div style={{
            marginTop: 6,
            padding: '10px 12px',
            background: 'var(--cb-bg-elevated)',
            border: '1px solid var(--cb-border)',
            borderRadius: 6,
            color: 'var(--cb-text-secondary)',
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflowY: 'auto',
          }}>
            {block.content}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolBlockView({ block }: { block: DisplayToolBlock }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = block.input && Object.keys(block.input).length > 0;

  // Build description
  const desc = block.path || block.command || '';
  const diffInfo = block.additions != null
    ? `+${block.additions}${block.deletions ? ` -${block.deletions}` : ''}`
    : '';

  return (
    <div
      className="flex items-center"
      onClick={() => hasDetails && setExpanded(!expanded)}
      style={{ cursor: hasDetails ? 'pointer' : 'default', gap: 8, padding: '4px 0', paddingLeft: 0, marginLeft: 0 }}
    >
      {/* timeline dot */}
      <ToolIcon tool={block.tool} />
      {/* content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center" style={{ gap: 6, lineHeight: '18px' }}>
          <span style={{ color: toolColor(block.tool), fontSize: 11, fontWeight: 400 }}>{toolDisplayName(block.tool)}</span>
          <span style={{ color: 'var(--cb-text-dim)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {desc}
          </span>
          {diffInfo && (
            <span style={{ fontSize: 11, flexShrink: 0 }}>
              <span style={{ color: 'var(--cb-accent-green)' }}>{diffInfo.split(' ')[0]}</span>
              {diffInfo.includes('-') && <span style={{ color: 'var(--cb-accent-red)' }}> {diffInfo.split(' ')[1]}</span>}
            </span>
          )}
        </div>
        {expanded && hasDetails && (
          <div style={{
            marginTop: 6,
            padding: '10px 12px',
            background: 'var(--cb-bg-code)',
            border: '1px solid var(--cb-border)',
            borderRadius: 6,
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--cb-accent-green)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflowY: 'auto',
          }}>
            {JSON.stringify(block.input, null, 2)}
          </div>
        )}
      </div>
    </div>
  );
}

function TextBlockView({ block }: { block: DisplayTextBlock }) {
  return (
    <div
      className="markdown-content"
      style={{ padding: '8px 0' }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          p: ({ children }) => (
            <p style={{ color: 'var(--cb-text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 8 }}>{children}</p>
          ),
          strong: ({ children }) => (
            <strong style={{ color: 'var(--cb-text-primary)', fontWeight: 600 }}>{children}</strong>
          ),
          em: ({ children }) => (
            <em style={{ color: 'var(--cb-text-muted)' }}>{children}</em>
          ),
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code style={{
                  background: 'var(--cb-bg-elevated)',
                  color: 'var(--cb-accent-blue)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                }}>{children}</code>
              );
            }
            return (
              <code className={className} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre style={{
              background: 'var(--cb-bg-code)',
              border: '1px solid var(--cb-border)',
              borderRadius: 6,
              padding: '12px 16px',
              margin: '8px 0',
              overflow: 'auto',
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: "'JetBrains Mono', monospace",
            }}>{children}</pre>
          ),
          ul: ({ children }) => (
            <ul style={{ paddingLeft: 20, margin: '6px 0', color: 'var(--cb-text-muted)', fontSize: 13, lineHeight: 1.6, listStyleType: 'disc' }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ paddingLeft: 20, margin: '6px 0', color: 'var(--cb-text-muted)', fontSize: 13, lineHeight: 1.6, listStyleType: 'decimal' }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ marginBottom: 4, color: 'var(--cb-text-secondary)' }}>{children}</li>
          ),
          h1: ({ children }) => (
            <h1 style={{ color: 'var(--cb-text-primary)', fontSize: 18, fontWeight: 700, marginBottom: 8, marginTop: 16 }}>{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ color: 'var(--cb-text-primary)', fontSize: 16, fontWeight: 700, marginBottom: 6, marginTop: 12 }}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ color: 'var(--cb-text-primary)', fontSize: 14, fontWeight: 600, marginBottom: 4, marginTop: 10 }}>{children}</h3>
          ),
          blockquote: ({ children }) => (
            <blockquote style={{
              borderLeft: '3px solid var(--cb-accent)',
              paddingLeft: 12,
              margin: '8px 0',
              color: 'var(--cb-text-muted)',
            }}>{children}</blockquote>
          ),
          a: ({ children, href }) => (
            <a href={href} style={{ color: 'var(--cb-accent-blue)', textDecoration: 'none' }}>{children}</a>
          ),
          table: ({ children }) => (
            <table style={{ borderCollapse: 'collapse', width: '100%', margin: '8px 0', fontSize: 12 }}>{children}</table>
          ),
          th: ({ children }) => (
            <th style={{ border: '1px solid var(--cb-border)', padding: '6px 10px', textAlign: 'left', color: 'var(--cb-text-primary)', background: 'var(--cb-bg-code)', fontWeight: 600, fontSize: 12 }}>{children}</th>
          ),
          td: ({ children }) => (
            <td style={{ border: '1px solid var(--cb-border)', padding: '6px 10px', color: 'var(--cb-text-primary)', fontSize: 12 }}>{children}</td>
          ),
        }}
      >
        {block.content}
      </ReactMarkdown>
    </div>
  );
}

function BlockRenderer({ block }: { block: DisplayBlock }) {
  switch (block.type) {
    case 'thinking':
      return <ThinkingBlockView block={block} />;
    case 'tool_use':
      return <ToolBlockView block={block} />;
    case 'text':
      return <TextBlockView block={block} />;
  }
}

function ContextProgressBar({ percent }: { percent: number }) {
  const barColor = percent > 80 ? 'var(--cb-accent-red)' : percent > 50 ? 'var(--cb-accent)' : 'var(--cb-accent-green)';
  return (
    <div style={{ width: 60, height: 4, background: 'var(--cb-bg-active)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(percent, 100)}%`, height: '100%', background: barColor, borderRadius: 2, transition: 'width 0.3s' }} />
    </div>
  );
}

function MessageView({ msg, checkpoint }: { msg: DisplayMessage; checkpoint?: Checkpoint }) {
  const [rollbackState, setRollbackState] = useState<'idle' | 'confirm' | 'loading' | 'done' | 'error'>('idle');
  const [rollbackMsg, setRollbackMsg] = useState('');

  const handleRollback = async (_cp: Checkpoint) => {
    if (rollbackState === 'idle') {
      setRollbackState('confirm');
    }
  };

  const confirmRollback = async (cp: Checkpoint) => {
    if (!cp.git_commit_hash) return;
    setRollbackState('loading');
    try {
      await api.rollbackToCheckpoint(cp.project_path, cp.git_commit_hash);
      setRollbackState('done');
      setRollbackMsg(`rolled back to ${cp.git_commit_hash.slice(0, 7)}`);

      // Save a system note to DB so Claude sees it as context in the next --resume
      const { activeSessionId } = useAppStore.getState();
      if (activeSessionId) {
        const note = `[system: code rolled back to ${cp.git_commit_hash.slice(0, 7)}. files reverted. re-read before editing.]`;
        const saved = await api.saveMessage(activeSessionId, 'user', note);
        // Add to local messages display
        useAppStore.setState((s) => ({
          messages: [...s.messages, { ...saved, blocks: [], role: 'user' as const }],
        }));
      }
    } catch (err: any) {
      setRollbackState('error');
      setRollbackMsg(err?.toString() ?? 'rollback failed');
    }
    setTimeout(() => { setRollbackState('idle'); setRollbackMsg(''); }, 4000);
  };

  const cancelRollback = () => {
    setRollbackState('idle');
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const [showDiffSummary, setShowDiffSummary] = useState(false);

  if (msg.role === 'user') {
    const diffLines = checkpoint?.git_diff_summary?.split('\n').filter((l) => l.trim()) ?? [];

    return (
      <div>
        {/* checkpoint row */}
        {checkpoint && checkpoint.git_commit_hash && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6, position: 'relative' }}>
            {rollbackState === 'confirm' ? (
              <div className="flex items-center" style={{ gap: 6 }}>
                <span style={{ color: 'var(--cb-text-muted)', fontSize: 11 }}>rollback to this point?</span>
                <span
                  onClick={() => confirmRollback(checkpoint)}
                  style={{
                    color: 'var(--cb-bg-primary)', background: 'var(--cb-accent)', fontSize: 11, fontWeight: 500,
                    padding: '2px 10px', cursor: 'pointer', borderRadius: 4,
                  }}
                >
                  yes
                </span>
                <span
                  onClick={cancelRollback}
                  style={{
                    color: 'var(--cb-text-muted)', border: '1px solid var(--cb-border)', fontSize: 11,
                    padding: '2px 10px', cursor: 'pointer', borderRadius: 4,
                  }}
                >
                  no
                </span>
              </div>
            ) : rollbackState === 'loading' ? (
              <span style={{ color: 'var(--cb-accent)', fontSize: 11 }}>rolling back...</span>
            ) : rollbackState === 'done' || rollbackState === 'error' ? (
              <span style={{ color: rollbackState === 'done' ? 'var(--cb-accent)' : 'var(--cb-accent-red)', fontSize: 11 }}>{rollbackMsg}</span>
            ) : (
              <div
                className="flex items-center"
                style={{
                  gap: 5, cursor: 'pointer', padding: '2px 8px',
                  background: 'var(--cb-bg-elevated)', borderRadius: 8,
                }}
                onMouseEnter={() => setShowDiffSummary(true)}
                onMouseLeave={() => setShowDiffSummary(false)}
                onClick={() => handleRollback(checkpoint)}
              >
                <History size={12} style={{ color: 'var(--cb-text-dim)' }} />
                <span style={{ color: 'var(--cb-text-muted)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{checkpoint.git_commit_hash?.slice(0, 7)}</span>
                <span style={{ color: 'var(--cb-text-dim)', fontSize: 11 }}>&middot;</span>
                <span style={{ color: 'var(--cb-text-dim)', fontSize: 11 }}>rollback</span>
              </div>
            )}
            {/* Diff summary popup on hover */}
            {showDiffSummary && diffLines.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 50,
                background: 'var(--cb-bg-elevated)', border: '1px solid var(--cb-border)', borderRadius: 8,
                padding: '8px 12px', minWidth: 200, maxWidth: 360,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}>
                <div style={{ color: 'var(--cb-text-muted)', fontSize: 10, marginBottom: 6, fontWeight: 500 }}>
                  Changed files
                </div>
                {diffLines.map((line, i) => (
                  <div key={i} style={{ color: 'var(--cb-text-secondary)', fontSize: 11, lineHeight: 1.6, fontFamily: "'JetBrains Mono', monospace" }}>
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* user content — right-aligned bubble */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{
            background: 'var(--cb-bg-active)', borderRadius: 12, padding: '12px 16px', maxWidth: '80%',
          }}>
            <div style={{ color: 'var(--cb-text-primary)', fontSize: 13, lineHeight: 1.5 }}>{msg.content}</div>
          </div>
        </div>
      </div>
    );
  }

  // Group blocks into segments: each segment = activity blocks + reply (text block)
  // Pattern: [thinking, tool, tool, text, thinking, tool, text] → 2 segments
  const segments: { activity: DisplayBlock[]; reply: DisplayBlock | null }[] = [];
  let currentActivity: DisplayBlock[] = [];
  for (const block of msg.blocks) {
    if (block.type === 'text') {
      segments.push({ activity: currentActivity, reply: block });
      currentActivity = [];
    } else {
      currentActivity.push(block);
    }
  }
  // Trailing activity without reply (still in progress or no text)
  if (currentActivity.length > 0) {
    segments.push({ activity: currentActivity, reply: null });
  }

  const [collapsedSegments, setCollapsedSegments] = useState<Record<number, boolean>>({});
  const toggleSegment = (idx: number) => {
    setCollapsedSegments((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div>
      {/* assistant header */}
      <div className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
        <Sparkles size={16} style={{ color: 'var(--cb-accent)' }} />
        <span style={{ color: 'var(--cb-text-primary)', fontSize: 13, fontWeight: 600 }}>Claude {msg.model === 'opus' ? 'Opus 4.6' : msg.model === 'sonnet' ? 'Sonnet 4.6' : msg.model === 'haiku' ? 'Haiku 4.5' : msg.model || 'Opus 4.6'}</span>
        <span style={{ color: 'var(--cb-text-dim)', fontSize: 10 }}>{formatTime(msg.created_at)}</span>
      </div>

      {segments.map((seg, idx) => (
        <div key={idx} style={{ marginBottom: 8 }}>
          {/* activity */}
          {seg.activity.length > 0 && (
            <div style={{ marginBottom: seg.reply ? 10 : 0 }}>
              <div
                className="flex items-center"
                onClick={() => toggleSegment(idx)}
                style={{ gap: 6, cursor: 'pointer', marginBottom: collapsedSegments[idx] ? 0 : 6 }}
              >
                <span style={{ color: 'var(--cb-text-dim)', fontSize: 13 }}>{collapsedSegments[idx] ? '▸' : '▾'}</span>
                <span style={{ color: 'var(--cb-text-muted)', fontSize: 13 }}>Activity</span>
                <span style={{ color: 'var(--cb-text-dim)', fontSize: 12 }}>{seg.activity.length} steps</span>
              </div>
              {!collapsedSegments[idx] && (
                <div style={{ borderLeft: '1px solid var(--cb-border)', marginLeft: 9, paddingLeft: 12 }}>
                  {seg.activity.map((block, j) => (
                    <BlockRenderer key={j} block={block} />
                  ))}
                </div>
              )}
            </div>
          )}
          {/* reply */}
          {seg.reply && <BlockRenderer block={seg.reply} />}
        </div>
      ))}

      {/* result bar */}
      {(msg.cost != null || msg.duration_ms != null) && (
        <div className="flex items-center" style={{ padding: '6px 0', gap: 16, marginTop: 8 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--cb-border)' }} />
          <span style={{ color: 'var(--cb-text-dim)', fontSize: 10, whiteSpace: 'nowrap' }}>
            {msg.duration_ms != null ? `${(msg.duration_ms / 1000).toFixed(1)}s` : ''}
            {msg.cost != null ? ` · $${msg.cost.toFixed(4)}` : ''}
          </span>
          <div style={{ flex: 1, height: 1, background: 'var(--cb-border)' }} />
        </div>
      )}
    </div>
  );
}

/* ── main component ────────────────────────────────────────── */

export function CenterPanel() {
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const defaultModels = [
    { id: 'opus', label: 'Opus 4.6 with 1M context · Most capable for complex work' },
    { id: 'sonnet', label: 'Sonnet 4.6 · Best for everyday tasks' },
    { id: 'haiku', label: 'Haiku 4.5 · Fastest for quick answers' },
  ];
  const [extraModels, setExtraModels] = useState<string[]>([]);

  useEffect(() => {
    api.getSetting('known_models').then((val) => {
      if (val) {
        const models: string[] = JSON.parse(val);
        const defaultIds = defaultModels.map((m) => m.id);
        setExtraModels(models.filter((m) => !defaultIds.includes(m)));
      }
    }).catch(() => {});
  }, []);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const {
    messages,
    sessions,
    streamingBlocks,
    isStreaming,
    activeSessionId,
    model,
    totalCost,
    contextUsage,
    checkpoints,
    hasMoreMessages,
    loadingMoreMessages,
    loadOlderMessages,
    sendMessage,
    stopStreaming,
    setModel,
  } = useAppStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Auto-scroll to bottom when session changes
  useEffect(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      setShowScrollToBottom(false);
    }, 100);
  }, [activeSessionId]);

  // Auto-scroll on new messages or streaming blocks (only if near bottom)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom < 200) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingBlocks]);

  // Track scroll position for scroll-to-bottom button + load-more
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollToBottom(distFromBottom > 300);
      // Load more when scrolled near top
      if (el.scrollTop < 100 && hasMoreMessages && !loadingMoreMessages) {
        const prevHeight = el.scrollHeight;
        loadOlderMessages().then(() => {
          // Preserve scroll position after prepending
          requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight - prevHeight;
          });
        });
      }
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [hasMoreMessages, loadingMoreMessages, loadOlderMessages]);

  // Helper: get text + file refs from contentEditable
  const getEditorContent = useCallback(() => {
    const el = editorRef.current;
    if (!el) return { text: '', refs: {} as Record<string, string> };
    const refs: Record<string, string> = {};
    let text = '';
    // Recursively walk all nodes (browser may wrap text in divs/spans)
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? '';
      } else if (node instanceof HTMLElement) {
        if (node.dataset.filePath) {
          // Extract label text excluding the close button (×)
          let tag = '';
          node.querySelectorAll('span').forEach((span) => {
            if (span.textContent !== '\u00D7') tag += span.textContent ?? '';
          });
          // Fallback: if no spans found (e.g. error fallback), use textContent minus trailing ×
          if (!tag) tag = (node.textContent ?? '').replace(/\u00D7$/, '').trim();
          refs[tag] = node.dataset.filePath;
          text += tag;
        } else {
          // Handle browser-inserted divs/spans (e.g., <div>text</div> from Enter)
          if (node.tagName === 'BR') {
            text += '\n';
          } else {
            if (node.tagName === 'DIV' && text.length > 0 && !text.endsWith('\n')) {
              text += '\n';
            }
            node.childNodes.forEach(walk);
          }
        }
      }
    };
    el.childNodes.forEach(walk);
    return { text, refs };
  }, []);

  // Helper: insert file chip at cursor position
  const insertFileChip = useCallback((filePath: string, dataUrl?: string) => {
    const el = editorRef.current;
    if (!el) return;

    const name = filePath.split('/').filter(Boolean).pop() || filePath;
    const hasExt = name.includes('.');
    const isDir = !hasExt;
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);

    const chip = document.createElement('span');
    chip.contentEditable = 'false';
    chip.dataset.filePath = filePath;

    // Helper: create a close (×) button for chips
    const makeCloseBtn = () => {
      const btn = document.createElement('span');
      btn.textContent = '\u00D7';
      btn.style.cssText = 'color:var(--cb-text-dim);font-size:14px;line-height:1;cursor:pointer;margin-left:2px;flex-shrink:0;';
      btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--cb-text-primary)'; });
      btn.addEventListener('mouseleave', () => { btn.style.color = 'var(--cb-text-dim)'; });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const parent = chip.parentNode;
        // Remove trailing space if present
        if (chip.nextSibling && chip.nextSibling.nodeType === Node.TEXT_NODE && chip.nextSibling.textContent === '\u00A0') {
          chip.nextSibling.remove();
        }
        chip.remove();
        // Restore cursor in editor
        if (parent && el) {
          el.focus();
          const sel = window.getSelection();
          if (sel) {
            const r = document.createRange();
            r.selectNodeContents(el);
            r.collapse(false);
            sel.removeAllRanges();
            sel.addRange(r);
          }
        }
      });
      return btn;
    };

    if (isImage) {
      // Image chip — inline-block with fixed line-height so cursor stays normal height
      chip.style.cssText = 'background:var(--cb-bg-primary);border:1px solid var(--cb-border);padding:3px;margin:0 2px;border-radius:6px;display:inline-block;vertical-align:middle;user-select:all;cursor:pointer;line-height:0;';
      const inner = document.createElement('span');
      inner.style.cssText = 'display:flex;align-items:center;gap:4px;';
      const img = document.createElement('img');
      img.src = dataUrl || convertFileSrc(filePath);
      img.style.cssText = 'height:28px;max-width:48px;object-fit:cover;border-radius:4px;display:block;';
      img.onerror = () => { img.style.display = 'none'; const fb = document.createElement('span'); fb.textContent = `@${name}`; fb.style.cssText = 'color:#E5A54B;font-size:12px;line-height:normal;'; inner.insertBefore(fb, inner.firstChild); };
      inner.appendChild(img);
      inner.appendChild(makeCloseBtn());
      chip.appendChild(inner);
      chip.title = name;
      if (dataUrl) chip.dataset.dataUrl = dataUrl;
      chip.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).textContent === '\u00D7') return;
        e.preventDefault();
        e.stopPropagation();
        setPreviewImage(dataUrl || convertFileSrc(filePath));
      });
    } else if (isDir) {
      // Directory chip — pencil design: deep bg + border + folder SVG icon + blue label + close
      chip.style.cssText = 'background:var(--cb-bg-primary);border:1px solid var(--cb-border);color:#60A5FA;padding:3px 8px 3px 6px;margin:0 2px;font-size:12px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;line-height:normal;vertical-align:middle;user-select:all;';
      const icon = document.createElement('span');
      icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
      icon.style.cssText = 'flex-shrink:0;display:flex;align-items:center;color:#60A5FA;';
      const label = document.createElement('span');
      label.textContent = `${name}/`;
      chip.appendChild(icon);
      chip.appendChild(label);
      chip.appendChild(makeCloseBtn());
    } else {
      // File chip — pencil design: deep bg + border + amber label + close
      chip.style.cssText = 'background:var(--cb-bg-primary);border:1px solid var(--cb-border);color:#E5A54B;padding:3px 8px;margin:0 2px;font-size:12px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;line-height:normal;vertical-align:middle;user-select:all;';
      const label = document.createElement('span');
      label.textContent = `@${name}`;
      chip.appendChild(label);
      chip.appendChild(makeCloseBtn());
    }

    const space = document.createTextNode('\u00A0');
    const sel = window.getSelection();

    // Check if cursor is inside our editor
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(space);
      range.insertNode(chip);
      // Move cursor after space
      range.setStartAfter(space);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      // Cursor not in editor — append at end
      el.appendChild(chip);
      el.appendChild(space);
      // Move cursor to end
      const range = document.createRange();
      range.setStartAfter(space);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    el.focus();
  }, [setPreviewImage]);

  const handleSend = async () => {
    const { text, refs } = getEditorContent();
    if (!text.trim() || isStreaming) return;
    let content = text;
    // Replace @filename with full paths
    for (const [tag, fullPath] of Object.entries(refs)) {
      content = content.split(tag).join(fullPath);
    }
    if (editorRef.current) {
      editorRef.current.innerHTML = '';
    }
    await sendMessage(content.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape' && previewImage) {
      setPreviewImage(null);
    }
  };

  const addFileRef = (filePath: string) => {
    insertFileChip(filePath);
  };

  const handleAttachFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Files', extensions: ['txt', 'md', 'json', 'csv', 'sql', 'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'svg', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    paths.forEach(addFileRef);
  };

  const handleAttachImages = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    paths.forEach(addFileRef);
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--cb-bg-primary)' }}>
      {/* header */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{ height: 42, padding: '0 24px', borderBottom: '1px solid var(--cb-border-subtle)' }}
      >
        <div className="flex items-center" style={{ gap: 10 }}>
          <span style={{ color: 'var(--cb-text-primary)', fontSize: 13, fontWeight: 600 }}>
            {activeSession?.name ?? 'No session'}
          </span>
          <span style={{ background: 'var(--cb-bg-elevated)', color: 'var(--cb-text-muted)', fontSize: 10, padding: '2px 8px', borderRadius: 10 }}>
            {model === 'opus' ? 'Opus 4.6' : model === 'sonnet' ? 'Sonnet 4.6' : model === 'haiku' ? 'Haiku 4.5' : model}
          </span>
        </div>
        <div className="flex items-center" style={{ gap: 10 }}>
          <span style={{ color: 'var(--cb-text-dim)', fontSize: 11 }}>${totalCost.toFixed(4)}</span>
          {contextUsage.total > 0 && (
            <div className="flex items-center" style={{ gap: 6 }}>
              <ContextProgressBar percent={contextUsage.percent} />
              <span style={{ color: contextUsage.percent > 80 ? 'var(--cb-accent-red)' : 'var(--cb-text-dim)', fontSize: 10 }}>{contextUsage.percent}%</span>
            </div>
          )}
        </div>
      </div>

      {/* messages — design: padding 24, gap 20 */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" style={{ padding: 24, position: 'relative' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Load more indicator */}
          {loadingMoreMessages && (
            <div style={{ textAlign: 'center', padding: '8px 0', color: 'var(--cb-text-dim)', fontSize: 11 }}>loading older messages...</div>
          )}
          {!hasMoreMessages && messages.length > 0 && (
            <div style={{ textAlign: 'center', padding: '8px 0', color: 'var(--cb-text-dim)', fontSize: 11 }}>session started</div>
          )}
          {(() => {
            // Merge consecutive assistant messages (CLI import creates cumulative snapshots)
            const merged: typeof messages = [];
            for (const msg of messages) {
              const prev = merged[merged.length - 1];
              if (prev && prev.role === 'assistant' && msg.role === 'assistant') {
                // Collect unique blocks — later snapshots may add new blocks
                const blockKey = (b: DisplayBlock) => {
                  if (b.type === 'text') return `text:${b.content}`;
                  if (b.type === 'thinking') return `thinking:${b.content.slice(0, 100)}`;
                  if (b.type === 'tool_use') return `tool:${b.tool}:${b.path ?? b.command ?? ''}`;
                  return JSON.stringify(b);
                };
                const existingKeys = new Set(prev.blocks.map(blockKey));
                const newBlocks = msg.blocks.filter((b) => !existingKeys.has(blockKey(b)));
                if (newBlocks.length > 0) {
                  merged[merged.length - 1] = {
                    ...prev,
                    blocks: [...prev.blocks, ...newBlocks],
                    cost: (prev.cost ?? 0) + (msg.cost ?? 0),
                    duration_ms: (prev.duration_ms ?? 0) + (msg.duration_ms ?? 0),
                  };
                }
                // Skip — already merged into prev
              } else {
                merged.push(msg);
              }
            }
            return merged.map((msg) => (
              <MessageView
                key={msg.id}
                msg={msg}
                checkpoint={checkpoints.find((cp) => cp.message_id === msg.id)}
              />
            ));
          })()}

          {/* streaming blocks — segmented Activity→Reply like saved messages */}
          {isStreaming && streamingBlocks.length > 0 && (() => {
            // Segment streaming blocks the same way as saved messages
            const segs: { activity: DisplayBlock[]; reply: DisplayBlock | null }[] = [];
            let curAct: DisplayBlock[] = [];
            for (const block of streamingBlocks) {
              if (block.type === 'text') {
                segs.push({ activity: curAct, reply: block });
                curAct = [];
              } else {
                curAct.push(block);
              }
            }
            if (curAct.length > 0) {
              segs.push({ activity: curAct, reply: null });
            }
            return (
              <div>
                <div className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
                  <Sparkles size={16} style={{ color: 'var(--cb-accent)' }} />
                  <span style={{ color: 'var(--cb-text-primary)', fontSize: 13, fontWeight: 600 }}>Claude {model === 'opus' ? 'Opus 4.6' : model === 'sonnet' ? 'Sonnet 4.6' : model === 'haiku' ? 'Haiku 4.5' : model}</span>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cb-accent)', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  <StreamTimer />
                </div>
                {segs.map((seg, idx) => (
                  <div key={idx}>
                    {seg.activity.length > 0 && (
                      <div style={{ marginBottom: seg.reply ? 10 : 0 }}>
                        <div className="flex items-center" style={{ gap: 6, cursor: 'pointer', marginBottom: 6 }}>
                          <ChevronDown size={13} style={{ color: 'var(--cb-text-dim)' }} />
                          <span style={{ color: 'var(--cb-text-muted)', fontSize: 13 }}>Activity</span>
                          <span style={{ color: 'var(--cb-text-dim)', fontSize: 12 }}>{seg.activity.length} steps</span>
                        </div>
                        <div style={{ borderLeft: '1px solid var(--cb-border)', marginLeft: 9, paddingLeft: 12 }}>
                          {seg.activity.map((block, j) => (
                            <BlockRenderer key={j} block={block} />
                          ))}
                        </div>
                      </div>
                    )}
                    {seg.reply && <BlockRenderer block={seg.reply} />}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* streaming indicator when no blocks yet */}
          {isStreaming && streamingBlocks.length === 0 && (
            <div className="flex items-center" style={{ gap: 8, padding: '12px 0' }}>
              <Sparkles size={16} style={{ color: 'var(--cb-accent)' }} />
              <span style={{ color: 'var(--cb-text-primary)', fontSize: 13, fontWeight: 600 }}>Claude {model === 'opus' ? 'Opus 4.6' : model === 'sonnet' ? 'Sonnet 4.6' : model === 'haiku' ? 'Haiku 4.5' : model}</span>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--cb-accent)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
              <span style={{ color: 'var(--cb-text-dim)', fontSize: 11 }}>thinking...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Scroll to bottom button */}
        {showScrollToBottom && (
          <button
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
            style={{
              position: 'sticky',
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 36,
              height: 36,
              borderRadius: 18,
              background: 'var(--cb-bg-elevated)',
              border: '1px solid var(--cb-border)',
              color: 'var(--cb-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              zIndex: 10,
            }}
            title="Scroll to bottom"
          >
            ↓
          </button>
        )}
      </div>

      {/* input area — drop zone for files */}
      <div
        className="shrink-0"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          setIsDragOver(true);
        }}
        onDragLeave={(e) => {
          // Only hide if leaving the container itself
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
          }
        }}
        onDrop={async (e) => {
          e.preventDefault();
          setIsDragOver(false);

          // Position cursor at drop point
          const range = document.caretRangeFromPoint(e.clientX, e.clientY);
          if (range) {
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }

          // Handle internal drag (text path)
          const filePath = e.dataTransfer.getData('text/plain');
          if (filePath && filePath.startsWith('/')) {
            insertFileChip(filePath);
            return;
          }

          // Handle external file drop (from OS)
          const files = e.dataTransfer.files;
          if (files && files.length > 0) {
            for (const file of Array.from(files)) {
              // For images, save to project and insert chip
              if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = async () => {
                  const base64 = reader.result as string;
                  const { projects, activeProjectId } = useAppStore.getState();
                  const project = projects.find((p) => p.id === activeProjectId);
                  if (!project) return;
                  try {
                    const savedPath = await api.savePastedImage(base64, project.path);
                    insertFileChip(savedPath, base64);
                  } catch (err) {
                    // image save failed
                  }
                };
                reader.readAsDataURL(file);
              } else {
                // Non-image files: use the path directly if available
                // Note: web File API doesn't expose full path for security
                // The file name is inserted as a reference
                insertFileChip(`[dropped: ${file.name}]`);
              }
            }
          }
        }}
        style={{
          borderTop: isDragOver ? '2px solid #E5A54B' : '1px solid var(--cb-border)',
          padding: isDragOver ? '12px 24px 10px' : '12px 24px 10px',
          background: isDragOver ? '#E5A54B33' : 'transparent',
          transition: 'background 0.15s, border-top 0.15s',
        }}
      >
        {/* input row */}
        <div className="flex items-start" style={{ gap: 10 }}>
          <div
            className="flex items-start flex-1"
            style={{ padding: '12px 16px', background: 'var(--cb-bg-elevated)', borderRadius: 12, gap: 8, minHeight: 40 }}
          >
            <div
              ref={editorRef}
              contentEditable={!!activeSessionId}
              suppressContentEditableWarning
              onKeyDown={handleKeyDown}
              onPaste={async (e) => {
                const items = e.clipboardData?.items;
                if (!items) return;

                // Check for files (copied from Finder/Explorer)
                const files = e.clipboardData?.files;
                if (files && files.length > 0) {
                  for (const file of Array.from(files)) {
                    if (file.type.startsWith('image/')) {
                      e.preventDefault();
                      const reader = new FileReader();
                      reader.onload = async () => {
                        const base64 = reader.result as string;
                        const { projects, activeProjectId } = useAppStore.getState();
                        const project = projects.find((p) => p.id === activeProjectId);
                        if (!project) return;
                        try {
                          const savedPath = await api.savePastedImage(base64, project.path);
                          insertFileChip(savedPath, base64);
                        } catch (err) {
                          // paste failed
                        }
                      };
                      reader.readAsDataURL(file);
                      return;
                    }
                  }
                }

                // Check for file:// URIs (macOS Finder copy)
                const uriList = e.clipboardData?.getData('text/uri-list')?.trim();
                if (uriList) {
                  const paths = uriList.split('\n')
                    .map((u) => u.trim())
                    .filter((u) => u.startsWith('file://'))
                    .map((u) => decodeURIComponent(u.replace('file://', '')));
                  if (paths.length > 0) {
                    e.preventDefault();
                    for (const p of paths) insertFileChip(p);
                    return;
                  }
                }

                // Check for pasted text that looks like a file/dir path
                const pastedText = e.clipboardData?.getData('text/plain')?.trim();
                if (pastedText && pastedText.startsWith('/') && !pastedText.includes('\n')) {
                  e.preventDefault();
                  insertFileChip(pastedText);
                  return;
                }

                // Check for image items (screenshot paste etc)
                for (const item of Array.from(items)) {
                  if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const blob = item.getAsFile();
                    if (!blob) return;
                    const reader = new FileReader();
                    reader.onload = async () => {
                      const base64 = reader.result as string;
                      const { projects, activeProjectId } = useAppStore.getState();
                      const project = projects.find((p) => p.id === activeProjectId);
                      if (!project) return;
                      try {
                        const savedPath = await api.savePastedImage(base64, project.path);
                        insertFileChip(savedPath, base64);
                      } catch (err) {
                        // paste failed
                      }
                    };
                    reader.readAsDataURL(blob);
                    return;
                  }
                }
              }}
              data-placeholder="type a message..."
              style={{
                color: 'var(--cb-text-primary)', fontSize: 13, fontFamily: 'inherit',
                lineHeight: '24px', maxHeight: 150, overflowY: 'auto',
                outline: 'none', flex: 1, minHeight: 24,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}
            />
          </div>
        </div>

        {/* action bar */}
        <div className="flex items-center justify-between" style={{ marginTop: 6 }}>
          <div className="flex items-center" style={{ gap: 4 }}>
            <button
              onClick={handleAttachFiles}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--cb-text-dim)', padding: '4px 6px', borderRadius: 4, display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--cb-text-muted)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--cb-text-dim)')}
              title="attach files"
            >
              <CirclePlus size={16} />
            </button>
            <button
              onClick={handleAttachImages}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--cb-text-dim)', padding: '4px 6px', borderRadius: 4, display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--cb-text-muted)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--cb-text-dim)')}
              title="attach images"
            >
              <Image size={16} />
            </button>
          </div>
          <div className="flex items-center" style={{ gap: 10, minWidth: 0, flex: 1, justifyContent: 'flex-end' }}>
            <div style={{ position: 'relative', minWidth: 0, maxWidth: '100%' }}>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{
                  appearance: 'none', WebkitAppearance: 'none',
                  background: 'var(--cb-bg-primary)', borderRadius: 10, padding: '3px 26px 3px 26px',
                  border: '1px solid var(--cb-border)', color: 'var(--cb-text-muted)', fontSize: 11,
                  fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
                  maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {defaultModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
                {extraModels.length > 0 && (
                  <optgroup label="previously used">
                    {extraModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <Sparkles size={10} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--cb-accent)', pointerEvents: 'none' }} />
              <ChevronDown size={10} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', color: 'var(--cb-text-dim)', pointerEvents: 'none' }} />
            </div>
            {isStreaming ? (
              <div
                onClick={stopStreaming}
                style={{ cursor: 'pointer', padding: '2px 8px', background: 'var(--cb-accent-red)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--cb-text-primary)' }} />
                <span style={{ color: 'var(--cb-text-primary)', fontSize: 10, fontWeight: 500 }}>stop</span>
              </div>
            ) : (
              <Send size={16} style={{ color: 'var(--cb-accent)', cursor: 'pointer', opacity: !activeSessionId ? 0.3 : 1 }} onClick={handleSend} />
            )}
          </div>
        </div>
      </div>

      {/* image preview modal */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setPreviewImage(null); }}
          tabIndex={0}
          ref={(el) => el?.focus()}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img
              src={previewImage}
              style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain' }}
            />
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <span style={{ color: 'var(--cb-text-dim)', fontSize: 11 }}>{previewImage.split('/').pop()}</span>
              <span
                onClick={() => setPreviewImage(null)}
                style={{ color: 'var(--cb-text-dim)', fontSize: 12, marginLeft: 16, cursor: 'pointer' }}
              >
                [esc]
              </span>
            </div>
          </div>
        </div>
      )}

      {/* pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
