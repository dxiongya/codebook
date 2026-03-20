import { useState, useEffect, useRef, useCallback } from 'react';
import { DiffEditor, Editor } from '@monaco-editor/react';
import { Checkbox as BaseCheckbox } from '@base-ui-components/react/checkbox';
import { GitBranch, GitCommitHorizontal, GitPullRequest, GitMerge, LayoutGrid, Folder, FolderOpen, Sparkles, ArrowUp, ArrowDown, RefreshCw, History, ChevronDown, File, FileJson, FileText, FileCode, Image, Hash, Plus, Undo2, Check } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import * as api from '../../lib/api';
import type { FileChange, DiffResult, FileEntry, FileContent } from '../../types';

type GitSubTab = 'commit' | 'update' | 'pr' | 'worktree';

// ─── Base UI Checkbox styled for dark theme ─────────────────────────────────
function StyledCheckbox({ checked, onChange, color }: { checked: boolean; onChange: (v: boolean) => void; color: string }) {
  return (
    <BaseCheckbox.Root
      checked={checked}
      onCheckedChange={onChange}
      style={{
        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
        border: `1.5px solid ${checked ? color : 'var(--cb-text-dim)'}`,
        background: checked ? color : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', padding: 0,
      }}
    >
      <BaseCheckbox.Indicator>
        <Check size={10} style={{ color: 'var(--cb-bg-primary)', strokeWidth: 3 }} />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}

const statusColors: Record<string, string> = {
  M: '#F59E0B',
  A: '#10B981',
  D: '#EF4444',
  '?': '#6B7280',
};

function FileTypeIcon({ filename, size = 12 }: { filename: string; size?: number }) {
  if (filename.endsWith('/')) return <Folder size={size} style={{ color: '#E5A54B' }} />;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const iconMap: Record<string, { icon: React.ReactNode }> = {
    ts: { icon: <FileCode size={size} style={{ color: '#3178C6' }} /> },
    tsx: { icon: <FileCode size={size} style={{ color: '#3178C6' }} /> },
    js: { icon: <FileCode size={size} style={{ color: '#F59E0B' }} /> },
    jsx: { icon: <FileCode size={size} style={{ color: '#F59E0B' }} /> },
    json: { icon: <FileJson size={size} style={{ color: '#E5A54B' }} /> },
    css: { icon: <Hash size={size} style={{ color: '#A78BFA' }} /> },
    scss: { icon: <Hash size={size} style={{ color: '#A78BFA' }} /> },
    md: { icon: <FileText size={size} style={{ color: '#60A5FA' }} /> },
    html: { icon: <FileCode size={size} style={{ color: '#E34F26' }} /> },
    py: { icon: <FileCode size={size} style={{ color: '#3572A5' }} /> },
    rs: { icon: <FileCode size={size} style={{ color: '#DEA584' }} /> },
    toml: { icon: <FileText size={size} style={{ color: 'var(--cb-text-muted)' }} /> },
    yaml: { icon: <FileText size={size} style={{ color: 'var(--cb-text-muted)' }} /> },
    yml: { icon: <FileText size={size} style={{ color: 'var(--cb-text-muted)' }} /> },
    lock: { icon: <File size={size} style={{ color: 'var(--cb-text-dim)' }} /> },
    log: { icon: <FileText size={size} style={{ color: 'var(--cb-text-dim)' }} /> },
    pen: { icon: <File size={size} style={{ color: '#E5A54B' }} /> },
    png: { icon: <Image size={size} style={{ color: '#4ADE80' }} /> },
    jpg: { icon: <Image size={size} style={{ color: '#4ADE80' }} /> },
    svg: { icon: <Image size={size} style={{ color: '#E5A54B' }} /> },
    gif: { icon: <Image size={size} style={{ color: '#4ADE80' }} /> },
    webp: { icon: <Image size={size} style={{ color: '#4ADE80' }} /> },
  };
  return <>{iconMap[ext]?.icon ?? <File size={size} style={{ color: 'var(--cb-text-dim)' }} />}</>;
}

const beforeMount = (monaco: any) => {
  const bgCode = getComputedStyle(document.documentElement).getPropertyValue('--cb-bg-code').trim() || '#171412';
  monaco.editor.defineTheme('codebook-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': bgCode,
      'editor.lineHighlightBackground': '#1F1F1F',
      'editorLineNumber.foreground': '#4B5563',
      'editorGutter.background': bgCode,
      'diffEditor.insertedTextBackground': '#10B98118',
      'diffEditor.removedTextBackground': '#EF444418',
      'diffEditor.insertedLineBackground': '#10B98110',
      'diffEditor.removedLineBackground': '#EF444410',
    },
  });
};

