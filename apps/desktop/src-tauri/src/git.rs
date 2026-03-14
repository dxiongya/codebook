use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub additions: i32,
    pub deletions: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    pub file_path: String,
    pub original: String,
    pub modified: String,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommitResult {
    pub hash: String,
    pub message: String,
}

/// Detect language from file extension.
pub fn detect_language_pub(ext: &str) -> &str {
    match ext {
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "rs" => "rust",
        "py" => "python",
        "go" => "go",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "rb" => "ruby",
        "php" => "php",
        "c" | "h" => "c",
        "cpp" | "cc" | "hpp" => "cpp",
        "cs" => "csharp",
        "html" | "htm" => "html",
        "css" | "scss" | "less" => "css",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" => "xml",
        "md" | "markdown" => "markdown",
        "sql" => "sql",
        "sh" | "bash" | "zsh" => "shell",
        "dockerfile" => "dockerfile",
        "graphql" | "gql" => "graphql",
        "svg" => "xml",
        _ => "plaintext",
    }
}

fn detect_language(file_path: &str) -> String {
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    match ext {
        "ts" | "tsx" => "typescript",
        "js" | "jsx" => "javascript",
        "rs" => "rust",
        "py" => "python",
        "json" => "json",
        "css" => "css",
        "scss" => "scss",
        "less" => "less",
        "html" | "htm" => "html",
        "md" | "mdx" => "markdown",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "xml" => "xml",
        "sql" => "sql",
        "sh" | "bash" | "zsh" => "shell",
        "go" => "go",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "c" => "c",
        "cpp" | "cc" | "cxx" => "cpp",
        "h" | "hpp" => "cpp",
        "rb" => "ruby",
        "php" => "php",
        "lua" => "lua",
        "vue" => "vue",
        "svelte" => "svelte",
        "graphql" | "gql" => "graphql",
        "dart" => "dart",
        "r" | "R" => "r",
        "ex" | "exs" => "elixir",
        _ => "plaintext",
    }
    .to_string()
}

/// Parse numstat output into a map of file_path -> (additions, deletions).
fn parse_numstat(output: &str) -> HashMap<String, (i32, i32)> {
    let mut map = HashMap::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let additions = parts[0].parse::<i32>().unwrap_or(0);
            let deletions = parts[1].parse::<i32>().unwrap_or(0);
            let path = parts[2].to_string();
            map.insert(path, (additions, deletions));
        }
    }
    map
}

pub fn git_status(project_path: &str) -> Result<Vec<FileChange>, String> {
    // Get porcelain status
    let status_output = Command::new("git")
        .args(["-C", project_path, "status", "--porcelain=v1"])
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;

    if !status_output.status.success() {
        let stderr = String::from_utf8_lossy(&status_output.stderr);
        return Err(format!("git status failed: {}", stderr));
    }

    let status_text = String::from_utf8_lossy(&status_output.stdout);

    // Get numstat for unstaged changes
    let unstaged_numstat = Command::new("git")
        .args(["-C", project_path, "diff", "--numstat"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    // Get numstat for staged changes
    let staged_numstat = Command::new("git")
        .args(["-C", project_path, "diff", "--cached", "--numstat"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let unstaged_stats = parse_numstat(&unstaged_numstat);
    let staged_stats = parse_numstat(&staged_numstat);

    let mut changes: Vec<FileChange> = Vec::new();

    for line in status_text.lines() {
        if line.len() < 3 {
            continue;
        }

        let x = line.chars().nth(0).unwrap_or(' ');
        let y = line.chars().nth(1).unwrap_or(' ');
        let file_path = &line[3..];

        // Handle renames: "R  old -> new"
        let file_path = if file_path.contains(" -> ") {
            file_path.split(" -> ").last().unwrap_or(file_path)
        } else {
            file_path
        }
        .to_string();

        // Determine staged entry
        if x != ' ' && x != '?' {
            let status = match x {
                'M' => "M",
                'A' => "A",
                'D' => "D",
                'R' => "R",
                'C' => "A",
                _ => "M",
            };
            let (additions, deletions) = staged_stats
                .get(&file_path)
                .copied()
                .unwrap_or((0, 0));
            changes.push(FileChange {
                path: file_path.clone(),
                status: status.to_string(),
                staged: true,
                additions,
                deletions,
            });
        }

        // Determine unstaged entry
        if y != ' ' && y != '!' {
            let status = if y == '?' {
                "?"
            } else {
                match y {
                    'M' => "M",
                    'D' => "D",
                    _ => "M",
                }
            };
            let (additions, deletions) = unstaged_stats
                .get(&file_path)
                .copied()
                .unwrap_or((0, 0));
            changes.push(FileChange {
                path: file_path.clone(),
                status: status.to_string(),
                staged: false,
                additions,
                deletions,
            });
        }

        // Untracked files: both X and Y are '?'
        if x == '?' && y == '?' {
            // Already handled by the y == '?' branch above, but we need
            // to make sure we don't double-add. The y-branch above catches it.
            // Nothing extra needed here.
        }
    }

    Ok(changes)
}

pub fn git_diff_file(project_path: &str, file_path: &str) -> Result<DiffResult, String> {
    // Get original content from HEAD
    let original_output = Command::new("git")
        .args(["-C", project_path, "show", &format!("HEAD:{}", file_path)])
        .output()
        .map_err(|e| format!("Failed to run git show: {}", e))?;

    let original = if original_output.status.success() {
        String::from_utf8_lossy(&original_output.stdout).to_string()
    } else {
        // File is new (not in HEAD), return empty string
        String::new()
    };

    // Read current file content from disk
    let full_path = Path::new(project_path).join(file_path);
    let modified = std::fs::read_to_string(&full_path).map_err(|e| {
        format!(
            "Failed to read file {}: {}",
            full_path.display(),
            e
        )
    })?;

    let language = detect_language(file_path);

    Ok(DiffResult {
        file_path: file_path.to_string(),
        original,
        modified,
        language,
    })
}

pub fn git_commit(project_path: &str, message: &str) -> Result<GitCommitResult, String> {
    // Stage all changes
    let add_output = Command::new("git")
        .args(["-C", project_path, "add", "-A"])
        .output()
        .map_err(|e| format!("Failed to run git add: {}", e))?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(format!("git add failed: {}", stderr));
    }

    // Commit
    let commit_output = Command::new("git")
        .args(["-C", project_path, "commit", "-m", message])
        .output()
        .map_err(|e| format!("Failed to run git commit: {}", e))?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        return Err(format!("git commit failed: {}", stderr));
    }

    // Get the commit hash
    let hash_output = Command::new("git")
        .args(["-C", project_path, "rev-parse", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to get commit hash: {}", e))?;

    let hash = String::from_utf8_lossy(&hash_output.stdout)
        .trim()
        .to_string();

    Ok(GitCommitResult {
        hash,
        message: message.to_string(),
    })
}

pub fn git_push(project_path: &str) -> Result<(), String> {
    let output = Command::new("git")
        .args(["-C", project_path, "push"])
        .output()
        .map_err(|e| format!("Failed to run git push: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git push failed: {}", stderr));
    }

    Ok(())
}

pub fn git_branch(project_path: &str) -> Result<String, String> {
    let output = Command::new("git")
        .args(["-C", project_path, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to run git rev-parse: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git branch failed: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
