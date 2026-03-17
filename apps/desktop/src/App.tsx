import { useCallback, useEffect, useRef } from 'react';
import { LeftPanel } from './components/layout/LeftPanel';
import { CenterPanel } from './components/layout/CenterPanel';
import { RightPanel } from './components/layout/RightPanel';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { useAppStore } from './stores/useAppStore';

type DragTarget = 'left' | 'right' | null;

export default function App() {
  const {
    leftPanelWidth,
    rightPanelWidth,
    settingsOpen,
    setLeftPanelWidth,
    setRightPanelWidth,
  } = useAppStore();

  useEffect(() => {
    useAppStore.getState().init();

    // Prevent browser default file open on drag/drop globally
    const preventDrop = (e: DragEvent) => { e.preventDefault(); };
    document.addEventListener('dragover', preventDrop);
    document.addEventListener('drop', preventDrop);
    return () => {
      document.removeEventListener('dragover', preventDrop);
      document.removeEventListener('drop', preventDrop);
    };
  }, []);

  const dragTarget = useRef<DragTarget>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback(
    (target: 'left' | 'right', e: React.MouseEvent) => {
      e.preventDefault();
      dragTarget.current = target;
      startX.current = e.clientX;
      startWidth.current =
        target === 'left' ? leftPanelWidth : rightPanelWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [leftPanelWidth, rightPanelWidth]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragTarget.current) return;
      const delta = e.clientX - startX.current;

      if (dragTarget.current === 'left') {
        const next = Math.min(400, Math.max(200, startWidth.current + delta));
        setLeftPanelWidth(next);
      } else {
        const next = Math.min(800, Math.max(260, startWidth.current - delta));
        setRightPanelWidth(next);
      }
    };

    const onMouseUp = () => {
      if (dragTarget.current) {
        dragTarget.current = null;
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
  }, [setLeftPanelWidth, setRightPanelWidth]);

  return (
    <>
      {settingsOpen && <SettingsPanel />}
      <div id="app-main" className="flex h-screen w-screen overflow-hidden" style={{ background: '#0A0A0A', borderRadius: 10 }}>
        {/* left panel */}
        <div
          className="shrink-0 h-full overflow-hidden"
          style={{ width: leftPanelWidth }}
        >
          <LeftPanel />
        </div>

        {/* left resize handle */}
        <div
          onMouseDown={(e) => onMouseDown('left', e)}
          className="w-[1px] shrink-0 cursor-col-resize hover:w-[3px] hover:bg-[#10B981] transition-all"
          style={{ background: '#2a2a2a' }}
        />

        {/* center panel */}
        <div className="flex-1 h-full min-w-0 overflow-hidden">
          <CenterPanel />
        </div>

        {/* right resize handle */}
        <div
          onMouseDown={(e) => onMouseDown('right', e)}
          className="w-[1px] shrink-0 cursor-col-resize hover:w-[3px] hover:bg-[#10B981] transition-all"
          style={{ background: '#2a2a2a' }}
        />

        {/* right panel */}
        <div
          className="shrink-0 h-full overflow-hidden"
          style={{ width: rightPanelWidth }}
        >
          <RightPanel />
        </div>
      </div>
    </>
  );
}

