import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Stroke, StrokePoint, PenTool } from '../types/note';
import { renderStroke } from '../utils/inkSmoothing';
import { 
  isSpenBarrelOrEraser, 
  isSpenButtonPressed, 
  isSpenHardwareKeyEvent 
} from '../utils/spenDetection';
import { PenToolbar } from './PenToolbar';
import { SPenQuickMenu } from './SPenQuickMenu';
import { Eraser, Sparkles, Feather, Activity } from 'lucide-react';

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

/**
 * Pleasant offline Web Audio API acoustic chime on tool transition
 */
function playToggleAudioFeedback(isEraser: boolean) {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    // Eraser is a lower descending tone, Pen is a bright ascending chime
    const startFreq = isEraser ? 360 : 720;
    const endFreq = isEraser ? 200 : 980;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + 0.07);

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);

    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  } catch {}
}

function getToolLabel(tool: PenTool): string {
  switch (tool) {
    case 'fountain': return 'Fountain Pen';
    case 'pen': return 'Ballpoint Pen';
    case 'highlighter': return 'Highlighter';
    case 'eraser': return 'Eraser';
    case 'lasso': return 'Lasso';
    default: return 'Pen';
  }
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

  // Inking state: Selected primary tool by user (fountain, ballpoint, highlighter, or eraser)
  const [selectedTool, setSelectedTool] = useState<PenTool>('fountain');
  const [penColor, setPenColor] = useState<string>(isDarkMode ? '#ffffff' : '#1e293b');
  const [penWidth, setPenWidth] = useState<number>(4);
  const [isStylusOnly, setIsStylusOnly] = useState<boolean>(false);

  // Momentary S Pen button state: active while holding button down, reverts on release
  const [isSpenButtonHeld, setIsSpenButtonHeld] = useState<boolean>(false);
  const isSpenButtonHeldRef = useRef<boolean>(false);
  const selectedToolRef = useRef<PenTool>('fountain');

  // Effective tool: If S Pen button is held, temporarily switch to Eraser; otherwise use selectedTool
  const activeTool: PenTool = isSpenButtonHeld ? 'eraser' : selectedTool;

  // Keep ref in sync for event listeners
  useEffect(() => {
    selectedToolRef.current = selectedTool;
  }, [selectedTool]);

  // S Pen Feedback overlay
  const [hoverFeedback, setHoverFeedback] = useState<{ label: string; tool: PenTool; x: number; y: number } | null>(null);
  const [isQuickMenuOpen, setIsQuickMenuOpen] = useState<boolean>(false);
  const [quickMenuPos, setQuickMenuPos] = useState<{ x: number; y: number } | null>(null);

  // Live Stylus Telemetry & Diagnostics (for Galaxy Tab S10 verification)
  const [diagnosticHUD, setDiagnosticHUD] = useState<boolean>(false);
  const [stylusTelemetry, setStylusTelemetry] = useState<{
    status: 'idle' | 'hovering' | 'drawing';
    buttons: number;
    button: number;
    pressure: number;
    lastTrigger: string;
  }>({
    status: 'idle',
    buttons: 0,
    button: -1,
    pressure: 0,
    lastTrigger: 'None'
  });

  const hoverFeedbackTimerRef = useRef<any>(null);
  const lastStylusHoverPosRef = useRef<{ x: number; y: number }>({ x: 300, y: 300 });
  const lastStylusActiveTimeRef = useRef<number>(0);

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
   * Updates momentary S Pen button held state:
   * - While button is HELD: Eraser is active
   * - When button is RELEASED: Reverts back to selected pen
   * - Touching the screen NEVER toggles the tool!
   */
  const updateSpenButtonHeld = useCallback((held: boolean, clientX?: number, clientY?: number, source: string = 'spen') => {
    if (isSpenButtonHeldRef.current === held) return;
    isSpenButtonHeldRef.current = held;
    setIsSpenButtonHeld(held);

    const base = selectedToolRef.current;

    // Haptic & Acoustic feedback on button transition
    if (held) {
      playToggleAudioFeedback(true);
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate(35);
        }
      } catch {}
    } else {
      playToggleAudioFeedback(false);
    }

    const container = containerRef.current;
    const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 600 };
    const localX = typeof clientX === 'number' ? clientX - rect.left : rect.width / 2;
    const localY = typeof clientY === 'number' ? clientY - rect.top : 80;

    const label = held ? 'Eraser (Hold)' : `Switched back to ${getToolLabel(base)}`;

    setHoverFeedback({
      label,
      tool: held ? 'eraser' : base,
      x: Math.max(100, Math.min(rect.width - 100, localX)),
      y: Math.max(70, Math.min(rect.height - 70, localY - 35))
    });

    setStylusTelemetry((prev) => ({
      ...prev,
      lastTrigger: `${source}: ${held ? 'HELD (Eraser)' : 'RELEASED (Pen)'} (${new Date().toLocaleTimeString()})`
    }));

    if (hoverFeedbackTimerRef.current) clearTimeout(hoverFeedbackTimerRef.current);
    hoverFeedbackTimerRef.current = setTimeout(() => {
      setHoverFeedback(null);
    }, held ? 2500 : 1200);
  }, []);

  // Global window listeners for capturing S Pen hardware button interrupts across all browser layers
  useEffect(() => {
    // 1. Pointer Move & Pointer Raw Update (Tracks button state in mid-air and on glass)
    const handleGlobalPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        lastStylusActiveTimeRef.current = Date.now();
        lastStylusHoverPosRef.current = { x: e.clientX, y: e.clientY };

        const isHovering = e.pressure <= 0.05;
        const isPressed = isSpenButtonPressed(e.buttons, e.button, e.pressure);

        setStylusTelemetry((prev) => ({
          ...prev,
          status: isHovering ? 'hovering' : 'drawing',
          buttons: e.buttons,
          button: e.button,
          pressure: e.pressure
        }));

        // Update momentary button held state (switches to eraser while pressed, back to pen when released)
        if (isPressed !== isSpenButtonHeldRef.current) {
          updateSpenButtonHeld(isPressed, e.clientX, e.clientY, isHovering ? 'hover-move' : 'contact-move');
        }
      }
    };

    // 2. Pointer Down (Stylus contact without toggling)
    const handleGlobalPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        lastStylusActiveTimeRef.current = Date.now();
        lastStylusHoverPosRef.current = { x: e.clientX, y: e.clientY };

        const isPressed = isSpenButtonPressed(e.buttons, e.button, e.pressure);
        if (isPressed !== isSpenButtonHeldRef.current) {
          updateSpenButtonHeld(isPressed, e.clientX, e.clientY, 'pointerdown');
        }
      }
    };

    // 3. Samsung One UI Context Menu (Fired by Samsung Internet when S Pen button is pressed in the air)
    const handleGlobalContextMenu = (e: MouseEvent) => {
      const isPenEvent = (e as any).pointerType === 'pen';
      const isRecentPen = Date.now() - lastStylusActiveTimeRef.current < 2000;

      if (isPenEvent || isRecentPen) {
        e.preventDefault();
        e.stopPropagation();
        updateSpenButtonHeld(true, e.clientX, e.clientY, 'contextmenu');
      }
    };

    // 4. Aux Click (Middle/Aux button click on Android Chromium)
    const handleGlobalAuxClick = (e: MouseEvent) => {
      const isPenEvent = (e as any).pointerType === 'pen';
      const isRecentPen = Date.now() - lastStylusActiveTimeRef.current < 2000;

      if (isPenEvent || isRecentPen || isSpenBarrelOrEraser(e.buttons, e.button)) {
        e.preventDefault();
        e.stopPropagation();
        updateSpenButtonHeld(true, e.clientX, e.clientY, 'auxclick');
      }
    };

    // 5. Android 14+ Stylus Hardware Button Key Events (Keycode 308 / 309)
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (isSpenHardwareKeyEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
        updateSpenButtonHeld(
          true,
          lastStylusHoverPosRef.current.x, 
          lastStylusHoverPosRef.current.y, 
          `key-down-${e.keyCode || e.code}`
        );
      }
    };

    const handleGlobalKeyUp = (e: KeyboardEvent) => {
      if (isSpenHardwareKeyEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
        updateSpenButtonHeld(
          false,
          lastStylusHoverPosRef.current.x, 
          lastStylusHoverPosRef.current.y, 
          `key-up-${e.keyCode || e.code}`
        );
      }
    };

    // Window capture listeners for maximum priority before browser consumption
    window.addEventListener('pointermove', handleGlobalPointerMove, { capture: true, passive: true });
    window.addEventListener('pointerdown', handleGlobalPointerDown, { capture: true });
    window.addEventListener('contextmenu', handleGlobalContextMenu, { capture: true });
    window.addEventListener('auxclick', handleGlobalAuxClick, { capture: true });
    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });
    window.addEventListener('keyup', handleGlobalKeyUp, { capture: true });

    // pointerrawupdate for ultra-fast 120Hz polling on Chromium Android
    if ('onpointerrawupdate' in window) {
      window.addEventListener('pointerrawupdate' as any, handleGlobalPointerMove as any, { capture: true, passive: true });
    }

    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove, { capture: true });
      window.removeEventListener('pointerdown', handleGlobalPointerDown, { capture: true });
      window.removeEventListener('contextmenu', handleGlobalContextMenu, { capture: true });
      window.removeEventListener('auxclick', handleGlobalAuxClick, { capture: true });
      window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
      window.removeEventListener('keyup', handleGlobalKeyUp, { capture: true });
      if ('onpointerrawupdate' in window) {
        window.removeEventListener('pointerrawupdate' as any, handleGlobalPointerMove as any, { capture: true });
      }
      if (hoverFeedbackTimerRef.current) clearTimeout(hoverFeedbackTimerRef.current);
    };
  }, [updateSpenButtonHeld]);

  // Pointer Down (stylus touches screen - NEVER toggles the tool)
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

    // Check if the S Pen button is held on touch-down
    if (e.pointerType === 'pen') {
      const isPressed = isSpenButtonPressed(e.buttons, e.button, e.pressure);
      if (isPressed !== isSpenButtonHeldRef.current) {
        updateSpenButtonHeld(isPressed, e.clientX, e.clientY, 'canvas-down');
      }
    }

    e.currentTarget.setPointerCapture(e.pointerId);

    // Determine current tool to draw with: activeTool is 'eraser' if button is held, else selectedTool
    const currentDrawingTool = isSpenButtonHeldRef.current ? 'eraser' : selectedToolRef.current;

    const startPoint = getCanvasPoint(e);
    const newStroke: Stroke = {
      id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      points: [startPoint],
      color: currentDrawingTool === 'eraser' ? '#ffffff' : penColor,
      width: currentDrawingTool === 'eraser' ? Math.max(penWidth, 12) : penWidth,
      tool: currentDrawingTool,
      opacity: currentDrawingTool === 'highlighter' ? 0.4 : 1.0
    };

    currentStrokeRef.current = newStroke;
    redraw();
  };

  // Pointer Move (coalesced 120Hz events loop + momentary button tracking)
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen') {
      const isPressed = isSpenButtonPressed(e.buttons, e.button, e.pressure);
      if (isPressed !== isSpenButtonHeldRef.current) {
        updateSpenButtonHeld(isPressed, e.clientX, e.clientY, 'canvas-move');

        // If tool changes mid-stroke (e.g. user pressed/released button while drawing)
        if (currentStrokeRef.current && currentStrokeRef.current.points.length > 1) {
          const updated = [...strokes.slice(0, historyIndex), currentStrokeRef.current];
          onChangeStrokes(updated);
          setHistoryIndex(updated.length);

          const newTool = isPressed ? 'eraser' : selectedToolRef.current;
          const lastPt = currentStrokeRef.current.points[currentStrokeRef.current.points.length - 1];

          currentStrokeRef.current = {
            id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            points: [lastPt],
            color: newTool === 'eraser' ? '#ffffff' : penColor,
            width: newTool === 'eraser' ? Math.max(penWidth, 12) : penWidth,
            tool: newTool,
            opacity: newTool === 'highlighter' ? 0.4 : 1.0
          };
        }
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

  // Pointer Up (stylus leaves screen)
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }

    if (e.pointerType === 'pen') {
      isStylusActiveRef.current = false;
      // If button was released on lift
      const isPressed = isSpenButtonPressed(e.buttons, e.button, 0);
      if (!isPressed && isSpenButtonHeldRef.current) {
        updateSpenButtonHeld(false, e.clientX, e.clientY, 'canvas-up');
      }
    }

    if (!currentStrokeRef.current) return;

    // Discard single-point dots or zero-length strokes produced by palm brushes
    if (currentStrokeRef.current.points.length > 1) {
      const updated = [...strokes.slice(0, historyIndex), currentStrokeRef.current];
      onChangeStrokes(updated);
      setHistoryIndex(updated.length);
    }

    currentStrokeRef.current = null;
    redraw();
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    handlePointerUp(e);
  };

  // Prevent default context menu from consuming S Pen button gestures on the canvas
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    updateSpenButtonHeld(true, e.clientX, e.clientY, 'canvas-contextmenu');
  };

  const handleAuxClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    updateSpenButtonHeld(true, e.clientX, e.clientY, 'canvas-auxclick');
  };

  // History controls
  const handleUndo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
    }
  };

  const handleRedo = () => {
    if (historyIndex < strokes.length) {
      setHistoryIndex(historyIndex + 1);
    }
  };

  const handleClear = () => {
    if (strokes.length === 0) return;
    if (window.confirm('Clear all handwriting strokes from this note?')) {
      onChangeStrokes([]);
      setHistoryIndex(0);
      currentStrokeRef.current = null;
      redraw();
    }
  };

  // Manual toggle handler for on-screen buttons
  const handleManualToolSelect = (tool: PenTool) => {
    setSelectedTool(tool);
    setIsSpenButtonHeld(false);
    isSpenButtonHeldRef.current = false;
  };

  return (
    <div className="flex flex-col w-full h-full relative select-none">
      {/* Top Floating Pen Toolbar */}
      <div className="px-4 py-2 flex justify-center items-center z-10 pointer-events-auto">
        <PenToolbar
          activeTool={activeTool}
          onSelectTool={handleManualToolSelect}
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
          onOpenSPenMenu={() => setIsQuickMenuOpen(true)}
        />
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
              <span>S Pen: {hoverFeedback.label}</span>
            </div>
          </div>
        )}

        {strokes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-ink-muted-light/60 dark:text-ink-muted-dark/60 text-sm">
            <p className="font-medium">Write with S Pen or Apple Pencil</p>
            <p className="text-xs mt-1">
              Hold S Pen button to Erase • Release to return to Pen • 120Hz Coalesced
            </p>
          </div>
        )}

        {/* Bottom Left: S Pen Live Telemetry / Diagnostic Badge */}
        <div className="absolute bottom-4 left-4 z-10 flex flex-col items-start gap-1">
          <button
            type="button"
            onClick={() => setDiagnosticHUD(!diagnosticHUD)}
            title="Click to toggle S Pen Live Diagnostic HUD"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-surface-light/80 dark:bg-surface-dark/80 backdrop-blur-md border border-surface-subtle-light dark:border-surface-subtle-dark text-[11px] font-medium text-ink-muted-light dark:text-ink-muted-dark shadow-subtle hover:text-ink-light dark:hover:text-ink-dark transition"
          >
            <span className={`w-2 h-2 rounded-full ${isSpenButtonHeld ? 'bg-rose-500 animate-pulse' : stylusTelemetry.status === 'hovering' ? 'bg-emerald-500' : stylusTelemetry.status === 'drawing' ? 'bg-violet-500' : 'bg-slate-400'}`} />
            <span>
              S Pen: {isSpenButtonHeld ? 'Eraser (Holding Button)' : stylusTelemetry.status === 'hovering' ? 'Hovering (Pen)' : stylusTelemetry.status === 'drawing' ? 'Inking' : 'Ready'}
            </span>
            <Activity className="w-3 h-3 ml-0.5 opacity-60" />
          </button>

          {diagnosticHUD && (
            <div className="p-2.5 rounded-xl bg-surface-light/95 dark:bg-surface-dark/95 backdrop-blur-md border border-surface-subtle-light dark:border-surface-subtle-dark shadow-floating text-[10px] font-mono text-ink-light dark:text-ink-dark space-y-1 animate-in fade-in">
              <div>Button Held: <span className={isSpenButtonHeld ? "font-bold text-rose-500" : "text-emerald-500"}>{isSpenButtonHeld ? "YES (Eraser)" : "NO (Writing Pen)"}</span></div>
              <div>Buttons: <span className="font-semibold text-violet-500">{stylusTelemetry.buttons}</span> (button: {stylusTelemetry.button})</div>
              <div>Pressure: <span className="font-semibold">{stylusTelemetry.pressure.toFixed(2)}</span></div>
              <div>Last Event: <span className="text-emerald-500">{stylusTelemetry.lastTrigger}</span></div>
            </div>
          )}
        </div>

        {/* Bottom Right: Quick S Pen Floating Trigger Badge */}
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
          {/* 1-Tap Quick Tool Flip Pill */}
          <button
            type="button"
            onClick={() => {
              if (selectedTool === 'eraser') {
                handleManualToolSelect('fountain');
              } else {
                handleManualToolSelect('eraser');
              }
            }}
            title="Toggle between Pen and Eraser (or hold S Pen button)"
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
          handleManualToolSelect(tool);
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
