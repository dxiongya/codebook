import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import * as api from '../../lib/api';

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
    <div style={{ color: '#6B7280', fontSize: 11, marginBottom: 12, marginTop: 20 }}>
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
          border: '1px solid #2a2a2a',
          background: 'transparent',
          color: '#FAFAFA',
          fontSize: 13,
          fontFamily: 'inherit',
          cursor: 'pointer',
          outline: 'none',
          borderRadius: 0,
          minWidth: 180,
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} style={{ background: '#0F0F0F' }}>
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
          color: '#6B7280',
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
            border: '1px solid #2a2a2a',
            borderRight: 'none',
            background: value === opt ? '#10B981' : 'transparent',
            color: value === opt ? '#0A0A0A' : '#9CA3AF',
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
      <div style={{ width: 1, background: '#2a2a2a' }} />
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
        border: '1px solid #2a2a2a',
        background: 'transparent',
        color: '#FAFAFA',
        fontSize: 13,
        fontFamily: 'inherit',
        outline: 'none',
        borderRadius: 0,
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
        border: '1px solid #2a2a2a',
        background: 'transparent',
        color: '#FAFAFA',
        fontSize: 13,
        fontFamily: 'inherit',
        outline: 'none',
        borderRadius: 0,
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

  return (
    <div>
      <div style={{ color: '#FAFAFA', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        claude code
      </div>
      <div style={{ width: 200, height: 1, background: '#2a2a2a', marginBottom: 8 }} />

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

      <SectionHeader>plugins</SectionHeader>
      {fsPlugins.length > 0 ? (
        <div style={{ border: '1px solid #2a2a2a', maxWidth: 400 }}>
          {fsPlugins.map((p, i) => (
            <div
              key={i}
              className="flex items-center justify-between"
              style={{
                padding: '8px 12px',
                gap: 8,
                borderBottom: i < fsPlugins.length - 1 ? '1px solid #1a1a1a' : 'none',
              }}
            >
              <div className="flex items-center" style={{ gap: 8 }}>
                <span style={{ color: '#10B981', fontSize: 12 }}>&#10003;</span>
                <span style={{ color: '#FAFAFA', fontSize: 12 }}>{p.name}</span>
              </div>
              <span style={{ color: '#4B5563', fontSize: 10 }}>v{p.version} · {p.scope}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: '#4B5563', fontSize: 12 }}>no plugins installed</div>
      )}

      <SectionHeader>mcp servers</SectionHeader>
      {claudeInitData?.mcp_servers && claudeInitData.mcp_servers.length > 0 ? (
        <div style={{ border: '1px solid #2a2a2a', maxWidth: 400 }}>
          {claudeInitData.mcp_servers.map((s, i) => (
            <div
              key={i}
              className="flex items-center"
              style={{
                padding: '8px 12px',
                gap: 8,
                borderBottom:
                  i < claudeInitData.mcp_servers.length - 1 ? '1px solid #1a1a1a' : 'none',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: s.status === 'connected' ? '#10B981' : '#4B5563',
                  border: s.status === 'connected' ? 'none' : '1px solid #6B7280',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: '#FAFAFA', fontSize: 12, flex: 1 }}>{s.name}</span>
              <span
                style={{
                  color: s.status === 'connected' ? '#10B981' : '#F59E0B',
                  fontSize: 11,
                }}
              >
                {s.status}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: '#4B5563', fontSize: 12 }}>no mcp servers detected</div>
      )}

      <SectionHeader>allowed tools</SectionHeader>
      {claudeInitData?.tools && claudeInitData.tools.length > 0 ? (
        <div className="flex flex-wrap" style={{ gap: 6, maxWidth: 500 }}>
          {claudeInitData.tools.map((tool) => (
            <span
              key={tool}
              style={{
                padding: '4px 10px',
                border: '1px solid #2a2a2a',
                color: '#FAFAFA',
                fontSize: 11,
                background: 'transparent',
              }}
            >
              {tool}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ color: '#4B5563', fontSize: 12 }}>no tools data yet -- send a message first</div>
      )}

      <SectionHeader>skills</SectionHeader>
      {(fsSkills.length > 0 || (claudeInitData?.skills && claudeInitData.skills.length > 0)) ? (
        <div className="flex flex-wrap" style={{ gap: 6, maxWidth: 500 }}>
          {(fsSkills.length > 0 ? fsSkills : claudeInitData?.skills ?? []).map((skill) => (
            <span
              key={skill}
              style={{
                padding: '4px 10px',
                border: '1px solid #2a4030',
                color: '#10B981',
                fontSize: 11,
                background: '#0a1a0f',
              }}
            >
              {skill}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ color: '#4B5563', fontSize: 12 }}>no skills data yet</div>
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
                background: '#0f0a1a',
              }}
            >
              {agent}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ color: '#4B5563', fontSize: 12 }}>no agents data yet</div>
      )}

      <SectionHeader>permission mode</SectionHeader>
      <div style={{ color: '#F59E0B', fontSize: 12 }}>
        {claudeInitData?.permissionMode ?? 'unknown'}
      </div>

    </div>
  );
}

function CodexSection() {
  return (
    <div>
      <div style={{ color: '#FAFAFA', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        codex
      </div>
      <div style={{ width: 200, height: 1, background: '#2a2a2a', marginBottom: 16 }} />
      <div style={{ color: '#6B7280', fontSize: 13, lineHeight: 1.6 }}>
        codex cli -- coming soon
      </div>
      <div style={{ color: '#4B5563', fontSize: 12, marginTop: 8, lineHeight: 1.5, maxWidth: 400 }}>
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
  const [loading, setLoading] = useState(false);

  const fetchInfo = useCallback(async () => {
    try {
      const info = await api.getRemoteInfo();
      setRemoteInfo(info);
    } catch {
      // Remote commands may not be implemented yet
      setRemoteInfo(null);
    }
  }, []);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

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

  return (
    <div>
      <div style={{ color: '#FAFAFA', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        remote access
      </div>
      <div style={{ width: 200, height: 1, background: '#2a2a2a', marginBottom: 8 }} />

      <SectionHeader>status</SectionHeader>
      <div className="flex items-center" style={{ gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: remoteInfo?.running ? '#10B981' : '#4B5563',
            flexShrink: 0,
          }}
        />
        <span style={{ color: remoteInfo?.running ? '#10B981' : '#9CA3AF', fontSize: 13 }}>
          {remoteInfo?.running ? 'running' : 'stopped'}
        </span>
      </div>

      <SectionHeader>port</SectionHeader>
      <span style={{ color: '#FAFAFA', fontSize: 13 }}>
        {remoteInfo?.port ?? 19876}
      </span>

      <SectionHeader>local ips</SectionHeader>
      {remoteInfo?.ips && remoteInfo.ips.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {remoteInfo.ips.map((ip) => (
            <span key={ip} style={{ color: '#FAFAFA', fontSize: 13 }}>
              {ip}:{remoteInfo.port ?? 19876}
            </span>
          ))}
        </div>
      ) : (
        <span style={{ color: '#4B5563', fontSize: 12 }}>no network interfaces</span>
      )}

      <SectionHeader>connected clients</SectionHeader>
      <span style={{ color: '#FAFAFA', fontSize: 13 }}>
        {remoteInfo?.client_count ?? 0}
      </span>

      <div style={{ marginTop: 20 }}>
        <button
          onClick={handleToggle}
          disabled={loading || !remoteInfo}
          style={{
            padding: '8px 20px',
            border: '1px solid #2a2a2a',
            background: remoteInfo?.running ? 'transparent' : '#10B981',
            color: remoteInfo?.running ? '#9CA3AF' : '#0A0A0A',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: loading ? 'wait' : 'pointer',
            borderRadius: 0,
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

  useEffect(() => {
    api.getSetting('display_font_size').then((v) => {
      if (v) {
        const size = parseInt(v, 10);
        setFontSize(size);
        applyFontSize(size);
      }
    }).catch(() => {});
  }, []);

  const handleFontSizeChange = (v: number) => {
    setFontSize(v);
    applyFontSize(v);
    api.setSetting('display_font_size', String(v)).catch(console.error);
  };

  return (
    <div>
      <div style={{ color: '#FAFAFA', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        display
      </div>
      <div style={{ width: 200, height: 1, background: '#2a2a2a', marginBottom: 8 }} />

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
            accentColor: '#10B981',
            cursor: 'pointer',
          }}
        />
        <span style={{ color: '#FAFAFA', fontSize: 13 }}>{fontSize}px</span>
      </div>

      <SectionHeader>theme</SectionHeader>
      <div className="flex items-center" style={{ gap: 8 }}>
        <span
          style={{
            width: 16,
            height: 16,
            background: '#0A0A0A',
            border: '1px solid #2a2a2a',
          }}
        />
        <span style={{ color: '#FAFAFA', fontSize: 13 }}>dark</span>
        <span style={{ color: '#4B5563', fontSize: 11 }}>(only theme)</span>
      </div>
    </div>
  );
}

function AboutSection() {
  const claudeInitData = useAppStore((s) => s.claudeInitData);

  return (
    <div>
      <div style={{ color: '#FAFAFA', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        about
      </div>
      <div style={{ width: 200, height: 1, background: '#2a2a2a', marginBottom: 8 }} />

      <SectionHeader>version</SectionHeader>
      <span style={{ color: '#FAFAFA', fontSize: 13 }}>v0.1.0</span>

      <SectionHeader>claude cli version</SectionHeader>
      <span style={{ color: '#FAFAFA', fontSize: 13 }}>
        {claudeInitData?.claude_code_version ?? 'unknown -- send a message to detect'}
      </span>

      <SectionHeader>links</SectionHeader>
      <a
        href="https://github.com"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#06B6D4', fontSize: 13, textDecoration: 'none' }}
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
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#0A0A0A',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* header */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{
          padding: '14px 24px',
          borderBottom: '1px solid #2a2a2a',
        }}
      >
        <span style={{ color: '#FAFAFA', fontSize: 14, fontWeight: 700 }}>
          $ settings
        </span>
        <button
          onClick={() => setSettingsOpen(false)}
          style={{
            background: 'transparent',
            border: '1px solid #2a2a2a',
            color: '#6B7280',
            fontSize: 12,
            fontFamily: 'inherit',
            padding: '4px 10px',
            cursor: 'pointer',
            borderRadius: 0,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#FAFAFA')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
        >
          esc
        </button>
      </div>

      {/* body: nav + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* left nav */}
        <div
          className="shrink-0 overflow-y-auto"
          style={{
            width: 200,
            background: '#0F0F0F',
            borderRight: '1px solid #2a2a2a',
            padding: '16px 0',
          }}
        >
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} style={{ marginBottom: 12 }}>
              <div style={{ padding: '6px 20px', color: '#6B7280', fontSize: 11 }}>
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
                      background: 'transparent',
                      border: 'none',
                      borderLeft: isActive ? '2px solid #10B981' : '2px solid transparent',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    <span style={{ color: isActive ? '#10B981' : '#6B7280', fontSize: 11 }}>
                      {'\u00B7'}
                    </span>
                    <span
                      style={{
                        color: isActive ? '#10B981' : '#9CA3AF',
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
          style={{ padding: '24px 40px' }}
        >
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
