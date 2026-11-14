import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Stroke, StrokePoint, PenTool, InkBackground, EraserMode } from '../types/note';
import { renderStroke, eraseStrokesNearPoint, eraseStrokesPartial } from '../utils/inkSmoothing';
import { InkHistory } from '../utils/inkHistory';
import { drawInkBackground } from '../utils/inkBackground';
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
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

interface InkCanvasProps {
  noteId: string;
  strokes: Stroke[];
  onChangeStrokes: (strokes: Stroke[]) => void;
  onScribbleToText: () => void;
  background?: InkBackground;
  onChangeBackground?: (background: InkBackground) => void;
  defaultTool?: PenTool;
  defaultColor?: string;
  defaultWidth?: number;
  defaultEraserWidth?: number;
  defaultEraserMode?: EraserMode;
  defaultStylusOnly?: boolean;
}

// Global AudioContext Singleton (prevents hardware exhaustion & browser crash)
let sharedAudioCtx: AudioContext | null = null;

function playToggleAudioFeedback(isEraser: boolean) {
  try {
    if (typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioContextClass();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }

    const osc = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(sharedAudioCtx.destination);

    // Eraser is a lower descending tone, Pen is a bright ascending chime
    const startFreq = isEraser ? 360 : 720;
    const endFreq = isEraser ? 200 : 980;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, sharedAudioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, sharedAudioCtx.currentTime + 0.07);

    gain.gain.setValueAtTime(0.08, sharedAudioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, sharedAudioCtx.currentTime + 0.07);

    osc.start();
    osc.stop(sharedAudioCtx.currentTime + 0.07);
  } catch {}
}

const INK_UI_CONTROL_SELECTOR = 'button, [role="button"], input, label, select';

/**
 * True while interacting with ink UI (toolbar, eraser popover, S Pen menu).
 * S Pen button handling must not arm/disarm the eraser or swallow taps there.
 */
function isInkUiTarget(target: EventTarget | null): boolean {
  return (
    typeof Element !== 'undefined' &&
    target instanceof Element &&
    !!target.closest('[data-ink-ui]')
  );
}

function findInkUiControl(target: EventTarget | null): HTMLElement | null {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return null;
  const control = target.closest<HTMLElement>(INK_UI_CONTROL_SELECTOR);
  if (!control) return null;
  if (control instanceof HTMLButtonElement && control.disabled) return null;
  return control;
}

