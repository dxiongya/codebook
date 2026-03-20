import { useState, useEffect, useCallback } from 'react';
import { Wifi, WifiOff, Smartphone, RefreshCw, Copy, Check, QrCode, Shield, Zap } from 'lucide-react';
import * as api from '../../lib/api';

interface ConnectionInfo {
  lan_ips: string[];
  port: number;
  tailscale_ip: string | null;
  tailscale_online: boolean;
}

interface RemoteInfo {
  port: number;
  ips: string[];
  client_count: number;
  running: boolean;
}

const PIN_EXPIRY_SECS = 300;

export function RemotePanel() {
  const [connInfo, setConnInfo] = useState<ConnectionInfo | null>(null);
  const [remoteInfo, setRemoteInfo] = useState<RemoteInfo | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [pinExpiry, setPinExpiry] = useState<number>(0); // seconds remaining
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [conn, remote, activePin] = await Promise.all([
        api.getConnectionInfo(),
        api.getRemoteInfo(),
        api.getActivePin(),
      ]);
      setConnInfo(conn);
      setRemoteInfo(remote);
      if (activePin) {
        setPin(activePin);
        setPinExpiry(PIN_EXPIRY_SECS);
      }
    } catch (e) {
      console.error('[remote]', e);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  // PIN countdown
  useEffect(() => {
    if (pinExpiry <= 0) return;
    const t = setInterval(() => {
      setPinExpiry((s) => {
        if (s <= 1) {
          setPin(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [pinExpiry]);

  const handleGeneratePin = async () => {
    setLoading(true);
    try {
      const newPin = await api.generatePin();
      setPin(newPin);
      setPinExpiry(PIN_EXPIRY_SECS);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const primaryIp = connInfo?.tailscale_online && connInfo.tailscale_ip
    ? connInfo.tailscale_ip
    : connInfo?.lan_ips[0] ?? null;

  const wsUrl = primaryIp ? `ws://${primaryIp}:${connInfo?.port ?? 19876}` : null;

  const pinProgress = pinExpiry / PIN_EXPIRY_SECS;
  const pinMinutes = Math.floor(pinExpiry / 60);
  const pinSeconds = pinExpiry % 60;

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ padding: '16px 16px 24px' }}>

      {/* Server status */}
      <Section label="Server">
        <div className="flex items-center justify-between" style={{ padding: '10px 14px', background: 'var(--cb-bg-elevated)', borderRadius: 10, border: '1px solid var(--cb-border)' }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: remoteInfo?.running ? '#4ADE80' : 'var(--cb-text-dim)',
              boxShadow: remoteInfo?.running ? '0 0 6px #4ADE8088' : 'none',
            }} />
            <span style={{ fontSize: 13, color: 'var(--cb-text-secondary)' }}>
              {remoteInfo?.running ? 'Listening' : 'Stopped'}
            </span>
            {remoteInfo?.running && (
              <span style={{ fontSize: 11, color: 'var(--cb-text-dim)' }}>:{connInfo?.port ?? 19876}</span>
            )}
          </div>
          <div className="flex items-center" style={{ gap: 10 }}>
            {remoteInfo?.running && remoteInfo.client_count > 0 && (
              <div className="flex items-center" style={{ gap: 5 }}>
                <Smartphone size={12} style={{ color: '#E5A54B' }} />
                <span style={{ fontSize: 11, color: '#E5A54B' }}>{remoteInfo.client_count}</span>
              </div>
            )}
            <button
              onClick={refresh}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--cb-text-dim)', display: 'flex' }}
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
      </Section>

      {/* Network addresses */}
      <Section label="Network">
        {connInfo ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {connInfo.lan_ips.map((ip) => (
              <AddressRow
                key={ip}
                icon={<Wifi size={13} style={{ color: 'var(--cb-text-dim)' }} />}
                label="LAN"
                value={`${ip}:${connInfo.port}`}
                onCopy={() => copyToClipboard(`ws://${ip}:${connInfo.port}`, ip)}
                copied={copied === ip}
              />
            ))}
            {connInfo.tailscale_online && connInfo.tailscale_ip ? (
              <AddressRow
                icon={<Zap size={13} style={{ color: '#A78BFA' }} />}
                label="Tailscale"
                value={`${connInfo.tailscale_ip}:${connInfo.port}`}
                onCopy={() => copyToClipboard(`ws://${connInfo.tailscale_ip}:${connInfo.port}`, 'ts')}
                copied={copied === 'ts'}
                accent="#A78BFA"
              />
            ) : (
              <div className="flex items-center" style={{ gap: 6, padding: '8px 12px', background: '#1F1C19', borderRadius: 8, border: '1px solid var(--cb-border)' }}>
                <WifiOff size={12} style={{ color: '#4B5563' }} />
                <span style={{ fontSize: 11, color: '#4B5563' }}>Tailscale not connected</span>
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: '#4B5563', fontSize: 12, padding: '8px 0' }}>Loading...</div>
        )}
      </Section>

      {/* PIN auth */}
      <Section label="PIN Authentication">
        {pin ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* PIN display */}
            <div style={{ background: 'var(--cb-bg-elevated)', border: '1px solid var(--cb-border)', borderRadius: 10, padding: '14px 16px' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--cb-text-dim)', letterSpacing: 1 }}>ONE-TIME PIN</span>
                <button
                  onClick={() => copyToClipboard(pin, 'pin')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied === 'pin' ? '#4ADE80' : 'var(--cb-text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  {copied === 'pin' ? <Check size={12} /> : <Copy size={12} />}
                  <span style={{ fontSize: 11 }}>{copied === 'pin' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              {/* PIN digits */}
              <div className="flex" style={{ gap: 6, justifyContent: 'center', marginBottom: 12 }}>
                {pin.split('').map((char, i) => (
                  <div key={i} style={{
                    width: 38, height: 46,
                    background: 'var(--cb-bg-primary)',
                    border: '1px solid #3A3530',
                    borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, fontWeight: 700, color: '#E5A54B',
                    fontFamily: 'JetBrains Mono, monospace',
                    letterSpacing: 0,
                  }}>
                    {char}
                  </div>
                ))}
              </div>
              {/* Expiry bar */}
              <div style={{ height: 3, background: 'var(--cb-border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${pinProgress * 100}%`,
                  background: pinProgress > 0.4 ? '#E5A54B' : pinProgress > 0.15 ? '#F59E0B' : '#EF4444',
                  borderRadius: 2,
                  transition: 'width 1s linear, background 0.3s',
                }} />
              </div>
              <div style={{ marginTop: 6, textAlign: 'right', fontSize: 11, color: 'var(--cb-text-dim)' }}>
                {pinMinutes}:{String(pinSeconds).padStart(2, '0')} remaining
              </div>
            </div>
            <button
              onClick={handleGeneratePin}
              style={{
                background: 'none', border: '1px solid var(--cb-border)', borderRadius: 8,
                padding: '8px 0', fontSize: 12, color: 'var(--cb-text-dim)', cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Regenerate PIN
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--cb-text-dim)', lineHeight: 1.6 }}>
              Generate a one-time PIN for your mobile device to connect.
            </div>
            <button
              onClick={handleGeneratePin}
              disabled={loading}
              style={{
                background: '#E5A54B', border: 'none', borderRadius: 8,
                padding: '10px 0', fontSize: 13, fontWeight: 600,
                color: 'var(--cb-bg-primary)', cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', opacity: loading ? 0.7 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <Shield size={14} />
              {loading ? 'Generating...' : 'Generate PIN'}
            </button>
          </div>
        )}
      </Section>

      {/* Quick connect guide */}
      {wsUrl && (
        <Section label="Quick Connect">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--cb-text-dim)', lineHeight: 1.7 }}>
              <span style={{ color: 'var(--cb-text-muted)' }}>1.</span> Open Codebook on your iPhone<br />
              <span style={{ color: 'var(--cb-text-muted)' }}>2.</span> Enter the address below<br />
              <span style={{ color: 'var(--cb-text-muted)' }}>3.</span> Enter the PIN when prompted
            </div>
            <AddressRow
              icon={<QrCode size={13} style={{ color: 'var(--cb-text-dim)' }} />}
              label="WS"
              value={wsUrl}
              onCopy={() => copyToClipboard(wsUrl, 'ws')}
              copied={copied === 'ws'}
            />
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--cb-text-dim)', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function AddressRow({
  icon, label, value, onCopy, copied,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  accent?: string;
}) {
  return (
    <div className="flex items-center" style={{ gap: 8, padding: '8px 12px', background: 'var(--cb-bg-elevated)', borderRadius: 8, border: '1px solid var(--cb-border)' }}>
      {icon}
      <span style={{ fontSize: 10, color: 'var(--cb-text-dim)', minWidth: 52 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--cb-text-secondary)', flex: 1, fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </span>
      <button
        onClick={onCopy}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: copied ? '#4ADE80' : 'var(--cb-text-dim)', display: 'flex', flexShrink: 0 }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}
