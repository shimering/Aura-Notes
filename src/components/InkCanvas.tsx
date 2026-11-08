import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Stroke, StrokePoint, PenTool } from '../types/note';
import { renderStroke } from '../utils/inkSmoothing';
import { isSpenBarrelOrEraser, toggleSpenHoverTool } from '../utils/spenDetection';
import { PenToolbar } from './PenToolbar';
import { SPenQuickMenu } from './SPenQuickMenu';
import { Eraser, Sparkles, Feather, Pen as PenIcon } from 'lucide-react';

export interface InkCanvasRef {
  getCanvasElement: () => HTMLCanvasElement | null;
  exportImageData: () => ImageData | null;
  exportDataUrl: () => string;
}

interface InkCanvasProps {
  strokes: Stroke[];
  onChangeStrokes: (strokes: Stroke[]) => void;
  onScribbleToText: () => void;
}

export const InkCanvas = forwardRef<InkCanvasRef, InkCanvasProps>(({
  strokes,
  onChangeStrokes,
  onScribbleToText
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Detect dark mode for initial ink color
  const isDarkMode = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  // Inking state
  const [activeTool, setActiveTool] = useState<PenTool>('fountain');
  const [penColor, setPenColor] = useState<string>(isDarkMode ? '#ffffff' : '#1e293b');
  const [penWidth, setPenWidth] = useState<number>(4);
  const [isStylusOnly, setIsStylusOnly] = useState<boolean>(false);

  // S Pen Hover Feedback
  const [hoverFeedback, setHoverFeedback] = useState<{ label: string; tool: PenTool; x: number; y: number } | null>(null);
  const [isQuickMenuOpen, setIsQuickMenuOpen] = useState<boolean>(false);
  const [quickMenuPos, setQuickMenuPos] = useState<{ x: number; y: number } | null>(null);

  const priorToolBeforeHoldRef = useRef<PenTool>('fountain');
  const lastSpenHoverTimeRef = useRef<number>(0);
  const hoverFeedbackTimerRef = useRef<any>(null);

  // History for Undo/Redo
  const [historyIndex, setHistoryIndex] = useState<number>(strokes.length);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const isStylusActiveRef = useRef<boolean>(false);

  // Expose methods for OCR engine
  useImperativeHandle(ref, () => ({
    getCanvasElement: () => canvasRef.current,
    exportImageData: () => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    },
    exportDataUrl: () => {
      const canvas = canvasRef.current;
      return canvas ? canvas.toDataURL('image/png') : '';
    }
  }));

  // Synchronize internal history pointer when external note changes
  useEffect(() => {
    setHistoryIndex(strokes.length);
  }, [strokes]);

  // Redraw all strokes on canvas
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Render strokes up to history index
    const visibleStrokes = strokes.slice(0, historyIndex);
    for (const stroke of visibleStrokes) {
      renderStroke(ctx, stroke, dpr);
    }

    // Render current active stroke live
    if (currentStrokeRef.current) {
      renderStroke(ctx, currentStrokeRef.current, dpr);
    }
  }, [strokes, historyIndex]);

  // Handle canvas resize and high-DPI scaling using ResizeObserver
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    redraw();
  }, [redraw]);

  // Attach ResizeObserver to container to handle sidebar collapse and mode switches
  useEffect(() => {
    resizeCanvas();
    if (!containerRef.current) return;

    const ro = new ResizeObserver(() => {
      resizeCanvas();
    });
    ro.observe(containerRef.current);

    window.addEventListener('resize', resizeCanvas);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [resizeCanvas]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Extract pointer coordinates relative to canvas
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, pressure: 0.5, time: Date.now() };

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let pressure = e.pressure;
    if (pressure === 0 && e.pointerType === 'pen') {
      pressure = 0.5;
    } else if (pressure === 0) {
      pressure = 0.5;
    }

    return {
      x,
      y,
      pressure,
      time: Date.now()
    };
  };

  /**
   * Triggers tool toggle specifically when S Pen button is pressed while HOVERING
   */
  const triggerSpenHoverToggle = useCallback((clientX?: number, clientY?: number) => {
    const now = Date.now();
    // Debounce 300ms to avoid double trigger
    if (now - lastSpenHoverTimeRef.current < 300) return;
    lastSpenHoverTimeRef.current = now;

    // Haptic feedback click on Samsung Galaxy Tab
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(40);
      }
    } catch {}

    setActiveTool((currTool) => {
      const toggleRes = toggleSpenHoverTool(currTool, priorToolBeforeHoldRef.current);
      priorToolBeforeHoldRef.current = toggleRes.savedPriorTool;

      const container = containerRef.current;
      const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 600 };
      const localX = typeof clientX === 'number' ? clientX - rect.left : rect.width / 2;
      const localY = typeof clientY === 'number' ? clientY - rect.top : 80;

      setHoverFeedback({
        label: toggleRes.label,
        tool: toggleRes.nextTool,
        x: Math.max(100, Math.min(rect.width - 100, localX)),
        y: Math.max(70, Math.min(rect.height - 70, localY - 35))
      });

      if (hoverFeedbackTimerRef.current) clearTimeout(hoverFeedbackTimerRef.current);
      hoverFeedbackTimerRef.current = setTimeout(() => {
        setHoverFeedback(null);
      }, 1600);

      return toggleRes.nextTool;
    });
  }, []);

  // Global capture for S Pen hardware button interrupts across the window
  useEffect(() => {
    const handleGlobalPointerCapture = (e: PointerEvent) => {
      if (e.pointerType === 'pen' && isSpenBarrelOrEraser(e.buttons, e.button)) {
        triggerSpenHoverToggle(e.clientX, e.clientY);
      }
    };

    const handleGlobalAuxClick = (e: MouseEvent) => {
      if ((e as any).pointerType === 'pen' || isSpenBarrelOrEraser(e.buttons, e.button)) {
        e.preventDefault();
        triggerSpenHoverToggle(e.clientX, e.clientY);
      }
    };

    window.addEventListener('pointerdown', handleGlobalPointerCapture, { capture: true });
    window.addEventListener('auxclick', handleGlobalAuxClick, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerCapture, { capture: true });
      window.removeEventListener('auxclick', handleGlobalAuxClick, { capture: true });
      if (hoverFeedbackTimerRef.current) clearTimeout(hoverFeedbackTimerRef.current);
    };
  }, [triggerSpenHoverToggle]);

  // Pointer Down (stylus touches screen)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 1. Stylus-Only Mode: Completely ignore any non-pen touch
    if (isStylusOnly && e.pointerType !== 'pen') {
      return;
    }

    // 2. Palm Rejection via Contact Geometry:
    // Natural palm rests on Galaxy Tab/iPad produce contact dimensions > 20px
    if (e.pointerType === 'touch' && (e.width > 22 || e.height > 22)) {
      return; // Reject broad palm contact
    }

    // 3. Stylus priority palm rejection
    if (e.pointerType === 'pen') {
      isStylusActiveRef.current = true;
    } else if (isStylusActiveRef.current && e.pointerType === 'touch') {
      return; // Ignore finger/palm touch while pen is hovering/touching
    }

    // S Pen button click check on touch:
    // Android Chrome button 1 (auxiliary), button 2 (secondary), buttons & 4, buttons & 2, buttons & 32
    if (e.pointerType === 'pen' && isSpenBarrelOrEraser(e.buttons, e.button)) {
      e.preventDefault();
      triggerSpenHoverToggle(e.clientX, e.clientY);
      return; // Do not draw an unwanted dot on button press!
    }

    e.currentTarget.setPointerCapture(e.pointerId);

    const startPoint = getCanvasPoint(e);
    const newStroke: Stroke = {
      id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      points: [startPoint],
      color: activeTool === 'eraser' ? '#ffffff' : penColor,
      width: penWidth,
      tool: activeTool,
      opacity: activeTool === 'highlighter' ? 0.4 : 1.0
    };

    currentStrokeRef.current = newStroke;
    redraw();
  };

  // Pointer Move (coalesced 120Hz events loop + S Pen Hover detection)
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // S Pen button detection WHILE HOVERING in the air (not touching screen)
    if (e.pointerType === 'pen' && !currentStrokeRef.current) {
      const hasSpenButton = isSpenBarrelOrEraser(e.buttons, e.button);
      if (hasSpenButton) {
        triggerSpenHoverToggle(e.clientX, e.clientY);
        return;
      }
    }

    if (!currentStrokeRef.current) return;

    if (isStylusOnly && e.pointerType !== 'pen') return;
    if (isStylusActiveRef.current && e.pointerType === 'touch') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // 120Hz Coalesced Events Loop for iPad ProMotion & Galaxy Tab 120Hz AMOLED
    const nativeEvent = e.nativeEvent as PointerEvent;
    const rawEvents = nativeEvent.getCoalescedEvents?.() ?? [];
    const coalescedEvents = rawEvents.length > 0 ? rawEvents : [nativeEvent];

    for (const ce of coalescedEvents) {
      let pressure = ce.pressure;
      if (pressure === 0 && ce.pointerType === 'pen') {
        pressure = 0.5;
      } else if (pressure === 0) {
        pressure = 0.5;
      }

      currentStrokeRef.current.points.push({
        x: ce.clientX - rect.left,
        y: ce.clientY - rect.top,
        pressure,
        time: Date.now()
      });
    }

    redraw();
  };

  // Pointer Up (stylus lifted from screen)
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    if (e.pointerType === 'pen') {
      isStylusActiveRef.current = false;
    }

    if (currentStrokeRef.current) {
      const finishedStroke = currentStrokeRef.current;
      currentStrokeRef.current = null;

      // Truncate any redo branches and append new stroke
      const updatedStrokes = [...strokes.slice(0, historyIndex), finishedStroke];
      setHistoryIndex(updatedStrokes.length);
      onChangeStrokes(updatedStrokes);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    isStylusActiveRef.current = false;
    currentStrokeRef.current = null;
    redraw();
  };

  // Prevent default browser context menu triggered by stylus barrel button or right-click
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    triggerSpenHoverToggle(e.clientX, e.clientY);
  };

  const handleAuxClick = (e: React.MouseEvent) => {
    e.preventDefault();
    triggerSpenHoverToggle(e.clientX, e.clientY);
  };

  // Undo / Redo / Clear handlers
  const handleUndo = () => {
    if (historyIndex > 0) {
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      onChangeStrokes(strokes.slice(0, nextIndex));
    }
  };

  const handleRedo = () => {
    if (historyIndex < strokes.length) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      onChangeStrokes(strokes.slice(0, nextIndex));
    }
  };

  const handleClear = () => {
    if (confirm('Clear all drawings and handwriting from canvas?')) {
      setHistoryIndex(0);
      onChangeStrokes([]);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-canvas-light dark:bg-canvas-dark relative select-none">
      {/* Top Floating Pen Toolbar */}
      <div className="p-3 flex items-center justify-center sticky top-0 z-10 pointer-events-none">
        <div className="pointer-events-auto">
          <PenToolbar
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            color={penColor}
            onChangeColor={setPenColor}
            width={penWidth}
            onChangeWidth={setPenWidth}
            canUndo={historyIndex > 0}
            canRedo={historyIndex < strokes.length}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onClear={handleClear}
            onScribbleToText={onScribbleToText}
            hasStrokes={strokes.length > 0}
            isStylusOnly={isStylusOnly}
            onToggleStylusOnly={() => setIsStylusOnly(!isStylusOnly)}
          />
        </div>
      </div>

      {/* Drawing Canvas Container */}
      <div 
        ref={containerRef} 
        onContextMenu={handleContextMenu}
        onAuxClick={handleAuxClick}
        className="flex-1 w-full h-full relative cursor-crosshair overflow-hidden touch-none"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerCancel}
          onContextMenu={handleContextMenu}
          onAuxClick={handleAuxClick}
          className="ink-canvas absolute inset-0 block w-full h-full"
        />

        {/* Dynamic S Pen Hover Toggle Notification Badge */}
        {hoverFeedback && (
          <div 
            className="absolute z-30 pointer-events-none transform -translate-x-1/2 -translate-y-full transition-all duration-150 animate-in fade-in zoom-in-95"
            style={{ left: `${hoverFeedback.x}px`, top: `${hoverFeedback.y}px` }}
          >
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-surface-dark/95 text-white dark:bg-surface-light/95 dark:text-ink-light shadow-floating text-xs font-semibold backdrop-blur-md border border-white/20">
              {hoverFeedback.tool === 'eraser' ? (
                <Eraser className="w-4 h-4 text-rose-400" />
              ) : (
                <Feather className="w-4 h-4 text-violet-400" />
              )}
              <span>S Pen: Switched to {hoverFeedback.label}</span>
            </div>
          </div>
        )}

        {strokes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-ink-muted-light/60 dark:text-ink-muted-dark/60 text-sm">
            <p className="font-medium">Write with S Pen or Apple Pencil</p>
            <p className="text-xs mt-1">
              Hover S Pen &amp; press button to toggle Eraser / Pen • 120Hz Coalesced
            </p>
          </div>
        )}

        {/* Quick S Pen Floating Trigger Badge (Click to toggle Pen / Eraser or open palette on any device) */}
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
          {/* 1-Tap Quick Tool Flip Pill */}
          <button
            type="button"
            onClick={() => triggerSpenHoverToggle()}
            title="Toggle between Pen and Eraser (or click S Pen button while hovering)"
            className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-surface-light/95 dark:bg-surface-dark/95 backdrop-blur-md border border-surface-subtle-light dark:border-surface-subtle-dark shadow-floating text-xs font-semibold text-ink-light dark:text-ink-dark hover:scale-105 active:scale-95 transition"
          >
            {activeTool === 'eraser' ? (
              <>
                <Feather className="w-3.5 h-3.5 text-violet-500" />
                <span>Switch to Pen</span>
              </>
            ) : (
              <>
                <Eraser className="w-3.5 h-3.5 text-rose-500" />
                <span>Switch to Eraser</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setQuickMenuPos(null);
              setIsQuickMenuOpen(true);
            }}
            title="S Pen Quick Menu (palette & styles)"
            className="p-2.5 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white shadow-floating hover:scale-105 active:scale-95 transition"
          >
            <Sparkles className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* S Pen Quick Menu Palette Modal */}
      <SPenQuickMenu
        isOpen={isQuickMenuOpen}
        onClose={() => setIsQuickMenuOpen(false)}
        position={quickMenuPos}
        activeTool={activeTool}
        onSelectTool={(tool) => {
          setActiveTool(tool);
          setIsQuickMenuOpen(false);
        }}
        color={penColor}
        onChangeColor={(newColor) => {
          setPenColor(newColor);
        }}
        width={penWidth}
        onChangeWidth={(newWidth) => {
          setPenWidth(newWidth);
        }}
      />
    </div>
  );
});

InkCanvas.displayName = 'InkCanvas';