export const InkCanvas = forwardRef<InkCanvasRef, InkCanvasProps>(({
  noteId,
  strokes,
  onChangeStrokes,
  onScribbleToText,
  background = 'none',
  onChangeBackground,
  defaultTool = 'fountain',
  defaultColor,
  defaultWidth = 4,
  defaultEraserWidth = 24,
  defaultEraserMode = 'object',
  defaultStylusOnly = false
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Detect dark mode for initial ink color
  const isDarkMode = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  // Primary user-selected tool (fountain, ballpoint, highlighter, or eraser)
  const [selectedTool, setSelectedTool] = useState<PenTool>(defaultTool);
  const [penColor, setPenColor] = useState<string>(defaultColor || (isDarkMode ? '#ffffff' : '#1e293b'));
  const [penWidth, setPenWidth] = useState<number>(defaultWidth);
  const [eraserWidth, setEraserWidth] = useState<number>(defaultEraserWidth);
  const [eraserMode, setEraserMode] = useState<EraserMode>(defaultEraserMode);
  const [isStylusOnly, setIsStylusOnly] = useState<boolean>(defaultStylusOnly);

  // Momentary S Pen Eraser State: active while pressing button, DEACTIVATES ON RELEASE
  const [isSpenEraserArmed, setIsSpenEraserArmed] = useState<boolean>(false);
  const isSpenEraserArmedRef = useRef<boolean>(false);
  const selectedToolRef = useRef<PenTool>(defaultTool);
  const lastWritingToolRef = useRef<PenTool>(defaultTool === 'eraser' ? 'fountain' : defaultTool);
  const isEraserDrawingRef = useRef<boolean>(false);
  const lastInkUiClickRef = useRef<{ control: HTMLElement; time: number } | null>(null);

  // Effective tool: If S Pen eraser is armed, tool is 'eraser', else selectedTool
  const activeTool: PenTool = isSpenEraserArmed ? 'eraser' : selectedTool;

  useEffect(() => {
    selectedToolRef.current = selectedTool;
    if (selectedTool !== 'eraser') {
      lastWritingToolRef.current = selectedTool;
    }
  }, [selectedTool]);

  // Keep the canvas in sync when stylus defaults change in Settings. These only
  // fire on actual prop changes, so in-canvas tool picks are never clobbered.
  useEffect(() => {
    setSelectedTool(defaultTool);
  }, [defaultTool]);

  useEffect(() => {
    if (defaultColor) setPenColor(defaultColor);
  }, [defaultColor]);

  useEffect(() => {
    if (typeof defaultWidth === 'number' && defaultWidth > 0) {
      setPenWidth(defaultWidth);
    }
  }, [defaultWidth]);

  useEffect(() => {
    if (typeof defaultEraserWidth === 'number' && defaultEraserWidth > 0) {
      setEraserWidth(defaultEraserWidth);
    }
  }, [defaultEraserWidth]);

  useEffect(() => {
    setEraserMode(defaultEraserMode);
  }, [defaultEraserMode]);

  useEffect(() => {
    setIsStylusOnly(defaultStylusOnly);
  }, [defaultStylusOnly]);

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

  const lastStylusActiveTimeRef = useRef<number>(0);

  // History for Undo/Redo (snapshots of committed stroke arrays, persisted to the note)
  const historyRef = useRef<InkHistory>(new InkHistory(100));
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);

  // Authoritative stroke list for rendering. Mirrors the note prop, but lets an
  // eraser drag preview changes locally and commit a single undoable step on lift.
  const strokesRef = useRef<Stroke[]>(strokes);
  const previewStrokesRef = useRef<Stroke[] | null>(null);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const isStylusActiveRef = useRef<boolean>(false);

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(historyRef.current.canUndo);
    setCanRedo(historyRef.current.canRedo);
  }, []);

  /**
   * S Pen barrel taps arrive as contextmenu/auxclick on Android. When they land
   * on ink UI, replay them as a normal click so mode/size controls stay usable
   * while the S Pen button is held down.
   */
  const clickInkUiControl = useCallback((target: EventTarget | null) => {
    const control = findInkUiControl(target);
    if (!control) return;

    const now = Date.now();
    const last = lastInkUiClickRef.current;
    if (last && last.control === control && now - last.time < 400) return;

    lastInkUiClickRef.current = { control, time: now };
    control.click();
  }, []);

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
    },
    undo: () => handleUndo(),
    redo: () => handleRedo(),
    clear: () => handleClear()
  }));

  // Sync externally-provided strokes (note switch, OCR clear, cloud merge)
  useEffect(() => {
    strokesRef.current = strokes;
    if (!isEraserDrawingRef.current && !currentStrokeRef.current) {
      previewStrokesRef.current = null;
    }
    redraw();
  }, [strokes]);

  // Reset undo history when switching notes
  useEffect(() => {
    historyRef.current.reset();
    previewStrokesRef.current = null;
    currentStrokeRef.current = null;
    strokesRef.current = strokes;
    syncHistoryFlags();
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // Redraw all strokes on canvas
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const visibleStrokes = previewStrokesRef.current ?? strokesRef.current;
    for (const stroke of visibleStrokes) {
      renderStroke(ctx, stroke, dpr);
    }

    // Render current active stroke live
    if (currentStrokeRef.current) {
      renderStroke(ctx, currentStrokeRef.current, dpr);
    }
  }, []);

  // Page ruling lives on its own layer behind the ink so eraser strokes never
  // punch holes through the background pattern.
  const drawBackground = useCallback(() => {
    const canvas = backgroundCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawInkBackground(ctx, canvas.width, canvas.height, dpr, background);
  }, [background]);

  useEffect(() => {
    drawBackground();
  }, [drawBackground]);

  /**
   * Atomically commits a stroke change: records an undo snapshot, updates the
   * local authoritative list, pushes it to the note, and repaints.
   */
  const commitStrokes = useCallback((next: Stroke[]) => {
    const previous = strokesRef.current;
    if (previous === next) {
      redraw();
      return;
    }
    historyRef.current.commit(previous, next);
    strokesRef.current = next;
    previewStrokesRef.current = null;
    syncHistoryFlags();
    onChangeStrokes(next);
    redraw();
  }, [onChangeStrokes, redraw, syncHistoryFlags]);

  const handleUndo = useCallback(() => {
    if (currentStrokeRef.current || isEraserDrawingRef.current) return;
    const previous = historyRef.current.undo(strokesRef.current);
    if (!previous) return;
    strokesRef.current = previous;
    previewStrokesRef.current = null;
    syncHistoryFlags();
    onChangeStrokes(previous);
    redraw();
  }, [onChangeStrokes, redraw, syncHistoryFlags]);

  const handleRedo = useCallback(() => {
    if (currentStrokeRef.current || isEraserDrawingRef.current) return;
    const next = historyRef.current.redo(strokesRef.current);
    if (!next) return;
    strokesRef.current = next;
    previewStrokesRef.current = null;
    syncHistoryFlags();
    onChangeStrokes(next);
    redraw();
  }, [onChangeStrokes, redraw, syncHistoryFlags]);

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

    const bgCanvas = backgroundCanvasRef.current;
    if (bgCanvas) {
      bgCanvas.width = canvas.width;
      bgCanvas.height = canvas.height;
      bgCanvas.style.width = `${rect.width}px`;
      bgCanvas.style.height = `${rect.height}px`;
    }

    drawBackground();
    redraw();
  }, [drawBackground, redraw]);

  // Attach ResizeObserver to container
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
   * Activates Eraser mode while S Pen button is pressed.
   */
  const activateSpenEraser = useCallback((source: string = 'press') => {
    if (isSpenEraserArmedRef.current) return;
    isSpenEraserArmedRef.current = true;
    setIsSpenEraserArmed(true);

    playToggleAudioFeedback(true);
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(35);
      }
    } catch {}

    setStylusTelemetry((prev) => ({
      ...prev,
      lastTrigger: `${source}: ERASER ACTIVATED (${new Date().toLocaleTimeString()})`
    }));
  }, []);

  /**
   * Deactivates Eraser mode immediately when S Pen button is released.
   */
  const deactivateSpenEraser = useCallback((source: string = 'release') => {
    if (!isSpenEraserArmedRef.current) return;
    isSpenEraserArmedRef.current = false;
    setIsSpenEraserArmed(false);
    isEraserDrawingRef.current = false;

    // Guaranteed revert to writing pen (never stay trapped in eraser!)
    const targetTool = lastWritingToolRef.current || 'fountain';
    if (selectedToolRef.current === 'eraser') {
      setSelectedTool(targetTool);
      selectedToolRef.current = targetTool;
    }

    playToggleAudioFeedback(false);

    setStylusTelemetry((prev) => ({
      ...prev,
      lastTrigger: `${source}: REVERTED TO PEN (${new Date().toLocaleTimeString()})`
    }));
  }, []);

  // Global window listeners for capturing S Pen hardware button interrupts across all browser layers
  useEffect(() => {
    const handleGlobalPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        lastStylusActiveTimeRef.current = Date.now();

        const isHovering = e.pressure <= 0.05;
        const isButtonPressed = isSpenButtonPressed(e.buttons, e.button, e.pressure);

        setStylusTelemetry((prev) => ({
          ...prev,
          status: isHovering ? 'hovering' : 'drawing',
          buttons: e.buttons,
          button: e.button,
          pressure: e.pressure
        }));

        // While hovering: Active while button pressed, DEACTIVATE IMMEDIATELY UPON RELEASE!
        if (isHovering) {
          if (isButtonPressed && !isSpenEraserArmedRef.current) {
            activateSpenEraser(`hover-press (buttons=${e.buttons})`);
          } else if (!isButtonPressed && isSpenEraserArmedRef.current && !isEraserDrawingRef.current) {
            deactivateSpenEraser('hover-release');
          }
        }
      }
    };

    // Global pointerup (captures hover button release even if cursor didn't move)
    const handleGlobalPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        if (isInkUiTarget(e.target)) return;
        const isButtonPressed = isSpenButtonPressed(e.buttons, e.button, e.pressure);
        if (!isButtonPressed && isSpenEraserArmedRef.current && !isEraserDrawingRef.current) {
          deactivateSpenEraser('global-pointerup-release');
        }
      }
    };

    const handleGlobalPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        if (isInkUiTarget(e.target)) return;
        const isHovering = e.pressure <= 0.05;
        const isButtonPressed = isSpenButtonPressed(e.buttons, e.button, e.pressure);
        if (isHovering && isButtonPressed && !isSpenEraserArmedRef.current) {
          activateSpenEraser(`global-pointerdown-press (buttons=${e.buttons})`);
        }
      }
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (isInkUiTarget(e.target)) return;
      const isRecentPen = Date.now() - lastStylusActiveTimeRef.current < 2000;
      if (isRecentPen && e.buttons === 0 && isSpenEraserArmedRef.current && !isEraserDrawingRef.current) {
        deactivateSpenEraser('global-mouseup-release');
      }
    };

    // Samsung One UI Context Menu (Fired by Samsung Internet when S Pen button is clicked in the air)
    const handleGlobalContextMenu = (e: MouseEvent) => {
      const isPenEvent = (e as any).pointerType === 'pen';
      const isRecentPen = Date.now() - lastStylusActiveTimeRef.current < 2000;

      if (isInkUiTarget(e.target)) {
        if (isPenEvent || isRecentPen || isSpenBarrelOrEraser(e.buttons, e.button)) {
          e.preventDefault();
          e.stopPropagation();
          clickInkUiControl(e.target);
        }
        return;
      }

      if (isPenEvent || isRecentPen) {
        e.preventDefault();
        e.stopPropagation();
        if (e.buttons > 0) {
          activateSpenEraser('contextmenu-hold');
        } else if (isSpenEraserArmedRef.current && !isEraserDrawingRef.current) {
          deactivateSpenEraser('contextmenu-release');
        }
      }
    };

    // Aux Click (Middle/Aux button click on Android Chromium)
    const handleGlobalAuxClick = (e: MouseEvent) => {
      const isPenEvent = (e as any).pointerType === 'pen';
      const isRecentPen = Date.now() - lastStylusActiveTimeRef.current < 2000;

      if (isInkUiTarget(e.target)) {
        if (isPenEvent || isRecentPen || isSpenBarrelOrEraser(e.buttons, e.button)) {
          e.preventDefault();
          e.stopPropagation();
          clickInkUiControl(e.target);
        }
        return;
      }

      if (isPenEvent || isRecentPen || isSpenBarrelOrEraser(e.buttons, e.button)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.buttons > 0) {
          activateSpenEraser('auxclick-hold');
        } else if (isSpenEraserArmedRef.current && !isEraserDrawingRef.current) {
          deactivateSpenEraser('auxclick-release');
        }
      }
    };

    // Android 14+ Stylus Hardware Button Key Events (Keycode 308 / 309)
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (isSpenHardwareKeyEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
        activateSpenEraser(`key-down-${e.keyCode || e.code}`);
      }
    };

    const handleGlobalKeyUp = (e: KeyboardEvent) => {
      if (isSpenHardwareKeyEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
        deactivateSpenEraser(`key-up-${e.keyCode || e.code}`);
      }
    };

    window.addEventListener('pointermove', handleGlobalPointerMove, { capture: true, passive: true });
    window.addEventListener('pointerdown', handleGlobalPointerDown, { capture: true });
    window.addEventListener('pointerup', handleGlobalPointerUp, { capture: true });
    window.addEventListener('pointercancel', handleGlobalPointerUp, { capture: true });
    window.addEventListener('mouseup', handleGlobalMouseUp, { capture: true });
    window.addEventListener('contextmenu', handleGlobalContextMenu, { capture: true });
    window.addEventListener('auxclick', handleGlobalAuxClick, { capture: true });
    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });
    window.addEventListener('keyup', handleGlobalKeyUp, { capture: true });

    if ('onpointerrawupdate' in window) {
      window.addEventListener('pointerrawupdate' as any, handleGlobalPointerMove as any, { capture: true, passive: true });
    }

    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove, { capture: true });
      window.removeEventListener('pointerdown', handleGlobalPointerDown, { capture: true });
      window.removeEventListener('pointerup', handleGlobalPointerUp, { capture: true });
      window.removeEventListener('pointercancel', handleGlobalPointerUp, { capture: true });
      window.removeEventListener('mouseup', handleGlobalMouseUp, { capture: true });
      window.removeEventListener('contextmenu', handleGlobalContextMenu, { capture: true });
      window.removeEventListener('auxclick', handleGlobalAuxClick, { capture: true });
      window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
      window.removeEventListener('keyup', handleGlobalKeyUp, { capture: true });
      if ('onpointerrawupdate' in window) {
        window.removeEventListener('pointerrawupdate' as any, handleGlobalPointerMove as any, { capture: true });
      }
    };
  }, [activateSpenEraser, clickInkUiControl, deactivateSpenEraser]);

  /**
   * Applies the currently selected eraser mode at a canvas point.
   * Object mode removes whole strokes; pixel mode only removes the covered part.
   */
  const eraseAtPoint = (strokeList: Stroke[], x: number, y: number) => {
    return eraserMode === 'pixel'
      ? eraseStrokesPartial(strokeList, x, y, eraserWidth)
      : eraseStrokesNearPoint(strokeList, x, y, eraserWidth);
  };

  // Pointer Down (stylus touches screen)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 1. Stylus-Only Mode: Completely ignore any non-pen touch
    if (isStylusOnly && e.pointerType !== 'pen') {
      return;
    }

    // 2. Palm Rejection via Contact Geometry:
    if (e.pointerType === 'touch' && (e.width > 22 || e.height > 22)) {
      return; // Reject broad palm contact
    }

    // 3. Stylus priority palm rejection
    if (e.pointerType === 'pen') {
      isStylusActiveRef.current = true;
    } else if (isStylusActiveRef.current && e.pointerType === 'touch') {
      return;
    }

    // Check if S Pen button is pressed upon touch-down
    if (e.pointerType === 'pen' && isSpenButtonPressed(e.buttons, e.button, e.pressure)) {
      if (!isSpenEraserArmedRef.current) {
        activateSpenEraser('touch-down-button');
      }
    }

    e.currentTarget.setPointerCapture(e.pointerId);

    const isEraserNow = isSpenEraserArmedRef.current || selectedToolRef.current === 'eraser';
    const startPoint = getCanvasPoint(e);

    if (isEraserNow) {
      isEraserDrawingRef.current = true;
      previewStrokesRef.current = strokesRef.current;
      // Instant erase preview: object mode deletes strokes, pixel mode clips them
      const { remaining, hasErased } = eraseAtPoint(strokesRef.current, startPoint.x, startPoint.y);
      if (hasErased) {
        previewStrokesRef.current = remaining;
      }
    } else {
      isEraserDrawingRef.current = false;
      const newStroke: Stroke = {
        id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        points: [startPoint],
        color: penColor,
        width: penWidth,
        tool: selectedToolRef.current,
        opacity: selectedToolRef.current === 'highlighter' ? 0.4 : 1.0
      };
      currentStrokeRef.current = newStroke;
    }

    redraw();
  };

  // Pointer Move (coalesced 120Hz events loop)
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isStylusOnly && e.pointerType !== 'pen') return;
    if (isStylusActiveRef.current && e.pointerType === 'touch') return;

    const isEraserNow = isSpenEraserArmedRef.current || selectedToolRef.current === 'eraser';
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    const nativeEvent = e.nativeEvent as PointerEvent;
    const rawEvents = nativeEvent.getCoalescedEvents?.() ?? [];
    const coalescedEvents = rawEvents.length > 0 ? rawEvents : [nativeEvent];

    // ERASER MODE: preview erasing locally; committed as one undoable step on lift
    if (isEraserNow && isEraserDrawingRef.current) {
      let currentStrokes = previewStrokesRef.current ?? strokesRef.current;
      let anyErased = false;

      for (const ce of coalescedEvents) {
        const ptX = ce.clientX - rect.left;
        const ptY = ce.clientY - rect.top;
        const res = eraseAtPoint(currentStrokes, ptX, ptY);
        if (res.hasErased) {
          currentStrokes = res.remaining;
          anyErased = true;
        }
      }

      if (anyErased) {
        previewStrokesRef.current = currentStrokes;
        redraw();
      }
      return;
    }

    // DRAWING INK MODE: Record coalesced points
    if (!currentStrokeRef.current) return;

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

  // Pointer Up (stylus leaves screen - auto returns to pen if S Pen button is released!)
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }

    // Capture the drag state BEFORE deactivating the S Pen eraser: deactivation
    // clears isEraserDrawingRef, and if that happened first the eraser drag was
    // never committed. The un-erased strokes then came back on the next stroke.
    const wasErasing = isEraserDrawingRef.current;
    isEraserDrawingRef.current = false;

    if (e.pointerType === 'pen') {
      isStylusActiveRef.current = false;
    }

    // When lifting the pen from screen:
    // If S Pen button is no longer pressed in the air, DEACTIVATE ERASER IMMEDIATELY!
    if (isSpenEraserArmedRef.current) {
      const isStillPressedInAir = isSpenButtonPressed(e.buttons, e.button, 0);
      if (!isStillPressedInAir) {
        deactivateSpenEraser('lift-release');
      }
    }

    // Commit the eraser drag as a single undoable step
    if (wasErasing) {
      const preview = previewStrokesRef.current;
      if (preview && preview !== strokesRef.current) {
        commitStrokes(preview);
      } else {
        previewStrokesRef.current = null;
        redraw();
      }
      return;
    }

    if (!currentStrokeRef.current) return;

    // Discard single-point dots produced by palm brushes
    if (currentStrokeRef.current.points.length > 1) {
      commitStrokes([...strokesRef.current, currentStrokeRef.current]);
    }

    currentStrokeRef.current = null;
    redraw();
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    handlePointerUp(e);
  };

  // Prevent default context menu from consuming S Pen button gestures on canvas
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    activateSpenEraser('canvas-contextmenu');
  };

  const handleAuxClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    activateSpenEraser('canvas-auxclick');
  };

  // History controls
  const handleClear = () => {
    if (strokesRef.current.length === 0) return;
    if (window.confirm('Clear all handwriting strokes from this note?')) {
      currentStrokeRef.current = null;
      previewStrokesRef.current = null;
      commitStrokes([]);
    }
  };

  const handleManualToolSelect = (tool: PenTool) => {
    setSelectedTool(tool);
    setIsSpenEraserArmed(false);
    isSpenEraserArmedRef.current = false;
  };

  return (
    <div className="flex flex-col w-full h-full relative select-none">
      {/* Top Floating Pen Toolbar */}
      <div className="px-4 py-2 flex justify-center items-center z-10 pointer-events-auto" data-ink-ui="toolbar-shell">
        <PenToolbar
          activeTool={activeTool}
          onSelectTool={handleManualToolSelect}
          color={penColor}
          onChangeColor={setPenColor}
          width={penWidth}
          onChangeWidth={setPenWidth}
          eraserWidth={eraserWidth}
          onChangeEraserWidth={setEraserWidth}
          eraserMode={eraserMode}
          onChangeEraserMode={setEraserMode}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onClear={handleClear}
          onScribbleToText={onScribbleToText}
          hasStrokes={strokes.length > 0}
          isStylusOnly={isStylusOnly}
          onToggleStylusOnly={() => setIsStylusOnly(!isStylusOnly)}
          onOpenSPenMenu={() => setIsQuickMenuOpen(true)}
          lastWritingTool={lastWritingToolRef.current}
          background={background}
          onChangeBackground={onChangeBackground}
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
          ref={backgroundCanvasRef}
          aria-hidden="true"
          className="absolute inset-0 block w-full h-full pointer-events-none"
        />
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

        {strokes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-ink-muted-light/60 dark:text-ink-muted-dark/60 text-sm">
            <p className="font-medium">Write with S Pen or Apple Pencil</p>
            <p className="text-xs mt-1">
              Press S Pen button to Erase • Release to return to Pen • Choose size & mode in toolbar
            </p>
          </div>
        )}

        {/* Bottom Left: S Pen Live Telemetry / Diagnostic Badge */}
        <div className="absolute bottom-4 left-4 z-10 flex flex-col items-start gap-1" data-ink-ui="stylus-status">
          <button
            type="button"
            onClick={() => setDiagnosticHUD(!diagnosticHUD)}
            title="Click to toggle S Pen Live Diagnostic HUD"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-surface-light/80 dark:bg-surface-dark/80 backdrop-blur-md border border-surface-subtle-light dark:border-surface-subtle-dark text-[11px] font-medium text-ink-muted-light dark:text-ink-muted-dark shadow-subtle hover:text-ink-light dark:hover:text-ink-dark transition"
          >
            <span className={`w-2 h-2 rounded-full ${isSpenEraserArmed ? 'bg-rose-500 animate-pulse' : stylusTelemetry.status === 'hovering' ? 'bg-emerald-500' : stylusTelemetry.status === 'drawing' ? 'bg-violet-500' : 'bg-slate-400'}`} />
            <span>
              S Pen: {isSpenEraserArmed ? `Eraser (${eraserMode === 'pixel' ? 'Pixel' : 'Object'}, ${eraserWidth}px)` : stylusTelemetry.status === 'hovering' ? `Hovering (${penWidth}px Pen)` : stylusTelemetry.status === 'drawing' ? 'Inking' : 'Ready'}
            </span>
            <Activity className="w-3 h-3 ml-0.5 opacity-60" />
          </button>

          {diagnosticHUD && (
            <div className="p-2.5 rounded-xl bg-surface-light/95 dark:bg-surface-dark/95 backdrop-blur-md border border-surface-subtle-light dark:border-surface-subtle-dark shadow-floating text-[10px] font-mono text-ink-light dark:text-ink-dark space-y-1 animate-in fade-in">
              <div>Eraser Active: <span className={isSpenEraserArmed ? "font-bold text-rose-500" : "text-emerald-500"}>{isSpenEraserArmed ? `YES (${eraserMode === 'pixel' ? 'Pixel' : 'Object'}, ${eraserWidth}px)` : `NO (${penWidth}px Pen)`}</span></div>
              <div>Buttons: <span className="font-semibold text-violet-500">{stylusTelemetry.buttons}</span> (button: {stylusTelemetry.button})</div>
              <div>Pressure: <span className="font-semibold">{stylusTelemetry.pressure.toFixed(2)}</span></div>
              <div>Last Event: <span className="text-emerald-500">{stylusTelemetry.lastTrigger}</span></div>
            </div>
          )}
        </div>

        {/* Bottom Right: Quick S Pen Floating Trigger Badge */}
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2" data-ink-ui="floating-tools">
          {/* 1-Tap Quick Tool Flip Pill */}
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'eraser') {
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
        width={activeTool === 'eraser' ? eraserWidth : penWidth}
        onChangeWidth={(newWidth) => {
          if (activeTool === 'eraser') {
            setEraserWidth(newWidth);
          } else {
            setPenWidth(newWidth);
          }
        }}
        eraserMode={eraserMode}
        onChangeEraserMode={setEraserMode}
      />
    </div>
  );
});

InkCanvas.displayName = 'InkCanvas';
