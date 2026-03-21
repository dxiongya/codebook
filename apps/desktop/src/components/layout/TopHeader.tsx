import { useState, useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Sparkles, Sun, Maximize, PanelLeft, PanelRight, Columns3, Smartphone } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { RemoteConnectPopup } from './RemoteConnectPopup';
import * as api from '../../lib/api';

export function TopHeader() {
  const win = getCurrentWindow();
  const {
    leftPanelVisible,
    rightPanelVisible,
    toggleLeftPanel,
    toggleRightPanel,
  } = useAppStore();
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [clientCount, setClientCount] = useState(0);
  const [showConnectToast, setShowConnectToast] = useState(false);
  const prevCount = useRef(0);

  // Poll remote client count
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const info = await api.getRemoteInfo();
        if (!active) return;
        const count = info.client_count ?? 0;
        // Show toast when a new client connects
        if (count > prevCount.current && prevCount.current >= 0) {
          setShowConnectToast(true);
          setTimeout(() => { if (active) setShowConnectToast(false); }, 3000);
        }
        prevCount.current = count;
        setClientCount(count);
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  return (
    <div
      data-no-select
      className="flex items-center shrink-0"
      style={{
        height: 44,
        background: 'var(--cb-bg-primary)',
        borderBottom: '1px solid var(--cb-border)',
        padding: '0 20px',
      }}
    >
      {/* Traffic lights */}
      <div className="flex items-center" style={{ gap: 8 }}>
        <button
          onClick={() => win.close()}
          className="w-3 h-3 rounded-full hover:brightness-110"
          style={{ background: '#FF5F57' }}
        />
        <button
          onClick={() => win.minimize()}
          className="w-3 h-3 rounded-full hover:brightness-110"
          style={{ background: '#FEBC2E' }}
        />
        <button
          onClick={() => win.toggleMaximize()}
          className="w-3 h-3 rounded-full hover:brightness-110"
          style={{ background: '#28C840' }}
        />
      </div>

      {/* Brand */}
      <span
        className="font-semibold text-sm cursor-default"
        style={{ color: 'var(--cb-text-primary)', marginLeft: 24 }}
        onMouseDown={async (e) => {
          if (e.detail === 2) return;
          await win.startDragging();
        }}
      >
        Codebook
      </span>

      {/* Draggable spacer */}
      <div
        className="flex-1 h-full"
        onMouseDown={async () => { await win.startDragging(); }}
      />

      {/* Right area */}
      <div className="flex items-center shrink-0" style={{ gap: 12 }}>
        {/* Layout toggles */}
        <div className="flex items-center" style={{ gap: 2 }}>
          <button
            onClick={toggleLeftPanel}
            title="Toggle sidebar"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '4px 5px', borderRadius: 4, display: 'flex', alignItems: 'center',
            }}
          >
            <PanelLeft size={15} style={{ color: leftPanelVisible ? 'var(--cb-text-muted)' : 'var(--cb-text-dim)' }} />
          </button>
          <button
            onClick={() => {
              if (!leftPanelVisible || !rightPanelVisible) {
                useAppStore.setState({ leftPanelVisible: true, rightPanelVisible: true });
              }
            }}
            title="Show all panels"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '4px 5px', borderRadius: 4, display: 'flex', alignItems: 'center',
            }}
          >
            <Columns3 size={15} style={{ color: leftPanelVisible && rightPanelVisible ? 'var(--cb-text-muted)' : 'var(--cb-text-dim)' }} />
          </button>
          <button
            onClick={toggleRightPanel}
            title="Toggle right panel"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '4px 5px', borderRadius: 4, display: 'flex', alignItems: 'center',
            }}
          >
            <PanelRight size={15} style={{ color: rightPanelVisible ? 'var(--cb-text-muted)' : 'var(--cb-text-dim)' }} />
          </button>
        </div>

        <div className="shrink-0" style={{ width: 1, height: 16, background: 'var(--cb-border)' }} />

        {/* CLI status badge */}
        <div
          className="flex items-center shrink-0 rounded-full"
          style={{ background: 'var(--cb-bg-elevated)', border: '1px solid var(--cb-border)', padding: '4px 12px', gap: 6 }}
        >
          <div className="shrink-0" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cb-accent-green)' }} />
          <Sparkles size={13} style={{ color: 'var(--cb-text-secondary)' }} />
          <span className="whitespace-nowrap" style={{ color: 'var(--cb-text-secondary)', fontSize: 11, fontWeight: 500 }}>
            Claude CLI
          </span>
        </div>

        <div className="shrink-0" style={{ width: 1, height: 16, background: 'var(--cb-border)' }} />

        {/* Remote connect */}
        <div style={{ position: 'relative' }}>
          <div
            className="cursor-pointer shrink-0"
            style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
            onClick={() => setRemoteOpen((v) => !v)}
          >
            <Smartphone
              size={15}
              style={{ color: clientCount > 0 ? 'var(--cb-accent)' : remoteOpen ? 'var(--cb-accent)' : 'var(--cb-text-dim)' }}
            />
            {clientCount > 0 && (
              <span style={{
                position: 'absolute', top: -6, right: -8,
                background: 'var(--cb-accent)', color: 'var(--cb-bg-primary)',
                fontSize: 9, fontWeight: 700, lineHeight: '14px',
                width: 14, height: 14, borderRadius: 7,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {clientCount}
              </span>
            )}
          </div>
          {remoteOpen && <RemoteConnectPopup onClose={() => setRemoteOpen(false)} />}
          {/* Connection toast */}
          {showConnectToast && (
            <div style={{
              position: 'absolute', top: 32, right: 0, zIndex: 100,
              background: 'var(--cb-bg-elevated)', border: '1px solid #3A3530', borderRadius: 8,
              padding: '8px 14px', whiteSpace: 'nowrap',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              display: 'flex', alignItems: 'center', gap: 8,
              animation: 'fadeIn 0.2s ease-out',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--cb-accent-green)' }} />
              <span style={{ fontSize: 12, color: 'var(--cb-text-primary)', fontWeight: 500 }}>
                Mobile device connected
              </span>
            </div>
          )}
        </div>

        <Sun size={15} className="cursor-pointer shrink-0" style={{ color: 'var(--cb-text-dim)' }} />
        <Maximize size={15} className="cursor-pointer shrink-0" style={{ color: 'var(--cb-text-dim)' }} />
      </div>
    </div>
  );
}
