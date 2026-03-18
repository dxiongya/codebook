import { useCallback, useEffect, useRef } from 'react';
import { LeftPanel } from './components/layout/LeftPanel';
import { CenterPanel } from './components/layout/CenterPanel';
import { RightPanel } from './components/layout/RightPanel';
import { TopHeader } from './components/layout/TopHeader';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { useAppStore } from './stores/useAppStore';

type DragTarget = 'left' | 'right' | null;

export default function App() {
  const {
    leftPanelWidth,
    rightPanelWidth,
    leftPanelVisible,
    rightPanelVisible,
    settingsOpen,
    setLeftPanelWidth,
    setRightPanelWidth,
  } = useAppStore();

  useEffect(() => {
    useAppStore.getState().init();

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
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const rafId = useRef(0);

  const onMouseDown = useCallback(
    (target: 'left' | 'right', e: React.MouseEvent) => {
      e.preventDefault();
      dragTarget.current = target;
      startX.current = e.clientX;
      // Read actual DOM width (not state) since we manipulate DOM directly during drag
      const ref = target === 'left' ? leftRef.current : rightRef.current;
      startWidth.current = ref ? ref.offsetWidth : (target === 'left' ? leftPanelWidth : rightPanelWidth);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [leftPanelWidth, rightPanelWidth]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragTarget.current) return;

      // Use rAF to throttle DOM updates
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        const delta = e.clientX - startX.current;

        if (dragTarget.current === 'left') {
          const next = Math.min(400, Math.max(200, startWidth.current + delta));
          // Direct DOM update during drag (no React re-render)
          if (leftRef.current) leftRef.current.style.width = `${next}px`;
        } else {
          const next = Math.min(800, Math.max(260, startWidth.current - delta));
          if (rightRef.current) rightRef.current.style.width = `${next}px`;
        }
      });
    };

    const onMouseUp = (e: MouseEvent) => {
      if (dragTarget.current) {
        cancelAnimationFrame(rafId.current);
        // Commit final width to store on mouseup
        const delta = e.clientX - startX.current;
        if (dragTarget.current === 'left') {
          const next = Math.min(400, Math.max(200, startWidth.current + delta));
          setLeftPanelWidth(next);
        } else {
          const next = Math.min(800, Math.max(260, startWidth.current - delta));
          setRightPanelWidth(next);
        }
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
      <div
        id="app-main"
        className="flex flex-col h-screen w-screen overflow-hidden"
        style={{ background: '#1C1917', borderRadius: 10 }}
      >
        {/* Top header bar */}
        <TopHeader />

        {/* Body: sidebar + center + right */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* left panel */}
          {leftPanelVisible && (
            <>
              <div
                ref={leftRef}
                className="shrink-0 h-full overflow-hidden"
                style={{ width: leftPanelWidth }}
              >
                <LeftPanel />
              </div>
              <div
                onMouseDown={(e) => onMouseDown('left', e)}
                className="shrink-0 cursor-col-resize group"
                style={{ width: 1, position: 'relative', background: '#2A2520' }}
              >
                {/* Invisible wider hit area */}
                <div style={{ position: 'absolute', inset: '-0 -4px', zIndex: 10 }} />
                {/* Visible hover indicator */}
                <div className="absolute inset-0 transition-colors duration-100 group-hover:bg-[#E5A54B]" />
              </div>
            </>
          )}

          {/* center panel */}
          <div className="flex-1 h-full min-w-0 overflow-hidden">
            <CenterPanel />
          </div>

          {/* right panel */}
          {rightPanelVisible && (
            <>
              <div
                onMouseDown={(e) => onMouseDown('right', e)}
                className="shrink-0 cursor-col-resize group"
                style={{ width: 1, position: 'relative', background: '#2A2520' }}
              >
                {/* Invisible wider hit area */}
                <div style={{ position: 'absolute', inset: '-0 -4px', zIndex: 10 }} />
                {/* Visible hover indicator */}
                <div className="absolute inset-0 transition-colors duration-100 group-hover:bg-[#E5A54B]" />
              </div>
              <div
                ref={rightRef}
                className="shrink-0 h-full overflow-hidden"
                style={{ width: rightPanelWidth }}
              >
                <RightPanel />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
