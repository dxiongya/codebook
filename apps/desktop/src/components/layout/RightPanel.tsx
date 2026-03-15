import { useState, useEffect, useRef, useCallback } from 'react';
import { DiffEditor, Editor } from '@monaco-editor/react';
import { useAppStore } from '../../stores/useAppStore';
import * as api from '../../lib/api';
import type { FileChange, DiffResult, FileEntry, FileContent } from '../../types';

const statusColors: Record<string, string> = {
  M: '#F59E0B',
  A: '#10B981',
  D: '#EF4444',
  '?': '#6B7280',
};

const beforeMount = (monaco: any) => {
  monaco.editor.defineTheme('codebook-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0A0A0A',
      'editor.lineHighlightBackground': '#1F1F1F',
      'editorLineNumber.foreground': '#4B5563',
      'editorGutter.background': '#0A0A0A',
      'diffEditor.insertedTextBackground': '#10B98118',
      'diffEditor.removedTextBackground': '#EF444418',
      'diffEditor.insertedLineBackground': '#10B98110',
      'diffEditor.removedLineBackground': '#EF444410',
    },
  });
};

// Terminal-style file type icons
function fileIcon(name: string, isDir: boolean): { icon: string; color: string } {
  if (isDir) return { icon: '■', color: '#6B7280' };
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, { icon: string; color: string }> = {
    ts: { icon: 'TS', color: '#06B6D4' },
    tsx: { icon: 'TX', color: '#06B6D4' },
    js: { icon: 'JS', color: '#F59E0B' },
    jsx: { icon: 'JX', color: '#F59E0B' },
    py: { icon: 'PY', color: '#3B82F6' },
    rs: { icon: 'RS', color: '#F97316' },
    go: { icon: 'GO', color: '#06B6D4' },
    json: { icon: '{}', color: '#10B981' },
    yaml: { icon: '≡', color: '#10B981' },
    yml: { icon: '≡', color: '#10B981' },
    toml: { icon: '≡', color: '#10B981' },
    md: { icon: 'MD', color: '#9CA3AF' },
    txt: { icon: '¶', color: '#9CA3AF' },
    css: { icon: '#', color: '#a78bfa' },
    scss: { icon: '#', color: '#a78bfa' },
    html: { icon: '<>', color: '#F97316' },
    svg: { icon: '◇', color: '#F59E0B' },
    png: { icon: '▣', color: '#10B981' },
    jpg: { icon: '▣', color: '#10B981' },
    jpeg: { icon: '▣', color: '#10B981' },
    gif: { icon: '▣', color: '#10B981' },
    lock: { icon: '⊘', color: '#4B5563' },
    env: { icon: '⊕', color: '#F59E0B' },
    sh: { icon: '$', color: '#10B981' },
    sql: { icon: 'Q', color: '#3B82F6' },
    xml: { icon: '<>', color: '#F97316' },
  };
  return map[ext] ?? { icon: '·', color: '#4B5563' };
}