// File type icon using lucide icons + text labels
function fileIcon(name: string, isDir: boolean): { icon: React.ReactNode; color: string; isLucide: boolean } {
  if (isDir) return { icon: <Folder size={13} />, color: '#6B7280', isLucide: true };
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  // Extensions that get lucide icons
  const lucideMap: Record<string, { icon: React.ReactNode; color: string }> = {
    json: { icon: <FileJson size={13} />, color: '#10B981' },
    yaml: { icon: <FileText size={13} />, color: '#10B981' },
    yml: { icon: <FileText size={13} />, color: '#10B981' },
    toml: { icon: <FileText size={13} />, color: '#10B981' },
    md: { icon: <FileText size={13} />, color: '#9CA3AF' },
    txt: { icon: <FileText size={13} />, color: '#9CA3AF' },
    html: { icon: <FileCode size={13} />, color: '#F97316' },
    xml: { icon: <FileCode size={13} />, color: '#F97316' },
    svg: { icon: <FileCode size={13} />, color: '#F59E0B' },
    png: { icon: <Image size={13} />, color: '#10B981' },
    jpg: { icon: <Image size={13} />, color: '#10B981' },
    jpeg: { icon: <Image size={13} />, color: '#10B981' },
    gif: { icon: <Image size={13} />, color: '#10B981' },
    css: { icon: <Hash size={13} />, color: '#a78bfa' },
    scss: { icon: <Hash size={13} />, color: '#a78bfa' },
    lock: { icon: <File size={13} />, color: '#4B5563' },
  };
  if (lucideMap[ext]) return { ...lucideMap[ext], isLucide: true };
  // Extensions that get text labels
  const textMap: Record<string, { label: string; color: string }> = {
    ts: { label: 'TS', color: '#06B6D4' },
    tsx: { label: 'TX', color: '#06B6D4' },
    js: { label: 'JS', color: '#F59E0B' },
    jsx: { label: 'JX', color: '#F59E0B' },
    py: { label: 'PY', color: '#3B82F6' },
    rs: { label: 'RS', color: '#F97316' },
    go: { label: 'GO', color: '#06B6D4' },
    env: { label: '~', color: '#F59E0B' },
    sh: { label: '$', color: '#10B981' },
    sql: { label: 'Q', color: '#3B82F6' },
  };
  if (textMap[ext]) return { icon: textMap[ext].label, color: textMap[ext].color, isLucide: false };
  return { icon: <File size={13} />, color: '#4B5563', isLucide: true };
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
  const { icon, color, isLucide } = fileIcon(entry.name, entry.is_dir);
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
            color: isEmpty ? '#333' : '#E5A54B',
            fontSize: 9,
            width: 14,
            textAlign: 'center',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {isEmpty ? '∅' : isExpanded ? <FolderOpen size={13} style={{ color: '#E5A54B' }} /> : <Folder size={13} style={{ color: '#E5A54B' }} />}
          </span>
        ) : isLucide ? (
          <span style={{
            color,
            width: 14,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {icon}
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
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {icon}
          </span>
        )}
        <span style={{
          color: entry.is_dir ? (isEmpty ? '#4B5563' : '#FAFAFA') : color,
          fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          opacity: isEmpty ? 0.4 : entry.is_dir ? 1 : 0.85,
        }}>
          {entry.name}{entry.is_dir ? '/' : ''}
        </span>
        {entry.is_dir && entry.child_count != null && (
          <span style={{ color: isEmpty ? '#333' : '#3A3530', fontSize: 9, flexShrink: 0 }}>
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
  const { icon, color, isLucide } = fileIcon(entry.name, entry.is_dir);
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
          borderLeft: isActive ? '2px solid #E5A54B' : '2px solid transparent',
        }}
      >
        {entry.is_dir ? (
          <span style={{ color: isEmpty ? '#333' : '#6B7280', fontSize: 8, width: 10, textAlign: 'center', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isEmpty ? '∅' : isExpanded ? <FolderOpen size={11} /> : <Folder size={11} />}
          </span>
        ) : isLucide ? (
          <span style={{ color, width: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {typeof icon === 'string' ? icon : <span style={{ transform: 'scale(0.85)' }}>{icon}</span>}
          </span>
        ) : (
          <span style={{ color, fontSize: 7, fontWeight: 700, width: 10, textAlign: 'center', flexShrink: 0, letterSpacing: -0.5 }}>
            {icon}
          </span>
        )}
        <span style={{
          color: isActive ? '#E5A54B' : entry.is_dir ? (isEmpty ? '#4B5563' : '#9CA3AF') : color,
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
        <span style={{ color: '#4B5563', fontSize: 12 }}>Select a project</span>
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
      <div style={{ padding: '4px 16px 12px', color: '#9CA3AF', fontSize: 11, fontWeight: 500, fontFamily: 'Inter, system-ui, sans-serif' }}>
        Project Config
      </div>
      {items.map(({ label, type, content, isJson }) => {
        const hasContent = content != null;
        const displayText = hasContent ? (isJson ? JSON.stringify(content, null, 2) : content) : null;
        const isEditing = editingFile === type;

        return (
          <div key={type} style={{ padding: '0 16px', marginBottom: 16 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
              <div className="flex items-center" style={{ gap: 6 }}>
                <FileText size={12} style={{ color: '#4B5563', flexShrink: 0 }} />
                <span style={{ color: '#9CA3AF', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
              </div>
              {!isEditing && (
                hasContent ? (
                  <span
                    onClick={() => {
                      setEditingFile(type);
                      setEditContent(displayText!);
                    }}
                    style={{ color: '#6B7280', fontSize: 10, cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#E5A54B')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
                  >
                    edit
                  </span>
                ) : (
                  <span
                    onClick={() => handleCreate(type)}
                    className="flex items-center"
                    style={{
                      color: '#E5A54B',
                      fontSize: 10,
                      cursor: 'pointer',
                      gap: 3,
                      padding: '2px 8px',
                      border: '1px solid #3A3530',
                      borderRadius: 4,
                      background: '#1F1B17',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--cb-border)'; e.currentTarget.style.borderColor = '#E5A54B'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#1F1B17'; e.currentTarget.style.borderColor = '#3A3530'; }}
                  >
                    <Plus size={10} />
                    Create
                  </span>
                )
              )}
            </div>
            {isEditing ? (
              <div>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={10}
                  style={{
                    width: '100%', background: 'var(--cb-bg-code)', border: '1px solid #E5A54B',
                    padding: 10, fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                    color: '#FAFAFA', resize: 'vertical', outline: 'none',
                  }}
                />
                <div className="flex" style={{ gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                  <span onClick={handleSave} style={{ color: '#E5A54B', fontSize: 11, cursor: 'pointer' }}>save</span>
                  <span onClick={() => setEditingFile(null)} style={{ color: '#6B7280', fontSize: 11, cursor: 'pointer' }}>cancel</span>
                </div>
              </div>
            ) : (
              <div style={{
                background: 'var(--cb-bg-code)', border: `1px solid ${hasContent ? 'var(--cb-border)' : 'var(--cb-border)'}`, padding: 10,
                fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                color: hasContent ? '#FAFAFA' : '#4B5563',
                maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap',
                borderStyle: hasContent ? 'solid' : 'dashed',
              }}>
                {hasContent ? displayText : (
                  <span className="flex items-center justify-center" style={{ gap: 6, padding: '8px 0', color: '#4B5563', fontSize: 11 }}>
                    File not found
                  </span>
                )}
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
  const [branches, setBranches] = useState<string[]>([]);
  const [gitRepos, setGitRepos] = useState<api.GitRepo[]>([]);
  const [stagedFiles, setStagedFiles] = useState<Set<string>>(new Set());
  const [fileListHeight, setFileListHeight] = useState(250);
  const diffDragRef = useRef<{ startY: number; startH: number } | null>(null);
  const [activeRepoPath, setActiveRepoPath] = useState<string>('');
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

  // Discover git repos on project change
  useEffect(() => {
    if (!projectPath) { setGitRepos([]); setActiveRepoPath(''); return; }
    api.discoverGitRepos(projectPath).then((repos) => {
      setGitRepos(repos);
      if (repos.length > 0 && !activeRepoPath) setActiveRepoPath(repos[0].path);
    }).catch(() => setGitRepos([]));
  }, [projectPath]);

  // The effective git path: use activeRepoPath if set, otherwise projectPath
  const effectiveGitPath = activeRepoPath || projectPath || '';

  // Fetch branch + status
  const fetchGitData = useCallback(async () => {
    if (!effectiveGitPath) return;
    try {
      setGitError(null);
      const [branchName, fileChanges, branchList] = await Promise.all([
        api.gitBranch(effectiveGitPath),
        api.gitStatus(effectiveGitPath),
        api.gitListBranches(effectiveGitPath).catch(() => [] as string[]),
      ]);
      setBranch(branchName);
      setChanges(fileChanges);
      setBranches(branchList);
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message ?? 'Unknown error';
      if (msg.toLowerCase().includes('not a git repository') || msg.toLowerCase().includes('not a git repo')) {
        setGitError('not a git repository');
      } else {
        setGitError(msg);
      }
      setBranch('');
      setChanges([]);
      setBranches([]);
    }
  }, [effectiveGitPath]);

  // Fetch on mount / project change / repo switch
  useEffect(() => {
    fetchGitData();

    if (pollRef.current) clearInterval(pollRef.current);
    if (effectiveGitPath) {
      pollRef.current = setInterval(fetchGitData, 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchGitData, effectiveGitPath]);

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

  // Auto-stage all files when changes list updates
  useEffect(() => {
    setStagedFiles(new Set(changes.map((c) => c.path)));
  }, [changes]);

  const toggleStaged = useCallback((path: string) => {
    setStagedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleAllStaged = useCallback(() => {
    setStagedFiles((prev) => {
      if (prev.size === changes.length) return new Set();
      return new Set(changes.map((c) => c.path));
    });
  }, [changes]);

  const stagedCount = stagedFiles.size;

  // Drag to resize file list vs diff area
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!diffDragRef.current) return;
      const delta = e.clientY - diffDragRef.current.startY;
      setFileListHeight(Math.max(80, Math.min(600, diffDragRef.current.startH + delta)));
    };
    const onMouseUp = () => {
      if (diffDragRef.current) {
        diffDragRef.current = null;
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

  // Commit
  const handleCommit = async () => {
    if (!projectPath || !commitMsg.trim() || stagedCount === 0) return;
    try {
      const filesToStage = stagedCount === changes.length ? undefined : Array.from(stagedFiles);
      const result = await api.gitCommit(projectPath, commitMsg.trim(), filesToStage);
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

  // No project selected
  if (!projectPath) {
    return (
      <div
        className="flex flex-col h-full items-center justify-center"
        style={{ background: 'var(--cb-bg-sidebar)', borderLeft: '1px solid var(--cb-border)' }}
      >
        <span style={{ color: '#4B5563', fontSize: 12 }}>// no project selected</span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--cb-bg-sidebar)', borderLeft: '1px solid var(--cb-border)' }}
    >
      {/* tabs — pill style (design: h44, gap 4) */}
      <div className="flex items-center shrink-0" style={{ height: 40, padding: '0 12px', gap: 2, borderBottom: '1px solid var(--cb-border)' }}>
        {([
          { key: 'git' as const, label: 'Git', icon: <GitBranch size={12} /> },
          { key: 'files' as const, label: 'Files', icon: <Folder size={12} /> },
        ]).map(({ key, label, icon }) => {
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: '4px 12px',
                fontSize: 11,
                fontWeight: isActive ? 500 : 400,
                color: isActive ? 'var(--cb-text-primary)' : 'var(--cb-text-muted)',
                background: isActive ? 'var(--cb-bg-active)' : 'transparent',
                border: isActive ? '1px solid var(--cb-border)' : '1px solid transparent',
                borderRadius: 5,
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              {icon}
              {label}
            </button>
          );
        })}
      </div>

      {activeTab === 'git' ? (
        gitError ? (
          <div className="flex-1 flex items-center justify-center">
            <span style={{ color: 'var(--cb-text-dim)', fontSize: 12 }}>// {gitError}</span>
          </div>
        ) : (
          <>
            {/* branch selector row (design: h32) */}
            <div className="flex items-center shrink-0" style={{ padding: '6px 14px', gap: 6 }}>
              <GitBranch size={13} style={{ color: '#E5A54B', flexShrink: 0 }} />
              <div style={{ position: 'relative' }}>
                <select
                  value={branch}
                  onChange={async (e) => {
                    const newBranch = e.target.value;
                    try {
                      await api.gitCheckout(effectiveGitPath, newBranch);
                      setBranch(newBranch);
                      fetchGitData();
                    } catch (err: any) {
                      console.error('checkout failed:', err);
                    }
                  }}
                  style={{
                    appearance: 'none', WebkitAppearance: 'none',
                    background: 'transparent', border: 'none',
                    padding: '0 16px 0 0',
                    color: 'var(--cb-text-primary)', fontSize: 12, fontWeight: 600,
                    fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
                  }}
                >
                  {[...new Set([...(branch ? [branch] : []), ...branches])].map((b) => (
                    <option key={b} value={b} style={{ background: 'var(--cb-bg-primary)' }}>{b}</option>
                  ))}
                </select>
                <ChevronDown size={12} style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', color: 'var(--cb-text-muted)', pointerEvents: 'none' }} />
              </div>
            </div>

            {/* action icons row (design: h28) */}
            <div className="flex items-center justify-between shrink-0" style={{ padding: '2px 14px 6px' }}>
              <div className="flex items-center" style={{ gap: 10 }}>
                <RefreshCw size={13} style={{ color: 'var(--cb-text-muted)', cursor: 'pointer' }} onClick={fetchGitData} />
                <ArrowDown size={13} style={{ color: 'var(--cb-text-muted)', cursor: 'pointer' }} />
                <ArrowUp size={13} style={{ color: 'var(--cb-text-muted)', cursor: 'pointer' }} onClick={handlePush} />
                <History size={13} style={{ color: 'var(--cb-text-muted)', cursor: 'pointer' }} />
              </div>
              {gitRepos.length > 1 && (
                <select
                  value={activeRepoPath}
                  onChange={(e) => setActiveRepoPath(e.target.value)}
                  style={{
                    appearance: 'none', background: 'transparent', border: 'none',
                    color: '#E5A54B', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
                  }}
                >
                  {gitRepos.map((r) => (
                    <option key={r.path} value={r.path}>{r.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* git sub-tabs (design: h37, font 11) */}
            <div className="flex items-center shrink-0" style={{ padding: '4px 12px', gap: 2, borderBottom: '1px solid var(--cb-border)' }}>
              {([
                { key: 'commit' as GitSubTab, label: 'Commit', icon: <GitCommitHorizontal size={11} /> },
                { key: 'update' as GitSubTab, label: 'Update', icon: <GitPullRequest size={11} /> },
                { key: 'pr' as GitSubTab, label: 'PR', icon: <GitMerge size={11} /> },
                { key: 'worktree' as GitSubTab, label: 'Worktree', icon: <LayoutGrid size={11} /> },
              ]).map(({ key, label, icon }) => {
                const active = useAppStore.getState().gitSubTab === key;
                return (
                  <button
                    key={key}
                    onClick={() => useAppStore.getState().setGitSubTab(key)}
                    style={{
                      padding: '4px 10px', fontSize: 11,
                      fontWeight: active ? 500 : 400,
                      color: active ? 'var(--cb-text-primary)' : 'var(--cb-text-muted)',
                      background: active ? 'var(--cb-bg-active)' : 'transparent',
                      border: active ? '1px solid var(--cb-border)' : '1px solid transparent',
                      borderRadius: 5,
                      cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    {icon}{label}
                  </button>
                );
              })}
            </div>

            {/* Commit sub-tab content */}
            {useAppStore.getState().gitSubTab === 'commit' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* changes header (design: h36) */}
              <div className="flex items-center justify-between shrink-0" style={{ padding: '8px 14px 6px' }}>
                <div className="flex items-center" style={{ gap: 6 }}>
                  <span style={{ color: 'var(--cb-text-primary)', fontSize: 12, fontWeight: 700 }}>Changes</span>
                  <StyledCheckbox
                    checked={stagedCount === changes.length && changes.length > 0}
                    onChange={toggleAllStaged}
                    color="#E5A54B"
                  />
                  <span style={{ color: 'var(--cb-text-muted)', fontSize: 11 }}>{stagedCount}/{changes.length}</span>
                </div>
                <span style={{ color: '#E5A54B', fontSize: 11, cursor: 'pointer' }}>Revert all</span>
              </div>

              {/* file list (scrollable, resizable) */}
              <div className="shrink-0 overflow-y-auto" style={{ height: fileListHeight, padding: '0 8px' }}>
                {changes.map((file) => {
                  const statusColor = statusColors[file.status] ?? 'var(--cb-text-dim)';
                  const fileName = file.path.includes('/') ? file.path.split('/').pop() : file.path;
                  const dirPath = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : '';

                  return (
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
                        padding: '4px 6px', gap: 6,
                        background: selectedFile === file.path ? 'var(--cb-bg-active)' : 'transparent',
                        cursor: 'pointer', borderRadius: 3,
                      }}
                    >
                      <StyledCheckbox
                        checked={stagedFiles.has(file.path)}
                        onChange={() => toggleStaged(file.path)}
                        color={statusColor}
                      />
                      <span style={{ color: statusColor, fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                        {file.status}
                      </span>
                      <span style={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <FileTypeIcon filename={file.path} size={12} />
                      </span>
                      {dirPath && <span style={{ color: 'var(--cb-text-dim)', fontSize: 11, flexShrink: 0, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dirPath}</span>}
                      <span style={{ color: 'var(--cb-text-primary)', fontSize: 11, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fileName}
                      </span>
                      <span style={{ color: '#4ADE80', fontSize: 10, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                        +{file.additions}/{file.deletions > 0 ? `-${file.deletions}` : '-0'}
                      </span>
                      <Undo2 size={11} style={{ color: 'var(--cb-text-dim)', flexShrink: 0 }} />
                    </div>
                  );
                })}

                {changes.length === 0 && (
                  <div style={{ padding: '12px 8px', color: 'var(--cb-text-dim)', fontSize: 11 }}>// no changes</div>
                )}
              </div>

              {/* Resize handle */}
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  diffDragRef.current = { startY: e.clientY, startH: fileListHeight };
                  document.body.style.cursor = 'row-resize';
                  document.body.style.userSelect = 'none';
                }}
                className="shrink-0 group"
                style={{ height: 3, cursor: 'row-resize', position: 'relative', background: 'var(--cb-border)' }}
              >
                <div className="absolute inset-0 transition-colors duration-100 group-hover:bg-[#E5A54B]" />
              </div>

              {/* Inline diff preview — takes remaining vertical space */}
              <div className="flex-1 flex flex-col inline-diff-wrapper" style={{ minHeight: 0, overflow: 'hidden' }}>
                {diffLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <span style={{ color: '#4B5563', fontSize: 11 }}>// loading diff...</span>
                  </div>
                ) : diffResult ? (
                  <>
                    {/* diff header with expand button */}
                    <div className="flex items-center justify-between shrink-0" style={{ padding: '6px 16px', background: 'var(--cb-bg-code)' }}>
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
                    <span style={{ color: 'var(--cb-text-dim)', fontSize: 11 }}>
                      {selectedFile ? 'No diff available' : 'Select a file to view diff'}
                    </span>
                  </div>
                )}
              </div>

            {/* commit section (design: padding 12x16, gap 10) */}
            <div className="flex flex-col shrink-0" style={{ padding: '10px 14px', gap: 8, borderTop: '1px solid var(--cb-border)' }}>
              {/* header */}
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--cb-text-primary)', fontSize: 12, fontWeight: 700 }}>Commit</span>
                <span style={{ color: 'var(--cb-text-muted)', fontSize: 10 }}>{stagedCount} files selected</span>
              </div>

              {/* commit message input */}
              <div style={{ padding: '6px 10px', border: '1px solid var(--cb-border)', borderRadius: 6, background: 'var(--cb-bg-elevated)' }}>
                <input
                  type="text"
                  placeholder="commit message..."
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCommit(); }}
                  style={{
                    background: 'transparent', border: 'none', outline: 'none',
                    color: 'var(--cb-text-primary)', fontSize: 11, width: '100%', fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* feedback */}
              {commitFeedback && (
                <div style={{ fontSize: 11, color: commitFeedback.startsWith('error') ? '#EF4444' : '#E5A54B' }}>
                  {commitFeedback.startsWith('error') ? commitFeedback : `✓ committed ${commitFeedback}`}
                </div>
              )}
              {pushFeedback && (
                <div style={{ fontSize: 11, color: pushFeedback.startsWith('error') ? '#EF4444' : '#E5A54B' }}>
                  {pushFeedback}
                </div>
              )}

              {/* action buttons */}
              <div className="flex" style={{ gap: 6 }}>
                <button
                  onClick={() => {/* generate - placeholder */}}
                  style={{
                    padding: '5px 10px', background: 'transparent', border: '1px solid var(--cb-border)',
                    color: 'var(--cb-text-primary)', fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                    borderRadius: 5, display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  <Sparkles size={11} style={{ color: '#E5A54B' }} />
                  Generate
                </button>
                <button
                  onClick={handleCommit}
                  style={{
                    padding: '5px 10px', background: 'transparent', border: '1px solid var(--cb-border)',
                    color: 'var(--cb-text-primary)', fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                    borderRadius: 5, display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  <GitCommitHorizontal size={11} />
                  Commit
                </button>
                <button
                  onClick={handlePush}
                  style={{
                    padding: '5px 10px', background: '#E5A54B',
                    color: 'var(--cb-bg-primary)', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    borderRadius: 5, display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  <ArrowUp size={11} />
                  Push
                </button>
              </div>
            </div>
            </div>
            )}

            {/* Update sub-tab */}
            {useAppStore.getState().gitSubTab === 'update' && (
              <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
                <div className="flex items-center" style={{ gap: 8, padding: '12px 14px', borderRadius: 8, background: 'var(--cb-bg-elevated)', marginBottom: 16 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ADE80' }} />
                  <span style={{ color: '#4ADE80', fontSize: 12 }}>Up to date with origin/{branch || 'main'}</span>
                </div>
                <span style={{ color: 'var(--cb-text-primary)', fontSize: 13, fontWeight: 700 }}>Recent Pulls</span>
                <div style={{ marginTop: 12, color: 'var(--cb-text-dim)', fontSize: 12 }}>No recent pull history</div>
              </div>
            )}

            {/* PR sub-tab */}
            {useAppStore.getState().gitSubTab === 'pr' && (
              <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
                <div className="flex items-center" style={{ gap: 8, padding: '12px 14px', borderRadius: 8, background: 'var(--cb-bg-elevated)', border: '1px solid var(--cb-border)', marginBottom: 16 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ADE80' }} />
                  <span style={{ color: 'var(--cb-text-primary)', fontSize: 13, fontWeight: 600 }}>Create Pull Request</span>
                </div>
                <div style={{ color: 'var(--cb-text-dim)', fontSize: 12, lineHeight: 1.6 }}>
                  PR creation will be available in a future update. For now, use the Git CLI or your Git provider's web interface.
                </div>
              </div>
            )}

            {/* Worktree sub-tab */}
            {useAppStore.getState().gitSubTab === 'worktree' && (
              <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
                <span style={{ color: 'var(--cb-text-primary)', fontSize: 13, fontWeight: 700 }}>Active Worktrees</span>
                <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid #E5A54B', background: 'var(--cb-bg-active)' }}>
                  <div className="flex items-center" style={{ gap: 8 }}>
                    <GitBranch size={14} style={{ color: '#E5A54B' }} />
                    <span style={{ color: 'var(--cb-text-primary)', fontSize: 12, fontWeight: 600, flex: 1 }}>{branch || 'main'}</span>
                    <span style={{ color: '#E5A54B', fontSize: 10, padding: '2px 6px', background: '#E5A54B20', borderRadius: 4 }}>active</span>
                  </div>
                  <div style={{ color: 'var(--cb-text-dim)', fontSize: 11, marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>{projectPath}</div>
                </div>
                <div style={{ marginTop: 12, color: 'var(--cb-text-dim)', fontSize: 12 }}>
                  Worktree management will be available in a future update.
                </div>
              </div>
            )}
          </>
        )
      ) : activeTab === 'files' ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* file tree (scrollable, up to 40%) */}
          <div className="shrink-0 overflow-y-auto" style={{ maxHeight: viewingFile ? '40%' : '100%', padding: '8px 0' }}>
            <div className="flex items-center justify-between" style={{ padding: '6px 16px' }}>
              <span style={{ color: '#9CA3AF', fontSize: 11, fontWeight: 500, fontFamily: 'Inter, system-ui, sans-serif' }}>Explorer</span>
              <span style={{ color: '#4B5563', fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
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
            <div className="flex-1 flex flex-col" style={{ borderTop: '1px solid var(--cb-border)', minHeight: 0 }}>
              {/* file header */}
              <div className="flex items-center justify-between shrink-0" style={{ padding: '6px 16px', background: 'var(--cb-bg-code)' }}>
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
            style={{ flex: 1, margin: 16, background: 'var(--cb-bg-primary)', border: '1px solid var(--cb-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* top bar */}
            <div className="flex items-center justify-between shrink-0" style={{ padding: '8px 16px', borderBottom: '1px solid var(--cb-border)', background: 'var(--cb-bg-code)' }}>
              <div className="flex items-center" style={{ gap: 8 }}>
                <span style={{ color: '#E5A54B', fontSize: 11, fontWeight: 700 }}>{'>'}</span>
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
              <div style={{ width: 220, borderRight: '1px solid var(--cb-border)', overflowY: 'auto', padding: '8px 0', flexShrink: 0 }}>
                <div style={{ padding: '4px 12px 6px', color: '#9CA3AF', fontSize: 10, fontWeight: 500, fontFamily: 'Inter, system-ui, sans-serif' }}>Explorer</div>
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
              style={{ flex: 1, margin: 24, background: 'var(--cb-bg-primary)', border: '1px solid var(--cb-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* modal header with prev/next navigation */}
              <div
                className="flex items-center justify-between shrink-0"
                style={{ padding: '8px 20px', borderBottom: '1px solid var(--cb-border)', background: 'var(--cb-bg-code)' }}
              >
                {/* left: navigation + filename */}
                <div className="flex items-center" style={{ gap: 10 }}>
                  <button
                    onClick={() => hasPrev && navTo(currentIdx - 1)}
                    style={{
                      background: 'transparent', border: '1px solid var(--cb-border)', color: hasPrev ? '#FAFAFA' : '#4B5563',
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
                      background: 'transparent', border: '1px solid var(--cb-border)', color: hasNext ? '#FAFAFA' : '#4B5563',
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
                  <span style={{ color: '#E5A54B', fontSize: 11 }}>modified</span>
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
