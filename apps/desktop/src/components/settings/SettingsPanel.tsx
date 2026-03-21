import { useState, useEffect, useCallback } from 'react';
import { Editor } from '@monaco-editor/react';
import { useAppStore } from '../../stores/useAppStore';
import * as api from '../../lib/api';
import { THEMES, DEFAULT_THEME, applyTheme } from '../../lib/theme';

const beforeMount = (monaco: any) => {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--cb-bg-primary').trim() || '#1C1917';
  monaco.editor.defineTheme('codebook-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': bg,
      'editor.lineHighlightBackground': 'var(--cb-bg-active)',
      'editorLineNumber.foreground': 'var(--cb-text-dim)',
      'editorGutter.background': bg,
    },
  });
};

// ---------- types ----------

type SettingsSection =
  | 'claude-code'
  | 'codex'
  | 'remote'
  | 'display'
  | 'about';

interface NavItem {
  id: SettingsSection;
  label: string;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'claude-code', label: 'claude code', group: 'cli' },
  { id: 'codex', label: 'codex', group: 'cli' },
  { id: 'remote', label: 'remote', group: 'general' },
  { id: 'display', label: 'display', group: 'general' },
  { id: 'about', label: 'about', group: 'general' },
];

const MODELS = [
  { value: 'sonnet', label: 'sonnet' },
  { value: 'opus', label: 'opus' },
  { value: 'haiku', label: 'haiku' },
  { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
  { value: 'claude-opus-4-6', label: 'claude-opus-4-6' },
  { value: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5' },
];

const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'dontAsk',
  'plan',
  'auto',
];

const EFFORT_LEVELS = ['low', 'medium', 'high', 'max'];

// ---------- sub-components ----------

function SectionHeader({ children }: { children: string }) {
  return (
    <div style={{ color: 'var(--cb-text-dim)', fontSize: 11, marginBottom: 12, marginTop: 20 }}>
      // {children}
    </div>
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          padding: '6px 28px 6px 10px',
          border: '1px solid var(--cb-border)',
          background: 'var(--cb-bg-elevated)',
          color: 'var(--cb-text-primary)',
          fontSize: 13,
          fontFamily: 'inherit',
          cursor: 'pointer',
          outline: 'none',
          borderRadius: 6,
          minWidth: 180,
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} style={{ background: 'var(--cb-bg-primary)' }}>
            {opt.label}
          </option>
        ))}
      </select>
      <span
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--cb-text-dim)',
          fontSize: 10,
          pointerEvents: 'none',
        }}
      >
        ▾
      </span>
    </div>
  );
}

function ToggleButtons({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex" style={{ gap: 0 }}>
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          style={{
            padding: '6px 14px',
            border: '1px solid var(--cb-border)',
            borderRight: 'none',
            background: value === opt ? 'var(--cb-accent)' : 'var(--cb-bg-elevated)',
            color: value === opt ? 'var(--cb-bg-primary)' : 'var(--cb-text-muted)',
            fontSize: 12,
            fontWeight: value === opt ? 600 : 400,
            fontFamily: 'inherit',
            cursor: 'pointer',
            borderRadius: 0,
          }}
        >
          {opt}
        </button>
      ))}
      {/* Close the last border */}
      <div style={{ width: 1, background: 'var(--cb-border)' }} />
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        padding: '6px 10px',
        border: '1px solid var(--cb-border)',
        background: 'var(--cb-bg-elevated)',
        color: 'var(--cb-text-primary)',
        fontSize: 13,
        fontFamily: 'inherit',
        outline: 'none',
        borderRadius: 6,
        width: width ?? 180,
      }}
    />
  );
}

function TextAreaInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={4}
      style={{
        padding: '8px 10px',
        border: '1px solid var(--cb-border)',
        background: 'var(--cb-bg-elevated)',
        color: 'var(--cb-text-primary)',
        fontSize: 13,
        fontFamily: 'inherit',
        outline: 'none',
        borderRadius: 6,
        width: '100%',
        maxWidth: 400,
        resize: 'vertical',
        lineHeight: 1.5,
      }}
    />
  );
}

