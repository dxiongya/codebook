// Models matching Rust backend

export interface Project {
  id: string;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  project_id: string;
  name: string;
  claude_session_id: string | null;
  model: string;
  total_cost: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string; // JSON string for assistant blocks
  model: string | null;
  cost: number | null;
  duration_ms: number | null;
  created_at: string;
}

export interface ReferenceDir {
  id: string;
  project_id: string;
  path: string;
  label: string | null;
}

// Claude event types (emitted from Rust backend)

export interface ClaudeSystemInit {
  type: 'system_init';
  session_id: string;
  model: string;
}

export interface ClaudeThinkingBlock {
  type: 'thinking';
  content: string;
}

export interface ClaudeTextBlock {
  type: 'text';
  content: string;
}

export interface ClaudeToolUseBlock {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
  id: string;
}

export type ClaudeContentBlock = ClaudeThinkingBlock | ClaudeTextBlock | ClaudeToolUseBlock;

export interface ClaudeAssistantEvent {
  type: 'assistant';
  blocks: ClaudeContentBlock[];
  model: string;
}

export interface ClaudeResultEvent {
  type: 'result';
  result: string;
  cost: number;
  duration_ms: number;
}

export interface ClaudeDoneEvent {
  type: 'done';
  code: number | null;
}

export interface ClaudeErrorEvent {
  type: 'error';
  message: string;
}

export type ClaudeEvent =
  | ClaudeSystemInit
  | ClaudeAssistantEvent
  | ClaudeResultEvent
  | ClaudeDoneEvent
  | ClaudeErrorEvent;

// Parsed content blocks for display
export interface DisplayThinkingBlock {
  type: 'thinking';
  content: string;
  chars: number;
}

export interface DisplayToolBlock {
  type: 'tool_use';
  tool: string;
  path?: string;
  command?: string;
  additions?: number;
  deletions?: number;
}

export interface DisplayTextBlock {
  type: 'text';
  content: string;
}

export type DisplayBlock = DisplayThinkingBlock | DisplayToolBlock | DisplayTextBlock;

// Checkpoint types

export interface Checkpoint {
  id: string;
  session_id: string;
  message_id: string;
  git_commit_hash: string | null;
  git_diff_summary: string | null;
  project_path: string;
  created_at: string;
}

export interface GitSnapshot {
  commit_hash: string;
  diff_summary: string;
}

// File explorer types

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  child_count: number | null;
}

export interface FileContent {
  path: string;
  content: string;
  language: string;
  size: number;
}

// Git types (matching Rust backend)

export interface FileChange {
  path: string;
  status: string; // "M", "A", "D", "?"
  staged: boolean;
  additions: number;
  deletions: number;
}

export interface DiffResult {
  file_path: string;
  original: string;  // content before changes
  modified: string;   // current content
  language: string;   // "typescript", "javascript", etc.
}

export interface GitCommitResult {
  hash: string;
  message: string;
}
