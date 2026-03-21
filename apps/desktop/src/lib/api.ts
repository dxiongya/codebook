import { invoke } from '@tauri-apps/api/core';
import type { Project, Session, Message, ReferenceDir, FileChange, DiffResult, GitCommitResult, FileEntry, FileContent, Checkpoint, GitSnapshot } from '../types';

// Projects
export const createProject = (name: string, path: string) =>
  invoke<Project>('create_project', { name, path });

export const listProjects = () =>
  invoke<Project[]>('list_projects');

export const deleteProject = (id: string) =>
  invoke<void>('delete_project', { id });

// Sessions
export const createSession = (projectId: string, name: string) =>
  invoke<Session>('create_session', { projectId, name });

export const listSessions = (projectId: string) =>
  invoke<Session[]>('list_sessions', { projectId });

export const deleteSession = (id: string) =>
  invoke<void>('delete_session', { id });

export const renameSession = (id: string, name: string) =>
  invoke<void>('rename_session', { id, name });

// Messages
export const getMessages = (sessionId: string, limit?: number, before?: string) =>
  invoke<Message[]>('get_messages', { sessionId, limit: limit ?? null, before: before ?? null });

export const saveMessage = (sessionId: string, role: string, content: string, model?: string, cost?: number, durationMs?: number) =>
  invoke<Message>('save_message', { sessionId, role, content, model, cost, durationMs });

// References
export const addReference = (projectId: string, path: string, label?: string) =>
  invoke<ReferenceDir>('add_reference', { projectId, path, label });

export const listReferences = (projectId: string) =>
  invoke<ReferenceDir[]>('list_references', { projectId });

export const removeReference = (id: string) =>
  invoke<void>('remove_reference', { id });

// Settings
export const getSetting = (key: string) =>
  invoke<string | null>('get_setting', { key });

export const setSetting = (key: string, value: string) =>
  invoke<void>('set_setting', { key, value });

// Chat
export const sendChatMessage = (sessionId: string, message: string, model?: string) =>
  invoke<void>('send_chat_message', { sessionId, message, model });

export const stopChat = (sessionId: string) =>
  invoke<void>('stop_chat', { sessionId });

// File explorer
export const listDir = (dirPath: string) =>
  invoke<FileEntry[]>('list_dir', { dirPath });

export const readFileContent = (filePath: string) =>
  invoke<FileContent>('read_file_content', { filePath });

// Git
export const gitStatus = (projectPath: string) =>
  invoke<FileChange[]>('git_status', { projectPath });

export const gitDiffFile = (projectPath: string, filePath: string) =>
  invoke<DiffResult>('git_diff_file', { projectPath, filePath });

export const gitCommit = (projectPath: string, message: string, files?: string[]) =>
  invoke<GitCommitResult>('git_commit', { projectPath, message, files: files ?? null });

export const gitPush = (projectPath: string) =>
  invoke<void>('git_push', { projectPath });

export const gitPull = (projectPath: string) =>
  invoke<string>('git_pull', { projectPath });

export const gitBranch = (projectPath: string) =>
  invoke<string>('git_branch', { projectPath });

export const gitListBranches = (projectPath: string) =>
  invoke<string[]>('git_list_branches', { projectPath });

export const gitCheckout = (projectPath: string, branch: string) =>
  invoke<string>('git_checkout', { projectPath, branch });

export interface GitRepo { path: string; name: string; branch: string; }
export const discoverGitRepos = (projectPath: string) =>
  invoke<GitRepo[]>('discover_git_repos', { projectPath });

// Paste image
export const savePastedImage = (base64Data: string, projectPath: string) =>
  invoke<string>('save_pasted_image', { base64Data, projectPath });

// Claude CLI config (read directly from filesystem)
export const getClaudeCliConfig = () =>
  invoke<{
    plugins: { name: string; version: string; scope: string }[];
    skills: string[];
    mcp_servers: Record<string, any>;
    settings: Record<string, any>;
  }>('get_claude_cli_config');

// Global settings (~/.claude/settings.json) - raw read/write
export const readGlobalSettings = () =>
  invoke<string>('read_global_settings');

export const saveGlobalSettings = (content: string) =>
  invoke<void>('save_global_settings', { content });

// Project-level Claude config
export const getProjectClaudeConfig = (projectPath: string) =>
  invoke<{ settings_json: any; settings_local_json: any; claude_md: string | null; has_claude_dir: boolean }>('get_project_claude_config', { projectPath });

export const saveProjectClaudeConfig = (projectPath: string, fileType: string, content: string) =>
  invoke<void>('save_project_claude_config', { projectPath, fileType, content });

// Checkpoints
export const saveCheckpoint = (sessionId: string, messageId: string, gitCommitHash: string | null, gitDiffSummary: string | null, projectPath: string) =>
  invoke<Checkpoint>('save_checkpoint', { sessionId, messageId, gitCommitHash, gitDiffSummary, projectPath });

export const getCheckpoints = (sessionId: string) =>
  invoke<Checkpoint[]>('get_checkpoints', { sessionId });

export const rollbackToCheckpoint = (projectPath: string, commitHash: string) =>
  invoke<void>('rollback_to_checkpoint', { projectPath, commitHash });

export const getGitSnapshot = (projectPath: string) =>
  invoke<GitSnapshot>('get_git_snapshot', { projectPath });

// CLI session import
export const importCliSessions = (projectPath: string, projectId: string) =>
  invoke<Session[]>('import_cli_sessions', { projectPath, projectId });

export const syncCliSession = (sessionId: string, projectPath: string) =>
  invoke<number>('sync_cli_session', { sessionId, projectPath });

export const generateCommitMessage = (projectPath: string, files?: string[]) =>
  invoke<string>('generate_commit_message', { projectPath, files: files ?? null });

// Streaming buffer
export const isSessionStreaming = (sessionId: string) =>
  invoke<boolean>('is_session_streaming', { sessionId });

export const getStreamingBuffer = (sessionId: string) =>
  invoke<any[]>('get_streaming_buffer', { sessionId });

// Remote access
export const getRemoteInfo = () =>
  invoke<{ port: number; ips: string[]; client_count: number; running: boolean }>('get_remote_info');

export const startRemoteServer = () =>
  invoke<void>('start_remote_server');

export const stopRemoteServer = () =>
  invoke<void>('stop_remote_server');

export const getTailscaleStatus = () =>
  invoke<{ online: boolean; ip: string | null; hostname: string | null; device_name: string | null }>('get_tailscale_status');

export const getConnectionInfo = () =>
  invoke<{ lan_ips: string[]; port: number; tailscale_ip: string | null; tailscale_online: boolean }>('get_connection_info');

export const generatePin = () =>
  invoke<string>('generate_pin');

export const getActivePin = () =>
  invoke<string | null>('get_active_pin');