// ---------- section views ----------

function ClaudeCodeSection() {
  const claudeInitData = useAppStore((s) => s.claudeInitData);

  const [model, setModel] = useState('sonnet');
  const [permissionMode, setPermissionMode] = useState('bypassPermissions');
  const [effortLevel, setEffortLevel] = useState('high');
  const [maxBudget, setMaxBudget] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  // Direct filesystem data (always available, no message needed)
  const [fsPlugins, setFsPlugins] = useState<{ name: string; version: string; scope: string }[]>([]);
  const [fsSkills, setFsSkills] = useState<string[]>([]);
  const [_fsMcpServers, setFsMcpServers] = useState<Record<string, any>>({});
  const [globalSettingsJson, setGlobalSettingsJson] = useState<string | null>(null);
  const [globalSettingsLoading, setGlobalSettingsLoading] = useState(false);
  const [globalSettingsSaving, setGlobalSettingsSaving] = useState(false);
  const [globalSettingsSaveStatus, setGlobalSettingsSaveStatus] = useState<string | null>(null);

  // Load settings + filesystem data on mount
  useEffect(() => {
    const load = async () => {
      const [m, pm, el, mb, sp] = await Promise.all([
        api.getSetting('claude_model').catch(() => null),
        api.getSetting('claude_permission_mode').catch(() => null),
        api.getSetting('claude_effort_level').catch(() => null),
        api.getSetting('claude_max_budget').catch(() => null),
        api.getSetting('claude_system_prompt').catch(() => null),
      ]);
      if (m) setModel(m);
      if (pm) setPermissionMode(pm);
      if (el) setEffortLevel(el);
      if (mb) setMaxBudget(mb);
      if (sp) setSystemPrompt(sp);

      // Load directly from Claude CLI filesystem
      try {
        const config = await api.getClaudeCliConfig();
        setFsPlugins(config.plugins);
        setFsSkills(config.skills);
        setFsMcpServers(config.mcp_servers);
      } catch { /* ignore */ }

      // Load global settings.json for editor
      try {
        const raw = await api.readGlobalSettings();
        setGlobalSettingsJson(raw);
      } catch { /* ignore */ }
    };
    load();
  }, []);

  const saveSetting = useCallback((key: string, value: string) => {
    api.setSetting(key, value).catch(console.error);
  }, []);

  const handleModelChange = (v: string) => {
    setModel(v);
    saveSetting('claude_model', v);
    // Also update the app store model for immediate use
    useAppStore.getState().setModel(v);
  };

  const handlePermissionModeChange = (v: string) => {
    setPermissionMode(v);
    saveSetting('claude_permission_mode', v);
  };

  const handleEffortChange = (v: string) => {
    setEffortLevel(v);
    saveSetting('claude_effort_level', v);
  };

  const handleBudgetChange = (v: string) => {
    setMaxBudget(v);
    saveSetting('claude_max_budget', v);
  };

  const handleSystemPromptChange = (v: string) => {
    setSystemPrompt(v);
    saveSetting('claude_system_prompt', v);
  };

  const handleLoadGlobalSettings = async () => {
    setGlobalSettingsLoading(true);
    try {
      const raw = await api.readGlobalSettings();
      setGlobalSettingsJson(raw);
    } catch (err) {
      setGlobalSettingsJson('{}');
    }
    setGlobalSettingsLoading(false);
  };

  const handleSaveGlobalSettings = async () => {
    if (globalSettingsJson === null) return;
    setGlobalSettingsSaving(true);
    setGlobalSettingsSaveStatus(null);
    try {
      await api.saveGlobalSettings(globalSettingsJson);
      setGlobalSettingsSaveStatus('saved');
    } catch (err: any) {
      setGlobalSettingsSaveStatus(err?.toString() ?? 'Failed to save');
    }
    setGlobalSettingsSaving(false);
    setTimeout(() => setGlobalSettingsSaveStatus(null), 3000);
  };

  return (
    <div>
      <div style={{ color: 'var(--cb-text-primary)', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        claude code
      </div>
      <div style={{ width: 200, height: 1, background: 'var(--cb-border)', marginBottom: 8 }} />

      <SectionHeader>model</SectionHeader>
      <SelectInput value={model} onChange={handleModelChange} options={MODELS} />

      <SectionHeader>permission mode</SectionHeader>
      <SelectInput
        value={permissionMode}
        onChange={handlePermissionModeChange}
        options={PERMISSION_MODES.map((m) => ({ value: m, label: m }))}
      />

      <SectionHeader>effort level</SectionHeader>
      <ToggleButtons options={EFFORT_LEVELS} value={effortLevel} onChange={handleEffortChange} />

      <SectionHeader>max budget (per session)</SectionHeader>
      <TextInput
        value={maxBudget}
        onChange={handleBudgetChange}
        placeholder="$5.00"
        width={120}
      />

      <SectionHeader>system prompt</SectionHeader>
      <TextAreaInput
        value={systemPrompt}
        onChange={handleSystemPromptChange}
        placeholder="appended to default system prompt..."
      />

      <SectionHeader>global settings</SectionHeader>
      <div style={{ color: 'var(--cb-text-muted)', fontSize: 12, marginBottom: 8 }}>
        ~/.claude/settings.json
      </div>
      {globalSettingsJson === null ? (
        <button
          onClick={handleLoadGlobalSettings}
          disabled={globalSettingsLoading}
          style={{
            padding: '6px 16px',
            border: '1px solid var(--cb-border)',
            background: 'var(--cb-bg-elevated)',
            color: 'var(--cb-accent)',
            fontSize: 12,
            fontFamily: 'inherit',
            cursor: globalSettingsLoading ? 'wait' : 'pointer',
            borderRadius: 6,
            opacity: globalSettingsLoading ? 0.5 : 1,
          }}
        >
          {globalSettingsLoading ? 'Loading...' : 'Open settings.json'}
        </button>
      ) : (
        <div style={{ maxWidth: 500 }}>
          <div
            style={{
              border: '1px solid var(--cb-border)',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <Editor
              height={250}
              language="json"
              theme="codebook-dark"
              beforeMount={beforeMount}
              value={globalSettingsJson}
              onChange={(value) => setGlobalSettingsJson(value ?? '{}')}
              options={{
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
                tabSize: 2,
                automaticLayout: true,
              }}
            />
          </div>
          <div className="flex items-center" style={{ gap: 10, marginTop: 8 }}>
            <button
              onClick={handleSaveGlobalSettings}
              disabled={globalSettingsSaving}
              style={{
                padding: '6px 20px',
                border: '1px solid var(--cb-border)',
                background: 'var(--cb-accent)',
                color: 'var(--cb-bg-primary)',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: globalSettingsSaving ? 'wait' : 'pointer',
                borderRadius: 6,
                opacity: globalSettingsSaving ? 0.5 : 1,
              }}
            >
              {globalSettingsSaving ? 'Saving...' : 'Save'}
            </button>
            {globalSettingsSaveStatus && (
              <span
                style={{
                  fontSize: 11,
                  color: globalSettingsSaveStatus === 'saved' ? 'var(--cb-accent-green)' : 'var(--cb-accent-red)',
                }}
              >
                {globalSettingsSaveStatus === 'saved' ? 'Saved successfully' : globalSettingsSaveStatus}
              </span>
            )}
          </div>
        </div>
      )}

      <SectionHeader>plugins</SectionHeader>
      {fsPlugins.length > 0 ? (
        <div style={{ border: '1px solid var(--cb-border)', maxWidth: 400 }}>
          {fsPlugins.map((p, i) => (
            <div
              key={i}
              className="flex items-center justify-between"
              style={{
                padding: '8px 12px',
                gap: 8,
                borderBottom: i < fsPlugins.length - 1 ? '1px solid var(--cb-border)' : 'none',
              }}
            >
              <div className="flex items-center" style={{ gap: 8 }}>
                <span style={{ color: 'var(--cb-accent-green)', fontSize: 12 }}>&#10003;</span>
                <span style={{ color: 'var(--cb-text-primary)', fontSize: 12 }}>{p.name}</span>
              </div>
              <span style={{ color: 'var(--cb-text-dim)', fontSize: 10 }}>v{p.version} · {p.scope}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: 'var(--cb-text-dim)', fontSize: 12 }}>no plugins installed</div>
      )}

      <SectionHeader>mcp servers</SectionHeader>
      {claudeInitData?.mcp_servers && claudeInitData.mcp_servers.length > 0 ? (
        <div style={{ border: '1px solid var(--cb-border)', maxWidth: 400 }}>
          {claudeInitData.mcp_servers.map((s, i) => (
            <div
              key={i}
              className="flex items-center"
              style={{
                padding: '8px 12px',
                gap: 8,
                borderBottom:
                  i < claudeInitData.mcp_servers.length - 1 ? '1px solid var(--cb-border)' : 'none',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: s.status === 'connected' ? 'var(--cb-accent-green)' : 'var(--cb-text-dim)',
                  border: s.status === 'connected' ? 'none' : '1px solid var(--cb-text-dim)',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--cb-text-primary)', fontSize: 12, flex: 1 }}>{s.name}</span>
              <span
                style={{
                  color: s.status === 'connected' ? 'var(--cb-accent-green)' : 'var(--cb-accent)',
                  fontSize: 11,
                }}
              >
                {s.status}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: 'var(--cb-text-dim)', fontSize: 12 }}>no mcp servers detected</div>
      )}

      <SectionHeader>allowed tools</SectionHeader>
      {claudeInitData?.tools && claudeInitData.tools.length > 0 ? (
        <div className="flex flex-wrap" style={{ gap: 6, maxWidth: 500 }}>
          {claudeInitData.tools.map((tool) => (
            <span
              key={tool}
              style={{
                padding: '4px 10px',
                border: '1px solid var(--cb-border)',
                color: 'var(--cb-text-primary)',
                fontSize: 11,
                background: 'transparent',
              }}
            >
              {tool}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ color: 'var(--cb-text-dim)', fontSize: 12 }}>no tools data yet -- send a message first</div>
      )}

      <SectionHeader>skills</SectionHeader>
      {(fsSkills.length > 0 || (claudeInitData?.skills && claudeInitData.skills.length > 0)) ? (
        <div className="flex flex-wrap" style={{ gap: 6, maxWidth: 500 }}>
          {(fsSkills.length > 0 ? fsSkills : claudeInitData?.skills ?? []).map((skill) => (
            <span
              key={skill}
              style={{
                padding: '4px 10px',
                border: '1px solid var(--cb-border)',
                color: 'var(--cb-accent-green)',
                fontSize: 11,
                background: 'var(--cb-bg-code)',
              }}
            >
              {skill}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ color: 'var(--cb-text-dim)', fontSize: 12 }}>no skills data yet</div>
      )}

      <SectionHeader>agents</SectionHeader>
      {claudeInitData?.agents && claudeInitData.agents.length > 0 ? (
        <div className="flex flex-wrap" style={{ gap: 6, maxWidth: 500 }}>
          {claudeInitData.agents.map((agent) => (
            <span
              key={agent}
              style={{
                padding: '4px 10px',
                border: '1px solid #2a2a50',
                color: '#a78bfa',
                fontSize: 11,
                background: 'var(--cb-bg-code)',
              }}
            >
              {agent}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ color: 'var(--cb-text-dim)', fontSize: 12 }}>no agents data yet</div>
      )}

      <SectionHeader>permission mode</SectionHeader>
      <div style={{ color: 'var(--cb-accent)', fontSize: 12 }}>
        {claudeInitData?.permissionMode ?? 'unknown'}
      </div>

    </div>
  );
}

function CodexSection() {
  return (
    <div>
      <div style={{ color: 'var(--cb-text-primary)', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        codex
      </div>
      <div style={{ width: 200, height: 1, background: 'var(--cb-border)', marginBottom: 16 }} />
      <div style={{ color: 'var(--cb-text-dim)', fontSize: 13, lineHeight: 1.6 }}>
        codex cli -- coming soon
      </div>
      <div style={{ color: 'var(--cb-text-dim)', fontSize: 12, marginTop: 8, lineHeight: 1.5, maxWidth: 400 }}>
        OpenAI Codex CLI integration will allow you to use Codex as an alternative coding assistant
        alongside Claude Code. Configuration options will mirror the Claude Code section.
      </div>
    </div>
  );
}

function RemoteSection() {
  const [remoteInfo, setRemoteInfo] = useState<{
    port: number;
    ips: string[];
    client_count: number;
    running: boolean;
  } | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<{
    lan_ips: string[];
    port: number;
    tailscale_ip: string | null;
    tailscale_online: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pin, setPin] = useState<string | null>(null);
  const [pinExpiry, setPinExpiry] = useState<number>(0);
  const [pinGenerating, setPinGenerating] = useState(false);

  const fetchInfo = useCallback(async () => {
    try {
      const [info, connInfo] = await Promise.all([
        api.getRemoteInfo(),
        api.getConnectionInfo(),
      ]);
      setRemoteInfo(info);
      setConnectionInfo(connInfo);
    } catch {
      setRemoteInfo(null);
      setConnectionInfo(null);
    }
  }, []);

  // Load existing PIN on mount
  useEffect(() => {
    fetchInfo();
    api.getActivePin().then((p) => {
      if (p) {
        setPin(p);
        // We don't know exact remaining time, estimate 5 min
        setPinExpiry(300);
      }
    }).catch(() => {});
  }, [fetchInfo]);

  // Countdown timer for PIN expiry
  useEffect(() => {
    if (pinExpiry <= 0) {
      if (pin) {
        setPin(null);
      }
      return;
    }
    const timer = setInterval(() => {
      setPinExpiry((prev) => {
        if (prev <= 1) {
          setPin(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [pinExpiry, pin]);

  const handleToggle = async () => {
    if (!remoteInfo) return;
    setLoading(true);
    try {
      if (remoteInfo.running) {
        await api.stopRemoteServer();
      } else {
        await api.startRemoteServer();
      }
      await fetchInfo();
    } catch (err) {
      console.error('Failed to toggle remote server:', err);
    }
    setLoading(false);
  };

  const handleGeneratePin = async () => {
    setPinGenerating(true);
    try {
      const newPin = await api.generatePin();
      setPin(newPin);
      setPinExpiry(300); // 5 minutes
    } catch (err) {
      console.error('Failed to generate PIN:', err);
    }
    setPinGenerating(false);
  };

  const formatExpiry = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div>
      <div style={{ color: 'var(--cb-text-primary)', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        remote access
      </div>
      <div style={{ width: 200, height: 1, background: 'var(--cb-border)', marginBottom: 8 }} />

      <SectionHeader>server status</SectionHeader>
      <div className="flex items-center" style={{ gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: remoteInfo?.running ? 'var(--cb-accent-green)' : 'var(--cb-text-dim)',
            flexShrink: 0,
          }}
        />
        <span style={{ color: remoteInfo?.running ? 'var(--cb-accent-green)' : 'var(--cb-text-muted)', fontSize: 13 }}>
          {remoteInfo?.running ? 'running' : 'stopped'}
        </span>
        <span style={{ color: 'var(--cb-text-dim)', fontSize: 11, marginLeft: 8 }}>
          {remoteInfo?.client_count ?? 0} client{(remoteInfo?.client_count ?? 0) !== 1 ? 's' : ''} connected
        </span>
      </div>

      <SectionHeader>connection methods</SectionHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
        {/* LAN */}
        <div style={{ border: '1px solid var(--cb-border)', borderRadius: 6, padding: '10px 14px' }}>
          <div className="flex items-center" style={{ gap: 8, marginBottom: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: (connectionInfo?.lan_ips?.length ?? 0) > 0 ? 'var(--cb-accent-green)' : 'var(--cb-text-dim)',
              flexShrink: 0,
            }} />
            <span style={{ color: 'var(--cb-text-primary)', fontSize: 13, fontWeight: 500 }}>LAN</span>
          </div>
          {connectionInfo?.lan_ips && connectionInfo.lan_ips.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 16 }}>
              {connectionInfo.lan_ips.map((ip) => (
                <span key={ip} style={{ color: 'var(--cb-text-muted)', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                  {ip}:{connectionInfo.port}
                </span>
              ))}
            </div>
          ) : (
            <span style={{ color: 'var(--cb-text-dim)', fontSize: 12, paddingLeft: 16 }}>no network interfaces</span>
          )}
        </div>

        {/* Tailscale */}
        <div style={{ border: '1px solid var(--cb-border)', borderRadius: 6, padding: '10px 14px' }}>
          <div className="flex items-center" style={{ gap: 8, marginBottom: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connectionInfo?.tailscale_online ? 'var(--cb-accent-green)' : 'var(--cb-text-dim)',
              flexShrink: 0,
            }} />
            <span style={{ color: 'var(--cb-text-primary)', fontSize: 13, fontWeight: 500 }}>Tailscale</span>
            {!connectionInfo?.tailscale_online && (
              <span style={{ color: 'var(--cb-text-dim)', fontSize: 11 }}>not available</span>
            )}
          </div>
          {connectionInfo?.tailscale_online && connectionInfo.tailscale_ip ? (
            <div style={{ paddingLeft: 16 }}>
              <span style={{ color: 'var(--cb-text-muted)', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                {connectionInfo.tailscale_ip}:{connectionInfo.port}
              </span>
            </div>
          ) : (
            <span style={{ color: 'var(--cb-text-dim)', fontSize: 11, paddingLeft: 16 }}>
              Install Tailscale for secure remote access outside your local network
            </span>
          )}
        </div>
      </div>

      <SectionHeader>pin authentication</SectionHeader>
      <div style={{ maxWidth: 420 }}>
        {pin ? (
          <div style={{ border: '1px solid var(--cb-border)', borderRadius: 6, padding: '16px 20px', textAlign: 'center' }}>
            <div style={{ color: 'var(--cb-text-dim)', fontSize: 11, marginBottom: 8 }}>
              Enter this PIN on your mobile device
            </div>
            <div style={{
              color: 'var(--cb-accent)',
              fontSize: 32,
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: '0.3em',
              marginBottom: 8,
            }}>
              {pin}
            </div>
            <div style={{
              color: pinExpiry <= 60 ? 'var(--cb-accent-red)' : 'var(--cb-text-dim)',
              fontSize: 12,
            }}>
              expires in {formatExpiry(pinExpiry)}
            </div>
            <button
              onClick={handleGeneratePin}
              disabled={pinGenerating}
              style={{
                marginTop: 12,
                padding: '6px 16px',
                border: '1px solid var(--cb-border)',
                background: 'transparent',
                color: 'var(--cb-text-muted)',
                fontSize: 11,
                fontFamily: 'inherit',
                cursor: 'pointer',
                borderRadius: 6,
              }}
            >
              regenerate
            </button>
          </div>
        ) : (
          <button
            onClick={handleGeneratePin}
            disabled={pinGenerating}
            style={{
              padding: '8px 20px',
              border: '1px solid var(--cb-border)',
              background: 'var(--cb-accent)',
              color: 'var(--cb-bg-primary)',
              fontSize: 12,
              fontWeight: 500,
              fontFamily: 'inherit',
              cursor: pinGenerating ? 'wait' : 'pointer',
              borderRadius: 6,
              opacity: pinGenerating ? 0.5 : 1,
            }}
          >
            {pinGenerating ? 'Generating...' : 'Generate PIN'}
          </button>
        )}
        <div style={{ color: 'var(--cb-text-dim)', fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
          QR code pairing will be available in a future update
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <button
          onClick={handleToggle}
          disabled={loading || !remoteInfo}
          style={{
            padding: '8px 20px',
            border: '1px solid var(--cb-border)',
            background: remoteInfo?.running ? 'transparent' : 'var(--cb-accent)',
            color: remoteInfo?.running ? 'var(--cb-text-muted)' : 'var(--cb-bg-primary)',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: loading ? 'wait' : 'pointer',
            borderRadius: 6,
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? '...' : remoteInfo?.running ? 'stop server' : 'start server'}
        </button>
      </div>
    </div>
  );
}

function applyFontSize(size: number) {
  const scale = size / 13;
  // Apply zoom only to the main app container, not the settings overlay
  const appContainer = document.getElementById('app-main');
  if (appContainer) appContainer.style.zoom = String(scale);
}

function DisplaySection() {
  const [fontSize, setFontSize] = useState(13);
  const [activeTheme, setActiveTheme] = useState(DEFAULT_THEME);

  useEffect(() => {
    api.getSetting('display_font_size').then((v) => {
      if (v) {
        const size = parseInt(v, 10);
        setFontSize(size);
        applyFontSize(size);
      }
    }).catch(() => {});
    api.getSetting('display_theme').then((v) => {
      if (v) {
        setActiveTheme(v);
        applyTheme(v);
      }
    }).catch(() => {});
  }, []);

  const handleFontSizeChange = (v: number) => {
    setFontSize(v);
    applyFontSize(v);
    api.setSetting('display_font_size', String(v)).catch(console.error);
  };

  const handleThemeChange = (themeId: string) => {
    setActiveTheme(themeId);
    applyTheme(themeId);
    api.setSetting('display_theme', themeId).catch(console.error);
  };

  return (
    <div>
      <div style={{ color: 'var(--cb-text-primary)', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        display
      </div>
      <div style={{ width: 200, height: 1, background: 'var(--cb-border)', marginBottom: 8 }} />

      <SectionHeader>font size</SectionHeader>
      <div className="flex items-center" style={{ gap: 12 }}>
        <input
          type="range"
          min={11}
          max={16}
          value={fontSize}
          onChange={(e) => handleFontSizeChange(parseInt(e.target.value, 10))}
          style={{
            width: 160,
            accentColor: 'var(--cb-accent)',
            cursor: 'pointer',
          }}
        />
        <span style={{ color: 'var(--cb-text-primary)', fontSize: 13 }}>{fontSize}px</span>
      </div>

      <SectionHeader>theme</SectionHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {THEMES.map((theme) => {
          const isActive = activeTheme === theme.id;
          return (
            <button
              key={theme.id}
              onClick={() => handleThemeChange(theme.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: isActive ? 'var(--cb-bg-active)' : 'transparent',
                border: isActive ? '1px solid var(--cb-accent)' : '1px solid var(--cb-border)',
                borderRadius: 6,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  background: theme.preview,
                  border: `1px solid ${theme.previewBorder}`,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--cb-text-primary)', fontSize: 12, fontWeight: isActive ? 600 : 400 }}>
                {theme.label}
              </span>
              {isActive && (
                <span style={{ color: 'var(--cb-accent)', fontSize: 10, marginLeft: 'auto' }}>active</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AboutSection() {
  const claudeInitData = useAppStore((s) => s.claudeInitData);

  return (
    <div>
      <div style={{ color: 'var(--cb-text-primary)', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        about
      </div>
      <div style={{ width: 200, height: 1, background: 'var(--cb-border)', marginBottom: 8 }} />

      <SectionHeader>version</SectionHeader>
      <span style={{ color: 'var(--cb-text-primary)', fontSize: 13 }}>v0.1.0</span>

      <SectionHeader>claude cli version</SectionHeader>
      <span style={{ color: 'var(--cb-text-primary)', fontSize: 13 }}>
        {claudeInitData?.claude_code_version ?? 'unknown -- send a message to detect'}
      </span>

      <SectionHeader>links</SectionHeader>
      <a
        href="https://github.com"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--cb-accent)', fontSize: 13, textDecoration: 'none' }}
      >
        github repo
      </a>
    </div>
  );
}

// ---------- main component ----------

export function SettingsPanel() {
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const [activeSection, setActiveSection] = useState<SettingsSection>('claude-code');

  // Close on Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setSettingsOpen]);

  const renderContent = () => {
    switch (activeSection) {
      case 'claude-code':
        return <ClaudeCodeSection />;
      case 'codex':
        return <CodexSection />;
      case 'remote':
        return <RemoteSection />;
      case 'display':
        return <DisplaySection />;
      case 'about':
        return <AboutSection />;
    }
  };

  // Group nav items
  const groups = NAV_ITEMS.reduce<Record<string, NavItem[]>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  return (
    <div
      onClick={() => setSettingsOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* modal */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 800,
          maxWidth: '90vw',
          height: 600,
          maxHeight: '85vh',
          background: 'var(--cb-bg-primary)',
          border: '1px solid var(--cb-border)',
          borderRadius: 10,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* header */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--cb-border)',
          }}
        >
          <span style={{ color: 'var(--cb-text-primary)', fontSize: 14, fontWeight: 700 }}>
            Settings
          </span>
          <button
            onClick={() => setSettingsOpen(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--cb-text-dim)',
              fontSize: 18,
              fontFamily: 'inherit',
              padding: '2px 6px',
              cursor: 'pointer',
              borderRadius: 6,
              lineHeight: 1,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--cb-text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--cb-text-dim)')}
          >
            ×
          </button>
        </div>

        {/* body: nav + content */}
        <div className="flex flex-1 overflow-hidden">
          {/* left nav */}
          <div
            className="shrink-0 overflow-y-auto"
            style={{
              width: 200,
              background: 'var(--cb-bg-primary)',
              borderRight: '1px solid var(--cb-border)',
              padding: '16px 0',
            }}
          >
            {Object.entries(groups).map(([group, items]) => (
              <div key={group} style={{ marginBottom: 12 }}>
                <div style={{ padding: '6px 20px', color: 'var(--cb-text-dim)', fontSize: 11 }}>
                  // {group}
                </div>
                {items.map((item) => {
                  const isActive = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      className="w-full text-left flex items-center"
                      style={{
                        padding: '8px 20px',
                        gap: 8,
                        background: isActive ? 'var(--cb-bg-elevated)' : 'transparent',
                        border: 'none',
                        borderLeft: isActive ? '2px solid #E5A54B' : '2px solid transparent',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      <span style={{ color: isActive ? 'var(--cb-accent)' : 'var(--cb-text-dim)', fontSize: 11 }}>
                        {'\u00B7'}
                      </span>
                      <span
                        style={{
                          color: isActive ? 'var(--cb-accent)' : 'var(--cb-text-muted)',
                          fontSize: 13,
                        }}
                      >
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* right content */}
          <div
            className="flex-1 overflow-y-auto"
            style={{ padding: '24px 32px' }}
          >
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
