import { getCurrentWindow } from '@tauri-apps/api/window';
import { Sparkles, Sun, Maximize, PanelLeft, PanelRight, Columns3 } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';

export function TopHeader() {
  const win = getCurrentWindow();
  const {
    leftPanelVisible,
    rightPanelVisible,
    toggleLeftPanel,
    toggleRightPanel,
  } = useAppStore();

  return (
    <div
      data-no-select
      className="flex items-center shrink-0"
      style={{
        height: 44,
        background: '#1C1917',
        borderBottom: '1px solid #2A2520',
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
        className="font-semibold text-sm cursor-default ml-4"
        style={{ color: '#E8E4E0' }}
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
            <PanelLeft size={15} style={{ color: leftPanelVisible ? '#9C9690' : '#4A4540' }} />
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
            <Columns3 size={15} style={{ color: leftPanelVisible && rightPanelVisible ? '#9C9690' : '#4A4540' }} />
          </button>
          <button
            onClick={toggleRightPanel}
            title="Toggle right panel"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '4px 5px', borderRadius: 4, display: 'flex', alignItems: 'center',
            }}
          >
            <PanelRight size={15} style={{ color: rightPanelVisible ? '#9C9690' : '#4A4540' }} />
          </button>
        </div>

        <div className="shrink-0" style={{ width: 1, height: 16, background: '#2A2520' }} />

        {/* CLI status badge */}
        <div
          className="flex items-center shrink-0 rounded-full"
          style={{ background: '#262220', border: '1px solid #2A2520', padding: '4px 12px', gap: 6 }}
        >
          <div className="shrink-0" style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ADE80' }} />
          <Sparkles size={13} style={{ color: '#C8C4BE' }} />
          <span className="whitespace-nowrap" style={{ color: '#C8C4BE', fontSize: 11, fontWeight: 500 }}>
            Claude CLI
          </span>
        </div>

        <div className="shrink-0" style={{ width: 1, height: 16, background: '#2A2520' }} />

        <Sun size={15} className="cursor-pointer shrink-0" style={{ color: '#6B6560' }} />
        <Maximize size={15} className="cursor-pointer shrink-0" style={{ color: '#6B6560' }} />
      </div>
    </div>
  );
}
