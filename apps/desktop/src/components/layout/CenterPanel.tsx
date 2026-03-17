import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore, type DisplayMessage } from '../../stores/useAppStore';
import type { DisplayBlock, DisplayThinkingBlock, DisplayToolBlock, DisplayTextBlock, Checkpoint } from '../../types';
import * as api from '../../lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/* ── sub-components ────────────────────────────────────────── */

// Timeline icon for tool types
function toolIcon(tool: string): { icon: string; color: string } {
  const t = tool.toLowerCase();
  if (t === 'edit' || t === 'write') return { icon: '✎', color: '#10B981' };
  if (t === 'bash') return { icon: '⬚', color: '#06B6D4' };
  if (t === 'read') return { icon: '◉', color: '#6B7280' };
  if (t === 'glob' || t === 'grep') return { icon: '⊕', color: '#6B7280' };
  return { icon: '◆', color: '#6B7280' };
}

function ThinkingBlockView({ block }: { block: DisplayThinkingBlock }) {
  const [expanded, setExpanded] = useState(false);
  // Extract first meaningful line as summary
  const summary = block.content.split('\n').find(l => l.trim().length > 0)?.trim().slice(0, 80) || '';

  return (
    <div
      className="flex items-start"
      onClick={() => setExpanded(!expanded)}
      style={{ cursor: 'pointer', gap: 8, padding: '5px 0' }}
    >
      {/* timeline dot */}
      <span style={{ color: '#a78bfa', fontSize: 13, lineHeight: '20px', flexShrink: 0, width: 18, textAlign: 'center' }}>⊙</span>
      {/* content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center" style={{ gap: 8, lineHeight: '20px' }}>
          <span style={{ color: '#a78bfa', fontSize: 13, fontWeight: 600 }}>Thinking</span>
          <span style={{ color: '#6B7280', fontSize: 12, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {summary ? `**${summary}**` : ''}
          </span>
          <span style={{ color: '#4B5563', fontSize: 11, flexShrink: 0 }}>
            {block.chars > 1000 ? `${(block.chars / 1000).toFixed(1)}k` : block.chars} chars
          </span>
        </div>
        {expanded && (
          <div style={{
            marginTop: 6,
            padding: '10px 12px',
            background: '#1a1825',
            border: '1px solid #2a2040',
            color: '#c4b5fd',
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
  const { icon, color } = toolIcon(block.tool);

  // Build description
  const desc = block.path || block.command || '';
  const diffInfo = block.additions != null
    ? `+${block.additions}${block.deletions ? ` -${block.deletions}` : ''}`
    : '';

  return (
    <div
      className="flex items-start"
      onClick={() => hasDetails && setExpanded(!expanded)}
      style={{ cursor: hasDetails ? 'pointer' : 'default', gap: 8, padding: '5px 0' }}
    >
      {/* timeline dot */}
      <span style={{ color, fontSize: 13, lineHeight: '20px', flexShrink: 0, width: 18, textAlign: 'center' }}>{icon}</span>
      {/* content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center" style={{ gap: 8, lineHeight: '20px' }}>
          <span style={{ color: '#FAFAFA', fontSize: 13, fontWeight: 600 }}>{block.tool}</span>
          <span style={{ color: '#9CA3AF', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {desc}
          </span>
          {diffInfo && (
            <span style={{ fontSize: 11, flexShrink: 0 }}>
              <span style={{ color: '#10B981' }}>{diffInfo.split(' ')[0]}</span>
              {diffInfo.includes('-') && <span style={{ color: '#EF4444' }}> {diffInfo.split(' ')[1]}</span>}
            </span>
          )}
        </div>
        {expanded && hasDetails && (
          <div style={{
            marginTop: 6,
            padding: '10px 12px',
            background: '#0a1a0f',
            border: '1px solid #1a2a1a',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            color: '#86efac',
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
            <p style={{ color: '#FAFAFA', fontSize: 13, lineHeight: 1.6, marginBottom: 8 }}>{children}</p>
          ),
          strong: ({ children }) => (
            <strong style={{ color: '#FAFAFA', fontWeight: 600 }}>{children}</strong>
          ),
          em: ({ children }) => (
            <em style={{ color: '#9CA3AF' }}>{children}</em>
          ),
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code style={{
                  background: '#1F1F1F',
                  color: '#06B6D4',
                  padding: '2px 6px',
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
              background: '#0F0F0F',
              border: '1px solid #2a2a2a',
              padding: '12px 16px',
              margin: '8px 0',
              overflow: 'auto',
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: "'JetBrains Mono', monospace",
            }}>{children}</pre>
          ),
          ul: ({ children }) => (
            <ul style={{ paddingLeft: 16, margin: '6px 0', color: '#FAFAFA', fontSize: 13, lineHeight: 1.6 }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ paddingLeft: 16, margin: '6px 0', color: '#FAFAFA', fontSize: 13, lineHeight: 1.6 }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ marginBottom: 4, color: '#FAFAFA' }}>{children}</li>
          ),
          h1: ({ children }) => (
            <h1 style={{ color: '#FAFAFA', fontSize: 18, fontWeight: 700, marginBottom: 8, marginTop: 16 }}>{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ color: '#FAFAFA', fontSize: 16, fontWeight: 700, marginBottom: 6, marginTop: 12 }}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ color: '#FAFAFA', fontSize: 14, fontWeight: 600, marginBottom: 4, marginTop: 10 }}>{children}</h3>
          ),
          blockquote: ({ children }) => (
            <blockquote style={{
              borderLeft: '3px solid #10B981',
              paddingLeft: 12,
              margin: '8px 0',
              color: '#9CA3AF',
            }}>{children}</blockquote>
          ),
          a: ({ children, href }) => (
            <a href={href} style={{ color: '#06B6D4', textDecoration: 'none' }}>{children}</a>
          ),
          table: ({ children }) => (
            <table style={{ borderCollapse: 'collapse', width: '100%', margin: '8px 0', fontSize: 12 }}>{children}</table>
          ),
          th: ({ children }) => (
            <th style={{ border: '1px solid #2a2a2a', padding: '6px 10px', textAlign: 'left', color: '#FAFAFA', background: '#0F0F0F', fontWeight: 600, fontSize: 12 }}>{children}</th>
          ),
          td: ({ children }) => (
            <td style={{ border: '1px solid #2a2a2a', padding: '6px 10px', color: '#FAFAFA', fontSize: 12 }}>{children}</td>
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
  const barColor = percent > 80 ? '#EF4444' : percent > 60 ? '#F59E0B' : '#10B981';
  return (
    <div className="flex items-center" style={{ gap: 6 }}>
      <div style={{ width: 80, height: 6, background: '#1F1F1F', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(percent, 100)}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span style={{ color: barColor, fontSize: 10, whiteSpace: 'nowrap' }}>
        {percent}%{percent > 80 ? ' context filling up' : ''}
      </span>
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

  if (msg.role === 'user') {
    return (
      <div>
        {/* user header — design: gap 8, marginBottom 8 */}
        <div className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
          <span style={{ color: '#06B6D4', fontSize: 12, fontWeight: 700 }}>{'>'} you</span>
          <span style={{ color: '#4B5563', fontSize: 10 }}>{formatTime(msg.created_at)}</span>
          {checkpoint && checkpoint.git_commit_hash && (
            <div style={{ marginLeft: 'auto' }}>
              {rollbackState === 'confirm' ? (
                <div className="flex items-center" style={{ gap: 6 }}>
                  <span style={{ color: '#9CA3AF', fontSize: 11 }}>rollback to this point?</span>
                  <span
                    onClick={() => confirmRollback(checkpoint)}
                    style={{
                      color: '#0A0A0A', background: '#10B981', fontSize: 11, fontWeight: 500,
                      padding: '2px 10px', cursor: 'pointer',
                    }}
                  >
                    yes
                  </span>
                  <span
                    onClick={cancelRollback}
                    style={{
                      color: '#9CA3AF', border: '1px solid #2a2a2a', fontSize: 11,
                      padding: '2px 10px', cursor: 'pointer',
                    }}
                  >
                    no
                  </span>
                </div>
              ) : rollbackState === 'loading' ? (
                <span style={{ color: '#F59E0B', fontSize: 11 }}>rolling back...</span>
              ) : rollbackState === 'done' || rollbackState === 'error' ? (
                <span style={{ color: rollbackState === 'done' ? '#10B981' : '#EF4444', fontSize: 11 }}>{rollbackMsg}</span>
              ) : (
                <div
                  onClick={() => handleRollback(checkpoint)}
                  className="flex items-center"
                  style={{
                    gap: 5, cursor: 'pointer', padding: '2px 8px',
                    border: '1px solid #2a2a2a', background: '#0F0F0F',
                  }}
                  title={`checkpoint: ${checkpoint.git_commit_hash}\n${checkpoint.git_diff_summary ?? 'no changes'}`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  <span style={{ color: '#9CA3AF', fontSize: 11 }}>{checkpoint.git_commit_hash.slice(0, 7)}</span>
                </div>
              )}
            </div>
          )}
        </div>
        {/* user content — design: padding [12,16], border rgba blue */}
        <div style={{ padding: '12px 16px', border: '1px solid rgba(96,165,250,0.15)' }}>
          <div style={{ color: '#FAFAFA', fontSize: 13, lineHeight: 1.5 }}>{msg.content}</div>
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
        <span style={{ color: '#10B981', fontSize: 12, fontWeight: 700 }}>{'>'} claude</span>
        {msg.model && <span style={{ color: '#6B7280', fontSize: 10 }}>{msg.model}</span>}
        <span style={{ color: '#4B5563', fontSize: 10 }}>{formatTime(msg.created_at)}</span>
      </div>

      {segments.map((seg, idx) => (
        <div key={idx} style={{ marginBottom: 8 }}>
          {/* activity */}
          {seg.activity.length > 0 && (
            <div style={{ marginBottom: seg.reply ? 8 : 0 }}>
              <div
                className="flex items-center"
                onClick={() => toggleSegment(idx)}
                style={{ gap: 6, cursor: 'pointer', marginBottom: collapsedSegments[idx] ? 0 : 6 }}
              >
                <span style={{ color: '#6B7280', fontSize: 13 }}>{collapsedSegments[idx] ? '▸' : '▾'}</span>
                <span style={{ color: '#9CA3AF', fontSize: 13 }}>Activity</span>
                <span style={{ color: '#4B5563', fontSize: 12 }}>{seg.activity.length} steps</span>
              </div>
              {!collapsedSegments[idx] && (
                <div style={{ borderLeft: '1px solid #2a2a2a', marginLeft: 9 }}>
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
          <div style={{ flex: 1, height: 1, background: '#2a2a2a' }} />
          <span style={{ color: '#4B5563', fontSize: 10, whiteSpace: 'nowrap' }}>
            {msg.duration_ms != null ? `${(msg.duration_ms / 1000).toFixed(1)}s` : ''}
            {msg.cost != null ? ` · $${msg.cost.toFixed(4)}` : ''}
          </span>
          <div style={{ flex: 1, height: 1, background: '#2a2a2a' }} />
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
  const editorRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    streamingBlocks,
    isStreaming,
    activeSessionId,
    sessions,
    model,
    totalCost,
    contextUsage,
    checkpoints,
    sendMessage,
    stopStreaming,
    setModel,
  } = useAppStore();

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Auto-scroll on new messages or streaming blocks
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingBlocks]);

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
          const tag = node.textContent ?? '';
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

    if (isImage) {
      // Image chip with thumbnail
      chip.style.cssText = 'background:#1a2a1a;border:1px solid #2a4030;padding:2px 6px 2px 2px;margin:0 2px;font-size:12px;border-radius:2px;display:inline-flex;align-items:center;gap:4px;line-height:18px;vertical-align:baseline;user-select:all;cursor:pointer;';
      const img = document.createElement('img');
      img.src = dataUrl || convertFileSrc(filePath);
      img.style.cssText = 'height:20px;max-width:40px;object-fit:cover;border-radius:1px;';
      img.onerror = () => { img.style.display = 'none'; };
      chip.appendChild(img);
      const label = document.createElement('span');
      label.textContent = `@${name}`;
      label.style.color = '#10B981';
      chip.appendChild(label);
      // Store dataUrl for preview
      if (dataUrl) chip.dataset.dataUrl = dataUrl;
      // Click to preview
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setPreviewImage(dataUrl || convertFileSrc(filePath));
      });
    } else if (isDir) {
      chip.textContent = `@${name}/`;
      chip.style.cssText = 'background:#1a1a2a;border:1px solid #2a3050;color:#06B6D4;padding:1px 6px;margin:0 2px;font-size:12px;border-radius:2px;display:inline-block;line-height:18px;vertical-align:baseline;user-select:all;';
    } else {
      chip.textContent = `@${name}`;
      chip.style.cssText = 'background:#1a2a1a;border:1px solid #2a4030;color:#10B981;padding:1px 6px;margin:0 2px;font-size:12px;border-radius:2px;display:inline-block;line-height:18px;vertical-align:baseline;user-select:all;';
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
    <div className="flex flex-col h-full" style={{ background: '#0A0A0A' }}>
      {/* header — draggable for window move */}
      <div
        data-no-select
        className="flex items-center justify-between shrink-0"
        onMouseDown={(e) => {
          // Allow drag on empty header space
          const tag = (e.target as HTMLElement).tagName.toLowerCase();
          if (tag === 'div' || tag === 'span') {
            getCurrentWindow().startDragging();
          }
        }}
        style={{ height: 42, padding: '0 24px', borderBottom: '1px solid #2a2a2a' }}
      >
        <div className="flex items-center" style={{ gap: 10 }}>
          <span style={{ color: '#FAFAFA', fontSize: 14, fontWeight: 700 }}>
            $ {activeSession?.name ?? 'no session'}
          </span>
        </div>
        <div className="flex items-center" style={{ gap: 12 }}>
          {/* model badge — design: padding [3,8], gap 4, border #2a2a2a */}
          <div className="flex items-center" style={{ padding: '3px 8px', gap: 4, border: '1px solid #2a2a2a' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: isStreaming ? '#F59E0B' : '#10B981' }} />
            <span style={{ color: '#FAFAFA', fontSize: 11 }}>claude-{model}</span>
          </div>
          <span style={{ color: '#6B7280', fontSize: 11 }}>${totalCost.toFixed(4)}</span>
          {contextUsage.total > 0 && <ContextProgressBar percent={contextUsage.percent} />}
        </div>
      </div>

      {/* messages — design: padding 24, gap 20 */}
      <div className="flex-1 overflow-y-auto" style={{ padding: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {messages.map((msg) => (
            <MessageView
              key={msg.id}
              msg={msg}
              checkpoint={checkpoints.find((cp) => cp.message_id === msg.id)}
            />
          ))}

          {/* streaming blocks — same Activity timeline layout */}
          {isStreaming && streamingBlocks.length > 0 && (() => {
            const sActivity = streamingBlocks.filter((b) => b.type === 'thinking' || b.type === 'tool_use');
            const sReply = streamingBlocks.filter((b) => b.type === 'text');
            return (
              <div>
                <div className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
                  <span style={{ color: '#10B981', fontSize: 12, fontWeight: 700 }}>{'>'} claude</span>
                  <span style={{ color: '#6B7280', fontSize: 10 }}>{model}</span>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#F59E0B', animation: 'pulse 1.5s ease-in-out infinite' }} />
                </div>
                {sActivity.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div className="flex items-center" style={{ gap: 6, marginBottom: 6 }}>
                      <span style={{ color: '#6B7280', fontSize: 13 }}>▾</span>
                      <span style={{ color: '#9CA3AF', fontSize: 13 }}>Activity</span>
                      <span style={{ color: '#4B5563', fontSize: 12 }}>{sActivity.length} steps</span>
                    </div>
                    <div style={{ borderLeft: '1px solid #2a2a2a', marginLeft: 9 }}>
                      {sActivity.map((block, j) => (
                        <BlockRenderer key={j} block={block} />
                      ))}
                    </div>
                  </div>
                )}
                {sReply.length > 0 && (
                  <div>
                    {sReply.map((block, j) => (
                      <BlockRenderer key={j} block={block} />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* streaming indicator when no blocks yet */}
          {isStreaming && streamingBlocks.length === 0 && (
            <div className="flex items-center" style={{ gap: 8, padding: '12px 0' }}>
              <span style={{ color: '#10B981', fontSize: 12, fontWeight: 700 }}>{'>'} claude</span>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#F59E0B',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
              <span style={{ color: '#6B7280', fontSize: 11 }}>thinking...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
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
                    console.error('Failed to save dropped image:', err);
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
          borderTop: isDragOver ? '2px solid #10B981' : '1px solid #2a2a2a',
          padding: isDragOver ? '15px 24px 24px' : '16px 24px 24px',
          background: isDragOver ? '#10B98110' : 'transparent',
          transition: 'background 0.15s, border-top 0.15s',
        }}
      >
        {/* toolbar — design: gap 12 */}
        <div className="flex items-center" style={{ gap: 10, marginBottom: 8 }}>
          {/* cli selector */}
          <div className="flex items-center" style={{ padding: '3px 8px', gap: 4, border: '1px solid #2a2a2a' }}>
            <span style={{ color: '#FAFAFA', fontSize: 11 }}>claude</span>
          </div>
          {/* model dropdown — styled select */}
          <div style={{ position: 'relative' }}>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={{
                appearance: 'none',
                WebkitAppearance: 'none',
                padding: '3px 22px 3px 8px',
                border: '1px solid #2a2a2a',
                background: '#0A0A0A',
                color: '#FAFAFA',
                fontSize: 11,
                fontFamily: 'inherit',
                cursor: 'pointer',
                outline: 'none',
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
            {/* custom arrow */}
            <span style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              color: '#6B7280', fontSize: 8, pointerEvents: 'none',
            }}>▾</span>
          </div>
          <span style={{ color: '#F59E0B', fontSize: 10 }}>--dangerously-skip-permissions</span>
        </div>

        {/* input row */}
        <div className="flex items-end" style={{ gap: 10 }}>
          <div
            className="flex items-start flex-1"
            style={{ padding: '10px 14px', border: '1px solid #2a2a2a', gap: 8, minHeight: 40 }}
          >
            <span style={{ color: '#10B981', fontSize: 13, lineHeight: '20px', flexShrink: 0 }}>$</span>
            <div
              ref={editorRef}
              contentEditable={!!activeSessionId}
              suppressContentEditableWarning
              onKeyDown={handleKeyDown}
              onPaste={async (e) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                for (const item of Array.from(items)) {
                  if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const blob = item.getAsFile();
                    if (!blob) return;
                    // Convert to base64
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
                        console.error('Failed to save pasted image:', err);
                      }
                    };
                    reader.readAsDataURL(blob);
                    return;
                  }
                }
              }}
              data-placeholder="type a message..."
              style={{
                color: '#FAFAFA', fontSize: 13, fontFamily: 'inherit',
                lineHeight: '22px', maxHeight: 150, overflowY: 'auto',
                outline: 'none', flex: 1, minHeight: 20,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}
            />
          </div>
          {isStreaming ? (
            <button
              onClick={stopStreaming}
              style={{
                padding: '10px 16px', background: '#ef4444', color: '#FAFAFA',
                fontSize: 12, fontWeight: 500, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!activeSessionId}
              style={{
                padding: '10px 16px', background: '#10B981', color: '#0A0A0A',
                fontSize: 12, fontWeight: 500, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                opacity: !activeSessionId ? 0.5 : 1,
              }}
            >
              send
            </button>
          )}
        </div>

        {/* action bar */}
        <div className="flex items-center justify-between" style={{ marginTop: 6 }}>
          <div className="flex items-center" style={{ gap: 2 }}>
            <button
              onClick={handleAttachFiles}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#4B5563', padding: '4px 6px', display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#9CA3AF')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#4B5563')}
              title="attach files"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <button
              onClick={handleAttachImages}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#4B5563', padding: '4px 6px', display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#9CA3AF')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#4B5563')}
              title="attach images"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
            </button>
          </div>
          <span style={{ color: '#4B5563', fontSize: 10 }}>
            enter ↵ newline · ⌘↵ send
          </span>
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
              <span style={{ color: '#6B7280', fontSize: 11 }}>{previewImage.split('/').pop()}</span>
              <span
                onClick={() => setPreviewImage(null)}
                style={{ color: '#6B7280', fontSize: 12, marginLeft: 16, cursor: 'pointer' }}
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