function FileTreeNode({
  entry,
  depth,
  expandedDirs,
  toggleDir,
  onFileClick,
  activeFilePath,
}: {
  entry: FileEntry;
  depth: number;
  expandedDirs: Record<string, FileEntry[]>;
  toggleDir: (path: string) => void;
  onFileClick?: (path: string) => void;
  activeFilePath?: string | null;
}) {
  const isExpanded = !!expandedDirs[entry.path];
  const indent = 16 + depth * 14;
  const { icon, color } = fileIcon(entry.name, entry.is_dir);
  const isEmpty = entry.is_dir && entry.child_count === 0;
  const canExpand = entry.is_dir && !isEmpty;

  return (
    <>
      <div
        className="flex items-center"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', entry.path);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => {
          if (canExpand) toggleDir(entry.path);
          else if (!entry.is_dir && onFileClick) onFileClick(entry.path);
        }}
        style={{
          padding: `3px 12px 3px ${indent}px`,
          cursor: (canExpand || !entry.is_dir) ? 'pointer' : 'default',
          gap: 6,
          background: activeFilePath === entry.path ? '#1F1F1F' : 'transparent',
        }}
      >
        {entry.is_dir ? (
          <span style={{
            color: isEmpty ? '#333' : '#10B981',
            fontSize: 9,
            width: 14,
            textAlign: 'center',
            flexShrink: 0,
          }}>
            {isEmpty ? '∅' : isExpanded ? '▾' : '▸'}
          </span>
        ) : (
          <span style={{
            color,
            fontSize: 8,
            fontWeight: 700,
            width: 14,
            textAlign: 'center',
            flexShrink: 0,
            letterSpacing: -0.5,
          }}>
            {icon}
          </span>
        )}
        <span style={{
          color: entry.is_dir ? (isEmpty ? '#4B5563' : '#FAFAFA') : color,
          fontSize: 12,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          opacity: isEmpty ? 0.5 : entry.is_dir ? 1 : 0.85,
        }}>
          {entry.name}{entry.is_dir ? '/' : ''}
        </span>
        {entry.is_dir && entry.child_count != null && (
          <span style={{ color: '#4B5563', fontSize: 9, flexShrink: 0 }}>
            {entry.child_count}
          </span>
        )}
      </div>
      {isExpanded && expandedDirs[entry.path]?.map((child) => (
        <FileTreeNode key={child.path} entry={child} depth={depth + 1} expandedDirs={expandedDirs} toggleDir={toggleDir} onFileClick={onFileClick} activeFilePath={activeFilePath} />
      ))}
    </>
  );
}

// Compact file tree for fullscreen modal sidebar
function FullscreenFileTreeNode({
  entry,
  depth,
  expandedDirs,
  toggleDir,
  onFileClick,
  activeFilePath,
}: {
  entry: FileEntry;
  depth: number;
  expandedDirs: Record<string, FileEntry[]>;
  toggleDir: (path: string) => void;
  onFileClick: (path: string) => void;
  activeFilePath: string;
}) {
  const isExpanded = !!expandedDirs[entry.path];
  const indent = 12 + depth * 12;
  const { icon, color } = fileIcon(entry.name, entry.is_dir);
  const isEmpty = entry.is_dir && entry.child_count === 0;
  const canExpand = entry.is_dir && !isEmpty;
  const isActive = activeFilePath === entry.path;

  return (
    <>
      <div
        className="flex items-center"
        onClick={() => {
          if (canExpand) toggleDir(entry.path);
          else if (!entry.is_dir) onFileClick(entry.path);
        }}
        style={{
          padding: `2px 8px 2px ${indent}px`,
          cursor: (canExpand || !entry.is_dir) ? 'pointer' : 'default',
          gap: 5,
          background: isActive ? '#1F1F1F' : 'transparent',
          borderLeft: isActive ? '2px solid #10B981' : '2px solid transparent',
        }}
      >
        {entry.is_dir ? (
          <span style={{ color: isEmpty ? '#333' : '#6B7280', fontSize: 8, width: 10, textAlign: 'center', flexShrink: 0 }}>
            {isEmpty ? '∅' : isExpanded ? '▾' : '▸'}
          </span>
        ) : (
          <span style={{ color, fontSize: 7, fontWeight: 700, width: 10, textAlign: 'center', flexShrink: 0, letterSpacing: -0.5 }}>
            {icon}
          </span>
        )}
        <span style={{
          color: isActive ? '#10B981' : entry.is_dir ? (isEmpty ? '#4B5563' : '#9CA3AF') : color,
          fontSize: 11,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          opacity: isEmpty ? 0.5 : isActive ? 1 : 0.85,
        }}>
          {entry.name}{entry.is_dir ? '/' : ''}
        </span>
      </div>
      {isExpanded && expandedDirs[entry.path]?.map((child) => (
        <FullscreenFileTreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          expandedDirs={expandedDirs}
          toggleDir={toggleDir}
          onFileClick={onFileClick}
          activeFilePath={activeFilePath}
        />
      ))}
    </>
  );
}

