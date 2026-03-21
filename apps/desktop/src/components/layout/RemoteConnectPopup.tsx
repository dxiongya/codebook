import { useState, useEffect, useCallback, useRef } from 'react';
import { Smartphone, X, Wifi, Copy, Check, RefreshCw } from 'lucide-react';
import * as api from '../../lib/api';

interface ConnectionInfo {
  lan_ips: string[];
  port: number;
  tailscale_ip: string | null;
  tailscale_online: boolean;
}

const PIN_EXPIRY_SECS = 300;

export function RemoteConnectPopup({ onClose }: { onClose: () => void }) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [connInfo, setConnInfo] = useState<ConnectionInfo | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [pinExpiry, setPinExpiry] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [conn, activePin] = await Promise.all([
        api.getConnectionInfo(),
        api.getActivePin(),
      ]);
      setConnInfo(conn);
      if (activePin) {
        setPin(activePin);
        if (pinExpiry === 0) setPinExpiry(PIN_EXPIRY_SECS);
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
        if (s <= 1) { setPin(null); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [pinExpiry]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

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

  const primaryIp = connInfo?.lan_ips[0] ?? null;
  const displayAddress = primaryIp ? `${primaryIp}:${connInfo?.port ?? 19876}` : null;
  const pinMinutes = Math.floor(pinExpiry / 60);
  const pinSeconds = pinExpiry % 60;
  const pinProgress = pinExpiry / PIN_EXPIRY_SECS;

  return (
    <div
      ref={popupRef}
      style={{
        position: 'absolute',
        top: 44,
        right: 80,
        width: 300,
        zIndex: 200,
        background: 'var(--cb-bg-primary)',
        border: '1px solid var(--cb-border)',
        borderRadius: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between"
        style={{ padding: '12px 16px', borderBottom: '1px solid var(--cb-border)' }}
      >
        <div className="flex items-center" style={{ gap: 8 }}>
          <Smartphone size={14} style={{ color: 'var(--cb-accent)' }} />
          <span style={{ color: 'var(--cb-text-primary)', fontSize: 13, fontWeight: 600 }}>Remote Connect</span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--cb-text-dim)', display: 'flex', padding: 2, borderRadius: 4,
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* QR Code section */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--cb-text-muted)', fontWeight: 500 }}>Scan to Connect</span>
          <div style={{
            width: 120, height: 120,
            background: '#fff',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: 'var(--cb-text-muted)', fontSize: 10 }}>QR Code</span>
          </div>
          <span style={{ fontSize: 10, color: 'var(--cb-text-dim)', textAlign: 'center' }}>
            Open Codebook mobile app and scan
          </span>
        </div>

        {/* Divider */}
        <div className="flex items-center" style={{ gap: 10 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--cb-border)' }} />
          <span style={{ fontSize: 10, color: 'var(--cb-text-dim)', whiteSpace: 'nowrap' }}>or connect manually</span>
          <div style={{ flex: 1, height: 1, background: 'var(--cb-border)' }} />
        </div>

        {/* IP Address row */}
        {displayAddress ? (
          <div
            className="flex items-center"
            style={{
              gap: 8, padding: '8px 12px',
              background: 'var(--cb-bg-elevated)', borderRadius: 8,
              border: '1px solid var(--cb-border)',
            }}
          >
            <Wifi size={13} style={{ color: 'var(--cb-text-dim)', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--cb-text-dim)', minWidth: 30 }}>LAN</span>
            <span style={{
              fontSize: 12, color: 'var(--cb-text-secondary)', flex: 1,
              fontFamily: 'JetBrains Mono, monospace',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {displayAddress}
            </span>
            <button
              onClick={() => copyToClipboard(displayAddress, 'ip')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 2, color: copied === 'ip' ? 'var(--cb-accent-green)' : 'var(--cb-text-dim)',
                display: 'flex', flexShrink: 0,
              }}
            >
              {copied === 'ip' ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        ) : (
          <div style={{
            padding: '8px 12px', background: 'var(--cb-bg-elevated)', borderRadius: 8,
            border: '1px solid var(--cb-border)', fontSize: 11, color: 'var(--cb-text-dim)',
            textAlign: 'center',
          }}>
            Loading network info...
          </div>
        )}

        {/* PIN Code section */}
        {pin ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* PIN digits - click to copy */}
            <div
              onClick={() => copyToClipboard(pin, 'pin')}
              title="Click to copy PIN"
              className="flex"
              style={{ gap: 6, justifyContent: 'center', cursor: 'pointer' }}
            >
              {pin.split('').map((char, i) => (
                <div key={i} style={{
                  width: 36, height: 44,
                  background: 'var(--cb-bg-elevated)',
                  border: `1px solid ${copied === 'pin' ? 'var(--cb-accent-green)' : 'var(--cb-border)'}`,
                  borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, fontWeight: 700, color: copied === 'pin' ? 'var(--cb-accent-green)' : 'var(--cb-accent)',
                  fontFamily: 'JetBrains Mono, monospace',
                  transition: 'border-color 0.2s, color 0.2s',
                }}>
                  {char}
                </div>
              ))}
            </div>
            {/* Copy hint */}
            <div style={{ textAlign: 'center', fontSize: 10, color: copied === 'pin' ? 'var(--cb-accent-green)' : 'var(--cb-text-dim)' }}>
              {copied === 'pin' ? '✓ Copied!' : 'Click to copy'}
            </div>

            {/* Expiry bar */}
            <div style={{ height: 3, background: 'var(--cb-border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${pinProgress * 100}%`,
                background: pinProgress > 0.4 ? 'var(--cb-accent)' : pinProgress > 0.15 ? 'var(--cb-accent)' : 'var(--cb-accent-red)',
                borderRadius: 2,
                transition: 'width 1s linear, background 0.3s',
              }} />
            </div>

            {/* Timer + Generate button row */}
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 10, color: 'var(--cb-text-dim)' }}>
                {pinMinutes}:{String(pinSeconds).padStart(2, '0')} remaining
              </span>
              <button
                onClick={handleGeneratePin}
                className="flex items-center"
                style={{
                  gap: 4, background: 'none', border: '1px solid var(--cb-border)',
                  borderRadius: 6, padding: '4px 10px',
                  fontSize: 10, color: 'var(--cb-text-muted)', cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <RefreshCw size={10} />
                New PIN
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleGeneratePin}
            disabled={loading}
            style={{
              background: 'var(--cb-accent)', border: 'none', borderRadius: 8,
              padding: '10px 0', fontSize: 12, fontWeight: 600,
              color: 'var(--cb-bg-primary)', cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', opacity: loading ? 0.7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {loading ? 'Generating...' : 'Generate New PIN'}
          </button>
        )}
      </div>
    </div>
  );
}