function ProjectConfigView({ projectPath }: { projectPath: string | undefined }) {
  const [config, setConfig] = useState<{ settings_json: any; settings_local_json: any; claude_md: string | null; has_claude_dir: boolean } | null>(null);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    if (projectPath) {
      api.getProjectClaudeConfig(projectPath).then(setConfig).catch(() => setConfig(null));
    }
  }, [projectPath]);

  const reload = () => {
    if (projectPath) api.getProjectClaudeConfig(projectPath).then(setConfig).catch(() => {});
  };

  const handleSave = async () => {
    if (!projectPath || !editingFile) return;
    await api.saveProjectClaudeConfig(projectPath, editingFile, editContent);
    setEditingFile(null);
    reload();
  };

  const handleCreate = async (fileType: string) => {
    if (!projectPath) return;
    const defaults: Record<string, string> = {
      settings: '{\n  \n}',
      local: '{\n  \n}',
      claude_md: '# Project Guidelines\n\n',
    };
    await api.saveProjectClaudeConfig(projectPath, fileType, defaults[fileType] ?? '{}');
    reload();
  };

  if (!projectPath) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span style={{ color: '#4B5563', fontSize: 12 }}>// select a project</span>
      </div>
    );
  }

  const items = [
    { label: '.claude/settings.json', type: 'settings', content: config?.settings_json, isJson: true },
    { label: '.claude/settings.local.json', type: 'local', content: config?.settings_local_json, isJson: true },
    { label: 'CLAUDE.md', type: 'claude_md', content: config?.claude_md, isJson: false },
  ];

  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: '12px 0' }}>
      <div style={{ padding: '4px 16px 12px', color: '#6B7280', fontSize: 11 }}>
        // project config
      </div>
      {items.map(({ label, type, content, isJson }) => {
        const hasContent = content != null;
        const displayText = hasContent ? (isJson ? JSON.stringify(content, null, 2) : content) : null;
        const isEditing = editingFile === type;

        return (
          <div key={type} style={{ padding: '0 16px', marginBottom: 16 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
              <span style={{ color: '#9CA3AF', fontSize: 12 }}>{label}</span>
              {!isEditing && (
                <span
                  onClick={() => {
                    if (hasContent) {
                      setEditingFile(type);
                      setEditContent(displayText!);
                    } else {
                      handleCreate(type);
                    }
                  }}
                  style={{ color: '#6B7280', fontSize: 10, cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#10B981')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
                >
                  {hasContent ? 'edit' : 'create'}
                </span>
              )}
            </div>
            {isEditing ? (
              <div>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={10}
                  style={{
                    width: '100%', background: '#0F0F0F', border: '1px solid #10B981',
                    padding: 10, fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                    color: '#FAFAFA', resize: 'vertical', outline: 'none',
                  }}
                />
                <div className="flex" style={{ gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                  <span onClick={handleSave} style={{ color: '#10B981', fontSize: 11, cursor: 'pointer' }}>save</span>
                  <span onClick={() => setEditingFile(null)} style={{ color: '#6B7280', fontSize: 11, cursor: 'pointer' }}>cancel</span>
                </div>
              </div>
            ) : (
              <div style={{
                background: '#0F0F0F', border: '1px solid #2a2a2a', padding: 10,
                fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                color: hasContent ? '#FAFAFA' : '#4B5563',
                maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap',
              }}>
                {hasContent ? displayText : '(not found)'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function RightPanel() {
  const { projects, activeProjectId, isStreaming } = useAppStore();
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const projectPath = activeProject?.path;

  const rightPanelTab = useAppStore((s) => s.rightPanelTab);
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const activeTab = rightPanelTab;
  const setActiveTab = setRightPanelTab;
  const [branch, setBranch] = useState<string>('');
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [fullscreenDiff, setFullscreenDiff] = useState<DiffResult | null>(null);
  // Explorer state
  const [explorerFiles, setExplorerFiles] = useState<FileEntry[]>([]);
  const [explorerPath, setExplorerPath] = useState<string>('');
  const [expandedDirs, setExpandedDirs] = useState<Record<string, FileEntry[]>>({});
  const [viewingFile, setViewingFile] = useState<FileContent | null>(null);
  const [viewingFilePath, setViewingFilePath] = useState<string | null>(null);
  const [fullscreenFile, setFullscreenFile] = useState<FileContent | null>(null);
  const [commitFeedback, setCommitFeedback] = useState<string | null>(null);
  const [pushFeedback, setPushFeedback] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);

  const prevStreamingRef = useRef(isStreaming);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch branch + status
  const fetchGitData = useCallback(async () => {
    if (!projectPath) return;
    try {
      setGitError(null);
      const [branchName, fileChanges] = await Promise.all([
        api.gitBranch(projectPath),
        api.gitStatus(projectPath),
      ]);
      setBranch(branchName);
      setChanges(fileChanges);
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message ?? 'Unknown error';
      if (msg.toLowerCase().includes('not a git repository') || msg.toLowerCase().includes('not a git repo')) {
        setGitError('not a git repository');
      } else {
        setGitError(msg);
      }
      setBranch('');
      setChanges([]);
    }
  }, [projectPath]);

  // Fetch on mount / project change
  useEffect(() => {
    fetchGitData();

    // Set up 5-second polling
    if (pollRef.current) clearInterval(pollRef.current);
    if (projectPath) {
      pollRef.current = setInterval(fetchGitData, 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchGitData, projectPath]);

  // Load explorer files when tab switches or project changes
  useEffect(() => {
    if (activeTab === 'files' && projectPath) {
      setExplorerPath(projectPath);
      api.listDir(projectPath).then(setExplorerFiles).catch(() => setExplorerFiles([]));
    }
  }, [activeTab, projectPath]);

  const toggleDir = async (dirPath: string) => {
    if (expandedDirs[dirPath]) {
      setExpandedDirs((prev) => {
        const next = { ...prev };
        delete next[dirPath];
        return next;
      });
    } else {
      try {
        const files = await api.listDir(dirPath);
        setExpandedDirs((prev) => ({ ...prev, [dirPath]: files }));
      } catch { /* ignore */ }
    }
  };

  // Esc key closes fullscreen diff
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFullscreenDiff(null);
        setFullscreenFile(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  // Refresh when streaming finishes (true -> false)
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      fetchGitData();
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, fetchGitData]);

  // Load diff when a file is clicked
  const handleFileClick = async (filePath: string) => {
    if (!projectPath) return;
    setSelectedFile(filePath);
    setDiffLoading(true);
    setDiffResult(null);
    try {
      const result = await api.gitDiffFile(projectPath, filePath);
      setDiffResult(result);
    } catch (err) {
      console.error('Failed to load diff:', err);
    } finally {
      setDiffLoading(false);
    }
  };

  // Clear selection when changes update and selected file is gone
  useEffect(() => {
    if (selectedFile && !changes.find((c) => c.path === selectedFile)) {
      setSelectedFile(null);
      setDiffResult(null);
    }
  }, [changes, selectedFile]);

  // Commit
  const handleCommit = async () => {
    if (!projectPath || !commitMsg.trim()) return;
    try {
      const result = await api.gitCommit(projectPath, commitMsg.trim());
      setCommitMsg('');
      setCommitFeedback(result.hash.slice(0, 7));
      setTimeout(() => setCommitFeedback(null), 3000);
      await fetchGitData();
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message ?? 'Commit failed';
      setCommitFeedback(`error: ${msg}`);
      setTimeout(() => setCommitFeedback(null), 4000);
    }
  };

  // Push
  const handlePush = async () => {
    if (!projectPath) return;
    try {
      await api.gitPush(projectPath);
      setPushFeedback('pushed');
      setTimeout(() => setPushFeedback(null), 3000);
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message ?? 'Push failed';
      setPushFeedback(`error: ${msg}`);
      setTimeout(() => setPushFeedback(null), 4000);
    }
  };

  const stagedCount = changes.filter((c) => c.staged).length;
  const unstagedCount = changes.filter((c) => !c.staged).length;

  // No project selected
  if (!projectPath) {
    return (
      <div
        className="flex flex-col h-full items-center justify-center"
        style={{ background: '#0A0A0A', borderLeft: '1px solid #2a2a2a' }}
      >
        <span style={{ color: '#4B5563', fontSize: 12 }}>// no project selected</span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: '#0A0A0A', borderLeft: '1px solid #2a2a2a' }}
    >
      {/* tabs */}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid #2a2a2a' }}>
        {([
          { key: 'git' as const, label: '// changes' },
          { key: 'files' as const, label: '// explorer' },
          { key: 'config' as const, label: '// config' },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              padding: '12px 20px',
              fontSize: 12,
              fontWeight: activeTab === key ? 500 : 400,
              color: activeTab === key ? '#10B981' : '#6B7280',
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${activeTab === key ? '#10B981' : 'transparent'}`,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'git' ? (
        gitError ? (
          <div className="flex-1 flex items-center justify-center">
            <span style={{ color: '#4B5563', fontSize: 12 }}>// {gitError}</span>
          </div>
        ) : (
          <>
            {/* branch info — design: padding [10,16], gap 12, border-bottom */}
            <div
              className="flex items-center shrink-0"
              style={{ padding: '10px 16px', gap: 12, borderBottom: '1px solid #2a2a2a' }}
            >
              <span style={{ color: '#6B7280', fontSize: 12 }}>&#x2387;</span>
              <span style={{ color: '#FAFAFA', fontSize: 12 }}>{branch || '...'}</span>
              <span style={{ color: '#6B7280', fontSize: 10 }}>
                {stagedCount} staged &middot; {unstagedCount} unstaged
              </span>
            </div>

            {/* changes + diff area */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* file list (scrollable, shrinkable) */}
              <div className="shrink-0 overflow-y-auto" style={{ maxHeight: '40%', padding: '8px 0' }}>
                {/* header — design: padding [6,16], space_between */}
                <div className="flex items-center justify-between" style={{ padding: '6px 16px' }}>
                  <span style={{ color: '#6B7280', fontSize: 11 }}>// changes</span>
                  <span style={{ color: '#4B5563', fontSize: 10 }}>[{changes.length}]</span>
                </div>

                {/* file items — design: padding [6,16], gap 8, height 28px */}
                {changes.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center"
                    draggable
                    onDragStart={(e) => {
                      const fullPath = projectPath ? `${projectPath}/${file.path}` : file.path;
                      e.dataTransfer.setData('text/plain', fullPath);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => handleFileClick(file.path)}
                    style={{
                      padding: '6px 16px',
                      gap: 8,
                      background: selectedFile === file.path ? '#1F1F1F' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ color: statusColors[file.status] ?? '#6B7280', fontSize: 10, fontWeight: 500 }}>
                      [{file.status}]
                    </span>
                    <span style={{ color: '#FAFAFA', fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {file.path}
                    </span>
                    <span style={{ color: '#4B5563', fontSize: 10, flexShrink: 0 }}>
                      +{file.additions}{file.deletions > 0 ? ` -${file.deletions}` : ''}
                    </span>
                  </div>
                ))}

                {changes.length === 0 && (
                  <div style={{ padding: '6px 16px' }}>
                    <span style={{ color: '#4B5563', fontSize: 11 }}>// no changes</span>
                  </div>
                )}
              </div>

              {/* Inline diff preview — takes remaining vertical space */}
              <div className="flex-1 flex flex-col inline-diff-wrapper" style={{ borderTop: '1px solid #2a2a2a', minHeight: 0, overflow: 'hidden' }}>
                {diffLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <span style={{ color: '#4B5563', fontSize: 11 }}>// loading diff...</span>
                  </div>
                ) : diffResult ? (
                  <>
                    {/* diff header with expand button */}
                    <div className="flex items-center justify-between shrink-0" style={{ padding: '6px 16px', background: '#0F0F0F' }}>
                      <span style={{ color: '#FAFAFA', fontSize: 11, fontWeight: 500 }}>{diffResult.file_path}</span>
                      <span
                        onClick={() => setFullscreenDiff(diffResult)}
                        style={{ color: '#6B7280', fontSize: 10, cursor: 'pointer' }}
                        title="open side-by-side diff"
                      >
                        ⤢ expand
                      </span>
                    </div>
                    <div className="flex-1" style={{ minHeight: 0 }}>
                      <DiffEditor
                        original={diffResult.original}
                        modified={diffResult.modified}
                        language={diffResult.language}
                        theme="codebook-dark"
                        beforeMount={beforeMount}
                        options={{
                          readOnly: true,
                          renderSideBySide: false,
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 12,
                          lineHeight: 20,
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          overviewRulerLanes: 0,
                          hideCursorInOverviewRuler: true,
                          renderOverviewRuler: false,
                          scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                          glyphMargin: false,
                          folding: false,
                          lineDecorationsWidth: 0,
                          lineNumbersMinChars: 3,
                          renderIndicators: true,
                          renderMarginRevertIcon: false,
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <span style={{ color: '#4B5563', fontSize: 11 }}>
                      {selectedFile ? '// no diff available' : '// click a file to view diff'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* commit feedback */}
            {commitFeedback && (
              <div
                className="shrink-0"
                style={{
                  padding: '4px 16px',
                  fontSize: 10,
                  color: commitFeedback.startsWith('error') ? '#EF4444' : '#10B981',
                  background: '#0F0F0F',
                }}
              >
                {commitFeedback.startsWith('error') ? commitFeedback : `committed ${commitFeedback}`}
              </div>
            )}

            {/* push feedback */}
            {pushFeedback && (
              <div
                className="shrink-0"
                style={{
                  padding: '4px 16px',
                  fontSize: 10,
                  color: pushFeedback.startsWith('error') ? '#EF4444' : '#10B981',
                  background: '#0F0F0F',
                }}
              >
                {pushFeedback}
              </div>
            )}

            {/* commit bar — design: padding [12,16], gap 8, border-top */}
            <div
              className="flex items-center shrink-0"
              style={{ padding: '12px 16px', gap: 8, borderTop: '1px solid #2a2a2a' }}
            >
              <div className="flex items-center flex-1" style={{ padding: '8px 12px', border: '1px solid #2a2a2a' }}>
                <input
                  type="text"
                  placeholder="commit message..."
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCommit();
                  }}
                  style={{
                    background: 'transparent', border: 'none', outline: 'none',
                    color: '#FAFAFA', fontSize: 11, width: '100%', fontFamily: 'inherit',
                  }}
                />
              </div>
              <button
                onClick={handleCommit}
                style={{
                  padding: '8px 14px', background: '#10B981', color: '#0A0A0A',
                  fontSize: 11, fontWeight: 500, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                commit
              </button>
              <button
                onClick={handlePush}
                style={{
                  padding: '8px 14px', border: '1px solid #2a2a2a', background: 'transparent',
                  color: '#FAFAFA', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                push
              </button>
            </div>
          </>
        )
      ) : activeTab === 'files' ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* file tree (scrollable, up to 40%) */}
          <div className="shrink-0 overflow-y-auto" style={{ maxHeight: viewingFile ? '40%' : '100%', padding: '8px 0' }}>
            <div className="flex items-center justify-between" style={{ padding: '6px 16px' }}>
              <span style={{ color: '#6B7280', fontSize: 11 }}>// files</span>
              <span style={{ color: '#4B5563', fontSize: 10 }}>
                {explorerPath.split('/').pop()}
              </span>
            </div>
            {explorerFiles.map((entry) => (
              <FileTreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                expandedDirs={expandedDirs}
                toggleDir={toggleDir}
                onFileClick={async (path) => {
                  setViewingFilePath(path);
                  try {
                    const fc = await api.readFileContent(path);
                    setViewingFile(fc);
                  } catch (err: any) {
                    setViewingFile({ path, content: `// error: ${err}`, language: 'plaintext', size: 0 });
                  }
                }}
                activeFilePath={viewingFilePath}
              />
            ))}
            {explorerFiles.length === 0 && (
              <div style={{ padding: '12px 16px', color: '#4B5563', fontSize: 11 }}>// empty</div>
            )}
          </div>

          {/* file viewer — Monaco editor */}
          {viewingFile && (
            <div className="flex-1 flex flex-col" style={{ borderTop: '1px solid #2a2a2a', minHeight: 0 }}>
              {/* file header */}
              <div className="flex items-center justify-between shrink-0" style={{ padding: '6px 16px', background: '#0F0F0F' }}>
                <div className="flex items-center" style={{ gap: 8 }}>
                  <span style={{ color: '#FAFAFA', fontSize: 11, fontWeight: 500 }}>
                    {viewingFile.path.split('/').pop()}
                  </span>
                  <span style={{ color: '#4B5563', fontSize: 9 }}>
                    {viewingFile.language} · {viewingFile.size > 1024 ? `${(viewingFile.size / 1024).toFixed(1)}kb` : `${viewingFile.size}b`}
                  </span>
                </div>
                <div className="flex items-center" style={{ gap: 8 }}>
                  <span
                    onClick={() => setFullscreenFile(viewingFile)}
                    style={{ color: '#6B7280', fontSize: 10, cursor: 'pointer' }}
                  >
                    ⤢ expand
                  </span>
                  <span
                    onClick={() => { setViewingFile(null); setViewingFilePath(null); }}
                    style={{ color: '#6B7280', fontSize: 10, cursor: 'pointer' }}
                  >
                    ×
                  </span>
                </div>
              </div>
              <div className="flex-1" style={{ minHeight: 0 }}>
                <Editor
                  value={viewingFile.content}
                  language={viewingFile.language}
                  theme="codebook-dark"
                  beforeMount={beforeMount}
                  options={{
                    readOnly: true,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12,
                    lineHeight: 20,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    overviewRulerLanes: 0,
                    scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                    glyphMargin: false,
                    folding: true,
                    lineDecorationsWidth: 0,
                    lineNumbersMinChars: 3,
                    renderLineHighlight: 'line',
                  }}
                />
              </div>
            </div>
          )}
        </div>

      ) : activeTab === 'config' ? (
        <ProjectConfigView projectPath={projectPath} />
      ) : null}

      {/* fullscreen file viewer — VS Code style with sidebar */}
      {fullscreenFile && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column' }}
          onClick={() => setFullscreenFile(null)}
        >
          <div
            style={{ flex: 1, margin: 16, background: '#0A0A0A', border: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* top bar */}
            <div className="flex items-center justify-between shrink-0" style={{ padding: '8px 16px', borderBottom: '1px solid #2a2a2a', background: '#0F0F0F' }}>
              <div className="flex items-center" style={{ gap: 8 }}>
                <span style={{ color: '#10B981', fontSize: 11, fontWeight: 700 }}>{'>'}</span>
                <span style={{ color: '#FAFAFA', fontSize: 12, fontWeight: 600 }}>{fullscreenFile.path.split('/').pop()}</span>
                <span style={{ color: '#4B5563', fontSize: 10 }}>{fullscreenFile.language}</span>
                <span style={{ color: '#333', fontSize: 10 }}>│</span>
                <span style={{ color: '#4B5563', fontSize: 10 }}>
                  {fullscreenFile.path.replace(projectPath + '/', '')}
                </span>
              </div>
              <span onClick={() => setFullscreenFile(null)} style={{ color: '#6B7280', fontSize: 11, cursor: 'pointer' }}>[esc]</span>
            </div>

            {/* body: sidebar + editor */}
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* file sidebar */}
              <div style={{ width: 220, borderRight: '1px solid #2a2a2a', overflowY: 'auto', padding: '8px 0', flexShrink: 0 }}>
                <div style={{ padding: '4px 12px 6px', color: '#6B7280', fontSize: 10 }}>// explorer</div>
                {explorerFiles.map((entry) => (
                  <FullscreenFileTreeNode
                    key={entry.path}
                    entry={entry}
                    depth={0}
                    expandedDirs={expandedDirs}
                    toggleDir={toggleDir}
                    activeFilePath={fullscreenFile.path}
                    onFileClick={async (path) => {
                      try {
                        const fc = await api.readFileContent(path);
                        setFullscreenFile(fc);
                        setViewingFile(fc);
                        setViewingFilePath(path);
                      } catch (err: any) {
                        setFullscreenFile({ path, content: `// error: ${err}`, language: 'plaintext', size: 0 });
                      }
                    }}
                  />
                ))}
              </div>

              {/* editor */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Editor
                  key={fullscreenFile.path}
                  value={fullscreenFile.content}
                  language={fullscreenFile.language}
                  theme="codebook-dark"
                  beforeMount={beforeMount}
                  options={{
                    readOnly: true,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 13,
                    lineHeight: 22,
                    minimap: { enabled: true, maxColumn: 80 },
                    scrollBeyondLastLine: false,
                    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                    glyphMargin: false,
                    folding: true,
                    lineNumbersMinChars: 4,
                    renderLineHighlight: 'line',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* fullscreen side-by-side diff modal with file navigation */}
      {fullscreenDiff && (() => {
        const currentIdx = changes.findIndex((c) => c.path === fullscreenDiff.file_path);
        const hasPrev = currentIdx > 0;
        const hasNext = currentIdx < changes.length - 1 && currentIdx >= 0;
        const navTo = async (idx: number) => {
          if (!projectPath || idx < 0 || idx >= changes.length) return;
          try {
            const result = await api.gitDiffFile(projectPath, changes[idx].path);
            setFullscreenDiff(result);
            setSelectedFile(changes[idx].path);
          } catch { /* ignore */ }
        };
        return (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column' }}
            onClick={() => setFullscreenDiff(null)}
          >
            <div
              style={{ flex: 1, margin: 24, background: '#0A0A0A', border: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* modal header with prev/next navigation */}
              <div
                className="flex items-center justify-between shrink-0"
                style={{ padding: '8px 20px', borderBottom: '1px solid #2a2a2a', background: '#0F0F0F' }}
              >
                {/* left: navigation + filename */}
                <div className="flex items-center" style={{ gap: 10 }}>
                  <button
                    onClick={() => hasPrev && navTo(currentIdx - 1)}
                    style={{
                      background: 'transparent', border: '1px solid #2a2a2a', color: hasPrev ? '#FAFAFA' : '#4B5563',
                      padding: '4px 8px', cursor: hasPrev ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 11,
                    }}
                  >
                    ← prev
                  </button>
                  <span style={{ color: '#FAFAFA', fontSize: 13, fontWeight: 600 }}>
                    {fullscreenDiff.file_path}
                  </span>
                  <span style={{ color: '#4B5563', fontSize: 10 }}>
                    {currentIdx >= 0 ? `${currentIdx + 1}/${changes.length}` : ''}
                  </span>
                  <button
                    onClick={() => hasNext && navTo(currentIdx + 1)}
                    style={{
                      background: 'transparent', border: '1px solid #2a2a2a', color: hasNext ? '#FAFAFA' : '#4B5563',
                      padding: '4px 8px', cursor: hasNext ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 11,
                    }}
                  >
                    next →
                  </button>
                </div>
                {/* right: labels + close */}
                <div className="flex items-center" style={{ gap: 12 }}>
                  <span style={{ color: '#6B7280', fontSize: 11 }}>original</span>
                  <span style={{ color: '#4B5563' }}>│</span>
                  <span style={{ color: '#10B981', fontSize: 11 }}>modified</span>
                  <span
                    onClick={() => setFullscreenDiff(null)}
                    style={{ color: '#6B7280', fontSize: 11, cursor: 'pointer', marginLeft: 4 }}
                  >
                    [esc]
                  </span>
                </div>
              </div>
              {/* side-by-side diff editor */}
              <div style={{ flex: 1, minHeight: 0 }}>
                <DiffEditor
                  key={fullscreenDiff.file_path}
                  original={fullscreenDiff.original}
                  modified={fullscreenDiff.modified}
                  language={fullscreenDiff.language}
                  theme="codebook-dark"
                  beforeMount={beforeMount}
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 13,
                    lineHeight: 22,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    overviewRulerLanes: 0,
                    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                    glyphMargin: false,
                    folding: true,
                    lineNumbersMinChars: 4,
                    renderIndicators: true,
                    renderMarginRevertIcon: false,
                  }}
                />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
