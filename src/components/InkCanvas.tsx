import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
import { flushSync } from 'react-dom';
import { Stroke, StrokePoint, PenTool, InkBackground, EraserMode, SelectMode, TextBlockLayout, PageLayout } from '../types/note';
import { renderStroke, eraseStrokesNearPoint, eraseStrokesPartial } from '../utils/inkSmoothing';
import { InkHistory } from '../utils/inkHistory';
import { drawInkBackground } from '../utils/inkBackground';
import {
  applyInkTransform,
  Bounds,
  composeTextBlockLayout,
  getStrokesBounds,
  hitTestStroke,
  IDENTITY_INK_TRANSFORM,
  IDENTITY_TEXT_BLOCK_LAYOUT,
  InkTransform,
  isIdentityTextBlockLayout,
  isIdentityTransform,
  MarqueeGeometry,
  marqueeSelectsTextBlock,
  Point,
  pointInBounds,
  reorderSelection,
  selectStrokeIds,
  transformTextBlockBounds,
  unionBounds
} from '../utils/inkSelection';
import { SelectionOverlay, ResizeCorner } from './SelectionOverlay';
import { isSpenHardwareKeyEvent } from '../utils/spenDetection';
import { createSpenGesture } from '../utils/spenGesture';
import { PenToolbar } from './PenToolbar';
import { NoteRibbon } from './NoteRibbon';
import type { TextEditorRef } from './TextEditor';
import { SPenQuickMenu } from './SPenQuickMenu';
import {
  clampPageZoom,
  getFitWidthZoom,
  getPageSize,
  PAGE_ZOOM_STEP
} from '../utils/pageLayout';
import {
  Eraser,
  Sparkles,
  Feather,
  Activity,
  ClipboardCopy,
  Download,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2
} from 'lucide-react';

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
  /** A finger tap that never travelled: the note sheet should take the caret. */
  onFingerTap?: () => void;
  /** Asks the page to focus the text caret (Text tool, finger tap). */
  onRequestTextFocus?: () => void;
  /** Reports the active tool so the host can reflect it in the text sheet. */
  onToolChange?: (tool: PenTool) => void;
  /** The note's typed text, drawn between the back and front ink layers. */
  textLayer?: React.ReactNode;
  textEditor?: React.RefObject<TextEditorRef | null>;
  background?: InkBackground;
  onChangeBackground?: (background: InkBackground) => void;
  /** A4 orientation of the note sheet. */
  pageLayout?: PageLayout;
  onChangePageLayout?: (layout: PageLayout) => void;
  /** Saved page placement of the typed text block. */
  textLayout?: TextBlockLayout;
  /** Reports a move / resize / rotate of the typed text block. */
  onChangeTextLayout?: (layout: TextBlockLayout) => void;
  /** Clears the typed text and its placement when the block is deleted. */
  onDeleteText?: () => void;
  defaultTool?: PenTool;
  defaultColor?: string;
  defaultWidth?: number;
  defaultEraserWidth?: number;
  defaultEraserMode?: EraserMode;
  defaultStylusOnly?: boolean;
  /** Hold time (Settings) before the S Pen button arms the eraser. */
  spenHoldEraseMs?: number;
  /** Whether a double-press of the S Pen button opens the quick palette (Settings). */
  spenDoublePressOpensMenu?: boolean;
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

const SPEN_HOLD_ERASE_MS = 250;

/**
 * A finger touchdown starts an ink stroke right away, but a tap that never
 * travels is a text gesture, not a drawing one: on lift it hands the caret to
 * the note sheet instead. A swipe past this slop keeps the stroke.
 */
const FINGER_TAP_SLOP_PX = 8;
const FINGER_TAP_MAX_MS = 600;

/** One in-flight move / resize / rotate of the current selection. */
type TransformDrag = {
  kind: 'move' | 'resize' | 'rotate';
  corner: ResizeCorner | null;
  start: Point;
  bounds: Bounds;
  baseStrokes: Stroke[];
};

/** One captured S Pen sample for on-device diagnostics. */
type SpenLogEntry = {
  t: number;
  kind: string;
  pointerType?: string;
  buttons?: number;
  button?: number;
  pressure?: number;
  contact?: boolean;
  tool: 'pen' | 'eraser';
  note?: string;
};

/** Value payload for a new log sample (timestamp, tool and kind are added). */
type SpenLogSample = Omit<SpenLogEntry, 't' | 'kind' | 'tool'>;

const SPEN_LOG_LIMIT = 300;
const SPEN_LOG_RENDER_LIMIT = 60;

/**
 * True while interacting with ink UI (toolbar, eraser popover, S Pen menu).
 * S Pen button handling must not arm/disarm the eraser or swallow taps there.
 */
function isInkUiTarget(target: EventTarget | null): boolean {
  return (
    typeof Element !== 'undefined' &&
    target instanceof Element &&
    !!target.closest('[data-ink-ui]:not([data-ink-ui=page-viewport])')
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
  onFingerTap,
  onRequestTextFocus,
  onToolChange,
  textLayer,
  textEditor,
  background = 'none',
  onChangeBackground,
  pageLayout = 'portrait',
  onChangePageLayout,
  textLayout,
  onChangeTextLayout,
  onDeleteText,
  defaultTool = 'fountain',
  defaultColor,
  defaultWidth = 4,
  defaultEraserWidth = 24,
  defaultEraserMode = 'object',
  defaultStylusOnly = false,
  spenHoldEraseMs = SPEN_HOLD_ERASE_MS,
  spenDoublePressOpensMenu = true
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  // Ink assigned to the note's back layer is painted on this canvas, behind the text.
  const backCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- Page sheet: A4 size, orientation and zoom -------------------------
  const pageSize = useMemo(() => getPageSize(pageLayout), [pageLayout]);
  /** Measured height of the sheet in page pixels (A4 minimum, grows with text). */
  const [pageHeight, setPageHeight] = useState<number>(pageSize.height);
  const [zoom, setZoom] = useState<number>(1);
  const zoomRef = useRef<number>(1);
  /** Device-pixel scale of the bitmap currently backing the canvases. */
  const renderScaleRef = useRef<number>(
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  );
  /** Focal point captured before a zoom change, applied after React paints. */
  const zoomAnchorRef = useRef<{
    clientX: number;
    clientY: number;
    pageX: number;
    pageY: number;
  } | null>(null);
  /** Open two-finger gesture and its starting geometry. */
  const isPinchingRef = useRef<boolean>(false);
  /** Number of fingers currently touching the page viewport. */
  const touchCountRef = useRef<number>(0);

  // Detect dark mode for initial ink color
  const isDarkMode = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  // Primary user-selected tool (text, select, a pen, or the eraser).
  // A keyboard/mouse desktop opens on the text sheet; a pen device opens with
  // ink already live so the stylus works the moment it touches the page.
  const [selectedTool, setSelectedTool] = useState<PenTool>(() =>
    typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 ? defaultTool : 'text'
  );
  const [penColor, setPenColor] = useState<string>(defaultColor || (isDarkMode ? '#ffffff' : '#1e293b'));
  const [penWidth, setPenWidth] = useState<number>(defaultWidth);
  const [eraserWidth, setEraserWidth] = useState<number>(defaultEraserWidth);
  const [eraserMode, setEraserMode] = useState<EraserMode>(defaultEraserMode);
  const [isStylusOnly, setIsStylusOnly] = useState<boolean>(defaultStylusOnly);

  // ---- Select tool: marquee, selection frame, live transform ---------------
  const [selectMode, setSelectMode] = useState<SelectMode>('rect');
  const selectModeRef = useRef<SelectMode>('rect');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdsRef = useRef<string[]>([]);
  /** True when the note's typed text block is part of the selection. */
  const [isTextSelected, setIsTextSelected] = useState<boolean>(false);
  const isTextSelectedRef = useRef<boolean>(false);
  const [marquee, setMarquee] = useState<MarqueeGeometry | null>(null);
  const marqueeRef = useRef<MarqueeGeometry | null>(null);
  const [liveTransform, setLiveTransform] = useState<InkTransform | null>(null);
  const liveTransformRef = useRef<InkTransform | null>(null);
  const transformDragRef = useRef<TransformDrag | null>(null);
  const transformCleanupRef = useRef<(() => void) | null>(null);
  const selectionBoundsRef = useRef<Bounds | null>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [textBlockLayout, setTextBlockLayout] = useState<TextBlockLayout>(
    textLayout ?? IDENTITY_TEXT_BLOCK_LAYOUT
  );
  const textBlockLayoutRef = useRef<TextBlockLayout>(textBlockLayout);
  textBlockLayoutRef.current = textBlockLayout;
  /** Local (untransformed) box of the rendered text, measured from the DOM. */
  const textBlockBoxRef = useRef<Bounds | null>(null);
  const [textBlockBoxVersion, setTextBlockBoxVersion] = useState<number>(0);
  /** Pointer type of the current Select drag, for touch-sized hit tests. */
  const selectPointerTypeRef = useRef<string>('mouse');

  /**
   * Measures the typed text where it sits in the page before the block's
   * move / resize / rotate is applied. The transform is switched off for the
   * synchronous measurement and restored immediately, so no frame is painted
   * in between. Text is only selectable when the block actually holds text.
   */
  const measureTextBlock = useCallback((): { box: Bounds; hasText: boolean } | null => {
    const wrapper = textLayerRef.current;
    if (!wrapper) return null;

    const editor =
      wrapper.querySelector<HTMLElement>('[data-note-editor="true"]') ?? wrapper;
    const hasText = (editor.textContent ?? '').replace(/\u200b/g, '').trim().length > 0;
    if (!hasText) return null;

    const previousTransform = wrapper.style.transform;
    wrapper.style.transform = 'none';
    const wrapperRect = wrapper.getBoundingClientRect();

    let rect: { left: number; top: number; right: number; bottom: number } | null = null;
    try {
      const range = document.createRange();
      range.selectNodeContents(editor);
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i += 1) {
        const line = rects[i];
        if (line.width <= 0 && line.height <= 0) continue;
        rect = rect
          ? {
              left: Math.min(rect.left, line.left),
              top: Math.min(rect.top, line.top),
              right: Math.max(rect.right, line.right),
              bottom: Math.max(rect.bottom, line.bottom)
            }
          : {
              left: line.left,
              top: line.top,
              right: line.right,
              bottom: line.bottom
            };
      }
    } catch {
      rect = null;
    }

    if (!rect) {
      const fallback = editor.getBoundingClientRect();
      rect = {
        left: fallback.left,
        top: fallback.top,
        right: fallback.right,
        bottom: fallback.bottom
      };
    }

    wrapper.style.transform = previousTransform;

    // Client rects include the page's CSS zoom (a transformed ancestor). The
    // block layout is stored in page pixels, so undo the zoom here.
    const scale = zoomRef.current || 1;

    return {
      hasText: true,
      box: {
        x: (rect.left - wrapperRect.left) / scale,
        y: (rect.top - wrapperRect.top) / scale,
        width: Math.max(1, rect.right - rect.left) / scale,
        height: Math.max(1, rect.bottom - rect.top) / scale
      }
    };
  }, []);

  const setSelection = useCallback((ids: string[], includeText = false) => {
    let text = includeText;
    if (text) {
      const measured = measureTextBlock();
      textBlockBoxRef.current = measured?.box ?? null;
      text = !!measured;
    } else {
      textBlockBoxRef.current = null;
    }

    selectedIdsRef.current = ids;
    isTextSelectedRef.current = text;
    setSelectedIds(ids);
    setIsTextSelected(text);
    setTextBlockBoxVersion((version) => version + 1);
  }, [measureTextBlock]);

  // The note's saved placement is authoritative (note switch, sync, undo of a
  // text transform all arrive through this prop).
  useEffect(() => {
    setTextBlockLayout(textLayout ?? IDENTITY_TEXT_BLOCK_LAYOUT);
  }, [textLayout, noteId]);

  // Momentary S Pen Eraser State: active while pressing button, DEACTIVATES ON RELEASE
  const [isSpenEraserArmed, setIsSpenEraserArmed] = useState<boolean>(false);
  const isSpenEraserArmedRef = useRef<boolean>(false);
  const selectedToolRef = useRef<PenTool>(selectedTool);
  const lastWritingToolRef = useRef<PenTool>(defaultTool === 'eraser' ? 'fountain' : defaultTool);
  const isEraserDrawingRef = useRef<boolean>(false);
  // A drag that has produced real pressure proves this device reports pressure,
  // so a run of zero-pressure samples afterwards means the tip is in the air
  // even if the browser never delivered pointerup (it can drop stylus events
  // while the side button is held). Pressure-less pens never set this.
  const dragSawPressureRef = useRef<boolean>(false);
  const zeroPressureSamplesRef = useRef<number>(0);
  const lastPenClientPosRef = useRef<{ x: number; y: number } | null>(null);
  const spenTipDownRef = useRef(false);
  const lastInkUiClickRef = useRef<{ control: HTMLElement; time: number } | null>(null);

  // Effective tool: If S Pen eraser is armed, tool is 'eraser', else selectedTool
  const activeTool: PenTool = isSpenEraserArmed ? 'eraser' : selectedTool;

  useEffect(() => {
    selectedToolRef.current = selectedTool;
    if (selectedTool !== 'eraser' && selectedTool !== 'text' && selectedTool !== 'select') {
      lastWritingToolRef.current = selectedTool;
    }
  }, [selectedTool]);

  useEffect(() => {
    selectModeRef.current = selectMode;
  }, [selectMode]);

  // Leaving the Select tool drops the frame; the objects stay where they are.
  useEffect(() => {
    if (activeTool !== 'select') {
      if (selectedIdsRef.current.length > 0 || isTextSelectedRef.current) setSelection([]);
      marqueeRef.current = null;
      setMarquee(null);
    }
  }, [activeTool, setSelection]);

  useLayoutEffect(() => {
    onToolChange?.(activeTool);
  }, [activeTool, onToolChange]);

  useEffect(() => () => transformCleanupRef.current?.(), []);

  // Undo, erasing or sync can remove selected strokes: drop them from the frame.
  useEffect(() => {
    const ids = selectedIdsRef.current;
    if (ids.length === 0) return;
    const alive = new Set(strokes.map((stroke) => stroke.id));
    const next = ids.filter((id) => alive.has(id));
    if (next.length !== ids.length) setSelection(next, isTextSelectedRef.current);
  }, [strokes, setSelection]);

  // Keep the text block's frame matched while the sheet reflows (typing, note
  // load, a sync merge) so the handles stay on the text.
  useEffect(() => {
    if (!isTextSelected) return;
    const wrapper = textLayerRef.current;
    if (!wrapper || typeof ResizeObserver === 'undefined') return;

    const remeasure = () => {
      const measured = measureTextBlock();
      textBlockBoxRef.current = measured?.box ?? null;
      setTextBlockBoxVersion((version) => version + 1);
    };
    const observer = new ResizeObserver(remeasure);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [isTextSelected, measureTextBlock]);

  // Keep the canvas in sync when stylus defaults change in Settings. These only
  // fire on actual prop changes, so in-canvas tool picks are never clobbered.
  // The first run is skipped so the opening tool above survives mount.
  const defaultToolAppliedRef = useRef(false);
  useEffect(() => {
    if (!defaultToolAppliedRef.current) {
      defaultToolAppliedRef.current = true;
      return;
    }
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

  // S Pen gesture tuning comes from Settings. Mirrored into refs so the
  // window-level pointer handlers always read the current value.
  const spenHoldEraseMsRef = useRef<number>(spenHoldEraseMs);
  const spenDoublePressOpensMenuRef = useRef<boolean>(spenDoublePressOpensMenu);

  useEffect(() => {
    spenHoldEraseMsRef.current = Math.max(0, Math.min(2000, spenHoldEraseMs));
  }, [spenHoldEraseMs]);

  useEffect(() => {
    spenDoublePressOpensMenuRef.current = spenDoublePressOpensMenu;
  }, [spenDoublePressOpensMenu]);

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

  // On-device S Pen diagnostic log: a ring buffer of raw button/pressure
  // samples so hardware quirks can be captured and shared off the tablet.
  const [isSpenLogOpen, setIsSpenLogOpen] = useState<boolean>(false);
  const isSpenLogOpenRef = useRef<boolean>(false);
  const spenLogRef = useRef<SpenLogEntry[]>([]);
  const [spenLogVersion, setSpenLogVersion] = useState<number>(0);
  const [spenLogCopied, setSpenLogCopied] = useState<boolean>(false);
  const lastSpenLogRenderRef = useRef<number>(0);
  const lastLoggedMoveRef = useRef<{ time: number; buttons: number; contact: boolean }>({
    time: 0,
    buttons: -1,
    contact: false
  });

  const logSpenSample = useCallback((kind: string, sample: SpenLogSample = {}) => {
    const log = spenLogRef.current;
    log.push({
      t: Date.now(),
      kind,
      tool: isSpenEraserArmedRef.current ? 'eraser' : 'pen',
      ...sample
    });
    if (log.length > SPEN_LOG_LIMIT) {
      log.splice(0, log.length - SPEN_LOG_LIMIT);
    }

    // Only repaint the panel while it is visible, and at most ~8 times a second,
    // so 120Hz stylus sampling never re-renders the ink canvas.
    if (isSpenLogOpenRef.current) {
      const now = Date.now();
      if (now - lastSpenLogRenderRef.current >= 120) {
        lastSpenLogRenderRef.current = now;
        setSpenLogVersion((v) => v + 1);
      }
    }
  }, []);

  const formatSpenLog = useCallback(() => {
    const header = [
      'Aura Notes — S Pen diagnostic log',
      `captured: ${new Date().toISOString()}`,
      `samples: ${spenLogRef.current.length} (newest last)`,
      `devicePixelRatio: ${window.devicePixelRatio}`,
      `userAgent: ${navigator.userAgent}`,
      '',
      'time                     kind         tool   type  buttons button pressure contact note'
    ].join('\n');

    const rows = spenLogRef.current.map((e) => {
      const time = new Date(e.t).toISOString();
      return [
        time,
        e.kind.padEnd(12),
        e.tool.padEnd(6),
        (e.pointerType ?? '-').padEnd(5),
        String(e.buttons ?? '-').padEnd(7),
        String(e.button ?? '-').padEnd(6),
        (e.pressure !== undefined ? e.pressure.toFixed(3) : '-').padEnd(8),
        (e.contact ? '1' : '0').padEnd(7),
        e.note ?? ''
      ].join(' ');
    });

    return [header, ...rows].join('\n');
  }, []);

  const clearSpenLog = useCallback(() => {
    spenLogRef.current = [];
    setSpenLogVersion((v) => v + 1);
  }, []);

  const copySpenLog = useCallback(async () => {
    const text = formatSpenLog();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
      } catch {}
      area.remove();
    }
    setSpenLogCopied(true);
    window.setTimeout(() => setSpenLogCopied(false), 1500);
  }, [formatSpenLog]);

  const downloadSpenLog = useCallback(() => {
    const blob = new Blob([formatSpenLog()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aura-spen-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [formatSpenLog]);

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

  /** Open finger contact, so a tap can be told apart from a swipe on lift. */
  const fingerTapRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    time: number;
    moved: boolean;
    drawsInk: boolean;
  } | null>(null);

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

  // Redraw all strokes across the two ink layers (back = behind the text).
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const backCanvas = backCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const backCtx = backCanvas ? backCanvas.getContext('2d') : null;

    const scale = renderScaleRef.current || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (backCanvas && backCtx) {
      backCtx.clearRect(0, 0, backCanvas.width, backCanvas.height);
    }

    const visibleStrokes = previewStrokesRef.current ?? strokesRef.current;
    for (const stroke of visibleStrokes) {
      if ((stroke.layer ?? 'front') === 'back' && backCtx) {
        renderStroke(backCtx, stroke, scale);
      } else {
        renderStroke(ctx, stroke, scale);
      }
    }

    // Render current active stroke live
    if (currentStrokeRef.current) {
      renderStroke(ctx, currentStrokeRef.current, scale);
    }
  }, []);

  // Page ruling lives on its own layer behind the ink so eraser strokes never
  // punch holes through the background pattern.
  const drawBackground = useCallback(() => {
    const canvas = backgroundCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = renderScaleRef.current || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawInkBackground(ctx, canvas.width, canvas.height, scale, background);
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

  /**
   * Commits the eraser drag's live preview as one undoable step and ends the
   * drag. Used when the S Pen button is released before the tip lifts.
   */
  const finishEraserDragPreview = useCallback(() => {
    isEraserDrawingRef.current = false;
    const preview = previewStrokesRef.current;
    if (preview && preview !== strokesRef.current) {
      commitStrokes(preview);
    } else {
      previewStrokesRef.current = null;
      redraw();
    }
  }, [commitStrokes, redraw]);

  /**
   * Commits whichever drag is open — an eraser preview or an ink stroke — as a
   * single undoable step and clears the drag state. No-op when nothing is open.
   */
  const commitActiveDrag = useCallback(() => {
    dragSawPressureRef.current = false;
    zeroPressureSamplesRef.current = 0;

    if (isEraserDrawingRef.current) {
      finishEraserDragPreview();
      return;
    }

    const stroke = currentStrokeRef.current;
    if (!stroke) return;
    currentStrokeRef.current = null;
    // Discard single-point dots produced by palm brushes
    if (stroke.points.length > 1) {
      commitStrokes([...strokesRef.current, stroke]);
    } else {
      redraw();
    }
  }, [commitStrokes, finishEraserDragPreview, redraw]);

  /**
   * Drops whatever drag is open without committing it. A second finger landing
   * on the page means the user is pinching, not inking, so the few points the
   * first finger painted are discarded rather than saved as a stray stroke.
   */
  const abortActiveCanvasDrag = useCallback(() => {
    fingerTapRef.current = null;
    currentStrokeRef.current = null;
    isEraserDrawingRef.current = false;
    previewStrokesRef.current = null;
    if (transformDragRef.current) transformCleanupRef.current?.();
    if (marqueeRef.current) {
      marqueeRef.current = null;
      setMarquee(null);
    }
    redraw();
  }, [redraw]);

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

    // Offset sizes are the page's layout pixels, untouched by the CSS zoom
    // transform, so ink coordinates stay stable at every zoom level.
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    if (width === 0 || height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    // Render the sheet a little sharper than the screen while zoomed in, but
    // cap the bitmap so four canvases cannot exhaust tablet memory.
    const scale = Math.max(1, Math.min(3, dpr * zoomRef.current));
    renderScaleRef.current = scale;

    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const bgCanvas = backgroundCanvasRef.current;
    if (bgCanvas) {
      bgCanvas.width = canvas.width;
      bgCanvas.height = canvas.height;
      bgCanvas.style.width = `${width}px`;
      bgCanvas.style.height = `${height}px`;
    }

    const backCanvas = backCanvasRef.current;
    if (backCanvas) {
      backCanvas.width = canvas.width;
      backCanvas.height = canvas.height;
      backCanvas.style.width = `${width}px`;
      backCanvas.style.height = `${height}px`;
    }

    // The sheet grows with its text; the viewport spacer must grow with it.
    setPageHeight((current) => (current === height ? current : height));

    drawBackground();
    redraw();
  }, [drawBackground, redraw]);

  // Keep the page canvases matched to the sheet as the note grows.
  useEffect(() => {
    resizeCanvas();
    if (!containerRef.current) return;

    const ro = new ResizeObserver(() => resizeCanvas());
    ro.observe(containerRef.current);

    // The page grows with the typed text, which is a DOM mutation rather than a
    // resize every browser reports, so watch the sheet as well and repaint.
    const mo = new MutationObserver(() => resizeCanvas());
    mo.observe(containerRef.current, { childList: true, subtree: true, characterData: true });

    window.addEventListener('resize', resizeCanvas);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [resizeCanvas]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // ---- Page zoom ---------------------------------------------------------
  /**
   * Changes the sheet zoom while keeping `focal` (a client point) over the same
   * page spot. The actual scroll correction runs in a layout effect below,
   * after the new transform has been applied.
   */
  const applyZoom = useCallback((nextZoom: number, focal?: Point, target = focal) => {
    const clamped = clampPageZoom(nextZoom);
    const page = pageRef.current;
    const current = zoomRef.current || 1;

    if (focal && target && page) {
      const rect = page.getBoundingClientRect();
      zoomAnchorRef.current = {
        clientX: target.x,
        clientY: target.y,
        pageX: (focal.x - rect.left) / current,
        pageY: (focal.y - rect.top) / current
      };
    }

    if (Math.abs(clamped - current) < 0.001) {
      zoomAnchorRef.current = null;
      return;
    }

    zoomRef.current = clamped;
    setZoom(clamped);
  }, []);

  // Keep the focal page point under the user's fingers after the transform.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    const page = pageRef.current;
    const scroll = scrollRef.current;
    if (!anchor || !page || !scroll) return;

    const rect = page.getBoundingClientRect();
    scroll.scrollLeft += rect.left + anchor.pageX * zoom - anchor.clientX;
    scroll.scrollTop += rect.top + anchor.pageY * zoom - anchor.clientY;
  }, [zoom]);

  // Re-render the ink bitmap at the settled zoom level. During the pinch the
  // existing bitmap is simply scaled by CSS, which keeps the gesture smooth.
  useEffect(() => {
    const timer = window.setTimeout(() => resizeCanvas(), 140);
    return () => window.clearTimeout(timer);
  }, [zoom, resizeCanvas]);

  /** Opens small screens at a readable width instead of a cropped A4 sheet. */
  const initialFitDoneRef = useRef(false);
  useLayoutEffect(() => {
    if (initialFitDoneRef.current) return;
    initialFitDoneRef.current = true;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const fit = getFitWidthZoom(scroll.clientWidth, pageSize.width, 24);
    if (fit < 1) applyZoom(fit);
    // The opening fit is intentionally computed once, from the first layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const rect = scroll.getBoundingClientRect();
      applyZoom(zoomRef.current * factor, {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      });
    },
    [applyZoom]
  );

  const fitPageWidth = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const rect = scroll.getBoundingClientRect();
    applyZoom(getFitWidthZoom(rect.width, pageSize.width, 24), {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    });
  }, [applyZoom, pageSize.width]);

  const resetZoom = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const rect = scroll.getBoundingClientRect();
    applyZoom(1, {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    });
  }, [applyZoom]);

  /**
   * Two-finger pinch on the page viewport (paper or desk), plus trackpad pinch
   * (reported as Ctrl + wheel). Finger touches on the canvas normally draw ink,
   * so the gesture handlers explicitly take the drag away on a second finger.
   */
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    type Gesture = {
      ids: [number, number];
      focal: Point;
      startDistance: number;
      startZoom: number;
      zooming: boolean;
    };
    let gesture: Gesture | null = null;
    let single: { id: number; start: Point; last: Point; scrolling: boolean } | null = null;

    const touchesInViewport = (event: TouchEvent) =>
      Array.from(event.touches).filter((touch) => node.contains(touch.target as Node));

    const geometry = (first: Touch, second: Touch) => ({
      focal: { x: (first.clientX + second.clientX) / 2, y: (first.clientY + second.clientY) / 2 },
      distance: Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY))
    });
    const pan = (from: Point, to: Point) => {
      node.scrollLeft -= to.x - from.x;
      node.scrollTop -= to.y - from.y;
    };
    const updateGesture = (touches: Touch[]) => {
      touchCountRef.current = touches.length;
      if (touches.length < 2 || isStylusActiveRef.current || spenTipDownRef.current) return;
      if (gesture?.ids.every((id) => touches.some((touch) => touch.identifier === id))) return;
      const [first, second] = touches;
      const { focal, distance } = geometry(first, second);
      if (!isPinchingRef.current) abortActiveCanvasDrag();
      isPinchingRef.current = true;
      single = null;
      gesture = {
        ids: [first.identifier, second.identifier],
        focal,
        startDistance: distance,
        startZoom: zoomRef.current,
        zooming: false
      };
    };

    const onTouchStart = (event: TouchEvent) => {
      const touches = touchesInViewport(event);
      updateGesture(touches);
      if (isPinchingRef.current) {
        event.preventDefault();
      } else if (touches.length === 1 && !(event.target as Element).closest('.ink-canvas, [data-ink-ui=selection]')) {
        // Text and the desk can still scroll with one finger. Let a stationary
        // touch place the caret or activate a control normally.
        const [touch] = touches;
        const point = { x: touch.clientX, y: touch.clientY };
        single = { id: touch.identifier, start: point, last: point, scrolling: false };
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      const touches = touchesInViewport(event);
      updateGesture(touches);
      if (!isPinchingRef.current) {
        if (!single || isStylusActiveRef.current || spenTipDownRef.current) return;
        const touch = touches.find(({ identifier }) => identifier === single?.id);
        if (!touch) return;
        const point = { x: touch.clientX, y: touch.clientY };
        if (!single.scrolling && Math.hypot(point.x - single.start.x, point.y - single.start.y) < 8) return;
        event.preventDefault();
        single.scrolling = true;
        pan(single.last, point);
        single.last = point;
        return;
      }

      event.preventDefault();
      if (!gesture || touches.length < 2 || isStylusActiveRef.current || spenTipDownRef.current) return;
      const first = touches.find(({ identifier }) => identifier === gesture?.ids[0]);
      const second = touches.find(({ identifier }) => identifier === gesture?.ids[1]);
      if (!first || !second) return;
      const { focal, distance } = geometry(first, second);

      // Allow a little finger-spacing drift during a pan before starting zoom.
      if (!gesture.zooming && Math.abs(distance - gesture.startDistance) >= Math.max(12, gesture.startDistance * 0.08)) {
        gesture.zooming = true;
        gesture.startDistance = distance;
        gesture.startZoom = zoomRef.current;
      }
      const before = zoomRef.current;
      if (gesture.zooming) {
        applyZoom(gesture.startZoom * distance / gesture.startDistance, gesture.focal, focal);
      }
      if (zoomRef.current === before) pan(gesture.focal, focal);
      gesture.focal = focal;
    };

    const onTouchEnd = (event: TouchEvent) => {
      const touches = touchesInViewport(event);
      updateGesture(touches);
      if (!touches.some(({ identifier }) => identifier === single?.id)) single = null;
      if (touches.length < 2) gesture = null;
      // Suppress ink until both fingers from the gesture are off the page.
      if (touches.length === 0) isPinchingRef.current = false;
    };

    // Desktop pinch arrives as a ctrl/meta wheel gesture from the trackpad.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0025);
      applyZoom(zoomRef.current * factor, { x: event.clientX, y: event.clientY });
    };

    node.addEventListener('touchstart', onTouchStart, { passive: false });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd, { passive: false });
    node.addEventListener('touchcancel', onTouchEnd, { passive: false });
    node.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchEnd);
      node.removeEventListener('wheel', onWheel);
    };
  }, [abortActiveCanvasDrag, applyZoom]);

  /**
   * Rotates the sheet. Ink drawn on a wider page is scaled down so switching
   * between landscape and portrait never hides strokes off the right edge.
   */
  const changePageLayout = useCallback(
    (next: PageLayout) => {
      if (next === pageLayout) return;

      const nextSize = getPageSize(next);
      const bounds = getStrokesBounds(strokesRef.current);
      const contentRight = bounds ? bounds.x + bounds.width : 0;
      if (contentRight > nextSize.width) {
        const factor = nextSize.width / contentRight;
        commitStrokes(
          strokesRef.current.map((stroke) => ({
            ...stroke,
            points: stroke.points.map((point) => ({
              ...point,
              x: point.x * factor,
              y: point.y * factor
            }))
          }))
        );
        setSelection([]);
      }

      onChangePageLayout?.(next);
    },
    [commitStrokes, onChangePageLayout, pageLayout, setSelection]
  );

  // Fit legacy ink (drawn before notes had a fixed A4 sheet) onto the page the
  // first time it is opened, so old strokes are not left off the right edge.
  const normalizedNoteRef = useRef<string | null>(null);
  useEffect(() => {
    if (normalizedNoteRef.current === noteId) return;
    normalizedNoteRef.current = noteId;
    const bounds = getStrokesBounds(strokesRef.current);
    const contentRight = bounds ? bounds.x + bounds.width : 0;
    if (contentRight <= pageSize.width) return;
    const factor = pageSize.width / contentRight;
    commitStrokes(
      strokesRef.current.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => ({
          ...point,
          x: point.x * factor,
          y: point.y * factor
        }))
      }))
    );
  }, [noteId, pageSize.width, commitStrokes]);

  /**
   * Converts a client point to page CSS pixels. The sheet is CSS-scaled for
   * zoom, so the bitmap-to-client ratio is undone here; ink always stores
   * coordinates in the page's own coordinate space.
   */
  const getPagePointFromClient = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width ? canvas.offsetWidth / rect.width : 1;
    const scaleY = rect.height ? canvas.offsetHeight / rect.height : 1;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }, []);

  // Extract pointer coordinates relative to canvas
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const point = getPagePointFromClient(e.clientX, e.clientY);
    const { x, y } = point;

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

  const openQuickMenu = useCallback((position: { x: number; y: number } | null) => {
    setQuickMenuPos(position);
    setIsQuickMenuOpen(true);
  }, []);

  // Saving a drag can rerender the note while the side button is still held.
  // Keep the gesture listener alive and call the latest drag callbacks.
  const spenDragActions = useRef({ commitActiveDrag, finishEraserDragPreview });
  useLayoutEffect(() => {
    spenDragActions.current = { commitActiveDrag, finishEraserDragPreview };
  }, [commitActiveDrag, finishEraserDragPreview]);

  useEffect(() => {
    let active = true;
    const gesture = createSpenGesture({
      holdMs: () => spenHoldEraseMsRef.current,
      onEraser: (armed) => {
        if (!active) return;
        isSpenEraserArmedRef.current = armed;
        setIsSpenEraserArmed(armed);
        if (!armed && isEraserDrawingRef.current && selectedToolRef.current !== 'eraser') {
          spenDragActions.current.finishEraserDragPreview();
        }
        playToggleAudioFeedback(armed);
        logSpenSample('tool', { note: armed ? 'Hold: eraser' : 'Release: selected tool' });
        setStylusTelemetry((prev) => ({ ...prev, lastTrigger: armed ? 'HOLD: ERASER' : 'RELEASE: SELECTED TOOL' }));
      },
      onDoublePress: () => {
        if (!spenDoublePressOpensMenuRef.current) return;
        logSpenSample('menu', { note: 'Double press: quick palette' });
        openQuickMenu(lastPenClientPosRef.current);
      }
    });

    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return;
      const kind = e.type === 'pointerdown' ? 'down' : e.type === 'pointerup' ? 'up' : e.type === 'pointercancel' ? 'cancel' : 'move';
      const onControl = isInkUiTarget(e.target);
      lastStylusActiveTimeRef.current = Date.now();
      lastPenClientPosRef.current = { x: e.clientX, y: e.clientY };
      gesture.pointer(kind, e, !onControl);
      spenTipDownRef.current = gesture.tipDown;
      const contact = gesture.tipDown;
      setStylusTelemetry((prev) => ({
        ...prev,
        status: contact ? 'drawing' : 'hovering',
        buttons: e.buttons,
        button: e.button,
        pressure: e.pressure
      }));
      const last = lastLoggedMoveRef.current;
      const now = Date.now();
      if (kind !== 'move' || e.buttons !== last.buttons || contact !== last.contact || now - last.time >= 60) {
        lastLoggedMoveRef.current = { time: now, buttons: e.buttons, contact };
        logSpenSample(kind, { pointerType: e.pointerType, buttons: e.buttons, button: e.button, pressure: e.pressure, contact });
      }
    };

    // Compatibility mouse events can be emitted on an ordinary tip touch.
    // They may act on controls but must never change the side-button state.
    const onCompatibilityClick = (e: MouseEvent) => {
      const isPen = (e as PointerEvent).pointerType === 'pen';
      const recentPen = Date.now() - lastStylusActiveTimeRef.current < 400;
      if (!isPen && !recentPen) return;
      if (isInkUiTarget(e.target)) {
        e.preventDefault();
        clickInkUiControl(e.target);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (!isSpenHardwareKeyEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();
      logSpenSample(e.type, { note: e.code || String(e.keyCode) });
      if (e.type === 'keyup') gesture.keyUp();
      else if (!e.repeat) gesture.keyDown();
    };

    const reset = () => {
      gesture.reset();
      spenTipDownRef.current = false;
      if (isStylusActiveRef.current) {
        spenDragActions.current.commitActiveDrag();
        isStylusActiveRef.current = false;
      }
    };
    const pointerEvents = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel'] as const;
    pointerEvents.forEach((type) => window.addEventListener(type, onPointer, true));
    window.addEventListener('contextmenu', onCompatibilityClick, true);
    window.addEventListener('auxclick', onCompatibilityClick, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', reset);
    return () => {
      active = false;
      gesture.reset();
      isSpenEraserArmedRef.current = false;
      pointerEvents.forEach((type) => window.removeEventListener(type, onPointer, true));
      window.removeEventListener('contextmenu', onCompatibilityClick, true);
      window.removeEventListener('auxclick', onCompatibilityClick, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', reset);
    };
  }, [clickInkUiControl, logSpenSample, openQuickMenu]);

  /**
   * Applies the currently selected eraser mode at a canvas point.
   * Object mode removes whole strokes; pixel mode only removes the covered part.
   */
  const eraseAtPoint = (strokeList: Stroke[], x: number, y: number) => {
    return eraserMode === 'pixel'
      ? eraseStrokesPartial(strokeList, x, y, eraserWidth)
      : eraseStrokesNearPoint(strokeList, x, y, eraserWidth);
  };

  /** Builds a new ink stroke from the current pen settings. */
  const buildInkStroke = (startPoint: StrokePoint): Stroke => {
    const tool = selectedToolRef.current === 'eraser' ? lastWritingToolRef.current : selectedToolRef.current;
    return {
      id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      points: [startPoint],
      color: penColor,
      width: penWidth,
      tool,
      opacity: tool === 'highlighter' ? 0.4 : 1.0
    };
  };

  // ---- Select tool: marquee, transforms and layering ---------------------

  const getPagePoint = useCallback(
    (clientX: number, clientY: number): Point => getPagePointFromClient(clientX, clientY),
    [getPagePointFromClient]
  );

  const deleteSelection = useCallback(() => {
    const ids = new Set(selectedIdsRef.current);
    const hadText = isTextSelectedRef.current;
    if (ids.size === 0 && !hadText) return;

    // The typed text is not part of the ink undo history, so make clearing it
    // an explicit choice rather than a single accidental tap.
    if (hadText && !window.confirm('Delete the selected text block?')) return;

    setSelection([]);
    if (hadText) {
      // Deleting the block removes its text and resets the placement, so new
      // text starts at the top of the page instead of inheriting the transform.
      setTextBlockLayout(IDENTITY_TEXT_BLOCK_LAYOUT);
      onDeleteText?.();
    }
    if (ids.size > 0) {
      commitStrokes(strokesRef.current.filter((stroke) => !ids.has(stroke.id)));
    }
  }, [commitStrokes, onDeleteText, setSelection]);

  const bringSelectionToFront = useCallback(() => {
    const ids = new Set(selectedIdsRef.current);
    if (ids.size === 0) return;
    commitStrokes(reorderSelection(strokesRef.current, ids, 'front'));
  }, [commitStrokes]);

  const sendSelectionToBack = useCallback(() => {
    const ids = new Set(selectedIdsRef.current);
    if (ids.size === 0) return;
    commitStrokes(reorderSelection(strokesRef.current, ids, 'back'));
  }, [commitStrokes]);

  /**
   * Starts a move, resize or rotate of the selected objects. The strokes are
   * previewed locally while the drag runs and committed as one undo step on
   * release, exactly like an eraser drag.
   */
  const beginTransform = useCallback(
    (kind: TransformDrag['kind'], corner: ResizeCorner | null, e: React.PointerEvent) => {
      const bounds = selectionBoundsRef.current;
      if (!bounds || (selectedIdsRef.current.length === 0 && !isTextSelectedRef.current)) return;
      e.preventDefault();
      e.stopPropagation();

      const start = getPagePoint(e.clientX, e.clientY);
      const drag: TransformDrag = {
        kind,
        corner,
        start,
        bounds,
        baseStrokes: strokesRef.current
      };
      transformDragRef.current = drag;
      const baseTextLayout = textBlockLayoutRef.current;

      const center: Point = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2
      };
      // Resizing scales about the corner opposite the one being dragged.
      const anchor: Point = {
        x: corner === 'nw' || corner === 'sw' ? bounds.x + bounds.width : bounds.x,
        y: corner === 'nw' || corner === 'ne' ? bounds.y + bounds.height : bounds.y
      };
      const startDistance = Math.hypot(start.x - anchor.x, start.y - anchor.y);

      const computeTransform = (point: Point): InkTransform => {
        if (kind === 'move') {
          return {
            ...IDENTITY_INK_TRANSFORM,
            originX: center.x,
            originY: center.y,
            translateX: point.x - start.x,
            translateY: point.y - start.y
          };
        }
        if (kind === 'rotate') {
          const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
          const angle = Math.atan2(point.y - center.y, point.x - center.x);
          return {
            ...IDENTITY_INK_TRANSFORM,
            originX: center.x,
            originY: center.y,
            rotation: angle - startAngle
          };
        }
        const distance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
        const scale = startDistance < 1 ? 1 : Math.min(20, Math.max(0.05, distance / startDistance));
        return { ...IDENTITY_INK_TRANSFORM, originX: anchor.x, originY: anchor.y, scale };
      };

      const onMove = (event: PointerEvent) => {
        const transform = computeTransform(getPagePoint(event.clientX, event.clientY));
        previewStrokesRef.current = applyInkTransform(
          drag.baseStrokes,
          new Set(selectedIdsRef.current),
          transform
        );
        liveTransformRef.current = transform;
        setLiveTransform(transform);
        redraw();
      };

      const finish = (commit: boolean) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        transformCleanupRef.current = null;
        transformDragRef.current = null;

        const transform = liveTransformRef.current;
        const preview = previewStrokesRef.current;
        liveTransformRef.current = null;
        setLiveTransform(null);

        if (commit && transform && !isIdentityTransform(transform)) {
          if (preview && selectedIdsRef.current.length > 0) {
            commitStrokes(preview);
          } else {
            previewStrokesRef.current = null;
            redraw();
          }

          if (isTextSelectedRef.current && onChangeTextLayout) {
            const nextLayout = composeTextBlockLayout(baseTextLayout, transform);
            setTextBlockLayout(nextLayout);
            onChangeTextLayout(nextLayout);
          }
        } else {
          previewStrokesRef.current = null;
          redraw();
        }
      };

      const onUp = () => finish(true);
      const onCancel = () => finish(false);

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      transformCleanupRef.current = () => finish(false);
    },
    [commitStrokes, getPagePoint, onChangeTextLayout, redraw]
  );

  /** Select mode touch-down: drag the frame, or start a new marquee. */
  const handleSelectPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    selectPointerTypeRef.current = e.pointerType;
    const point = getPagePoint(e.clientX, e.clientY);
    const bounds = selectionBoundsRef.current;
    const insideFrame =
      !!bounds &&
      point.x >= bounds.x - 4 &&
      point.x <= bounds.x + bounds.width + 4 &&
      point.y >= bounds.y - 4 &&
      point.y <= bounds.y + bounds.height + 4;

    if (insideFrame) {
      startSelectionMove(e);
      return;
    }

    const geometry: MarqueeGeometry = {
      mode: selectModeRef.current,
      start: point,
      end: point,
      points: [point]
    };
    marqueeRef.current = geometry;
    setMarquee(geometry);
  };

  /**
   * Starts a drag from the selection frame. If the press lands on an ink object
   * that is not part of the selection, that object becomes the selection first,
   * so a stroke hidden behind the text or behind another selection can be
   * picked up without dismissing the frame first.
   */
  const startSelectionMove = (e: React.PointerEvent) => {
    selectPointerTypeRef.current = e.pointerType;
    const point = getPagePoint(e.clientX, e.clientY);
    const tolerance = e.pointerType === 'touch' ? 18 : 10;
    const hit = hitTestStroke(strokesRef.current, point, tolerance);

    if (hit && !selectedIdsRef.current.includes(hit.id)) {
      setSelection([hit.id], false);
      // beginTransform reads this ref immediately, before React re-renders.
      selectionBoundsRef.current = getStrokesBounds([hit]);
    }

    beginTransform('move', null, e);
  };

  const updateMarquee = (point: Point) => {
    const current = marqueeRef.current;
    if (!current) return;

    const next: MarqueeGeometry = { ...current, end: point };
    if (current.mode === 'lasso') {
      const points = current.points ?? [current.start];
      const last = points[points.length - 1];
      next.points =
        Math.hypot(point.x - last.x, point.y - last.y) >= 2 ? [...points, point] : points;
    }
    marqueeRef.current = next;
    setMarquee(next);
  };

  /** Turns the finished rubber band into a selection (a tap picks one object). */
  const finalizeSelection = () => {
    const geometry = marqueeRef.current;
    marqueeRef.current = null;
    setMarquee(null);
    if (!geometry) return;

    const measured = measureTextBlock();
    if (measured) textBlockBoxRef.current = measured.box;
    const textBounds = measured
      ? transformTextBlockBounds(measured.box, textBlockLayoutRef.current)
      : null;

    const width = Math.abs(geometry.end.x - geometry.start.x);
    const height = Math.abs(geometry.end.y - geometry.start.y);
    const isTap = geometry.mode !== 'lasso' && width < 4 && height < 4;
    const tolerance = selectPointerTypeRef.current === 'touch' ? 18 : 10;

    if (isTap) {
      // Ink wins a tap when it is actually under the point; otherwise a tap on
      // the typed text picks the text block. This keeps strokes that pass
      // behind the text selectable.
      const hit = hitTestStroke(strokesRef.current, geometry.end, tolerance);
      if (hit) {
        setSelection([hit.id], false);
        return;
      }
      setSelection([], !!textBounds && pointInBounds(geometry.end, textBounds));
      return;
    }

    const ids = selectStrokeIds(strokesRef.current, geometry);
    const textHit = !!textBounds && marqueeSelectsTextBlock(geometry, textBounds);
    setSelection(ids, textHit);
  };

  // Pointer Down (stylus touches screen)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen' && (!spenTipDownRef.current || isPinchingRef.current)) return;
    dragSawPressureRef.current = false;
    zeroPressureSamplesRef.current = 0;

    // 1. Stylus-Only Mode: Completely ignore any non-pen touch. The Select tool
    // is the exception: selection should work with a finger as well as the pen.
    if (isStylusOnly && e.pointerType !== 'pen' && activeTool !== 'select') {
      return;
    }

    // 2. Palm Rejection via Contact Geometry. Selection is deliberately more
    // permissive: a finger is a first-class selection input, so only obvious
    // palm-sized contacts are rejected there.
    const palmLimit = activeTool === 'select' ? 40 : 22;
    if (e.pointerType === 'touch' && (e.width > palmLimit || e.height > palmLimit)) {
      return; // Reject broad palm contact
    }

    // 3. Stylus priority palm rejection
    if (e.pointerType === 'pen') {
      isStylusActiveRef.current = true;
    } else if (isStylusActiveRef.current && e.pointerType === 'touch') {
      return;
    }

    // Touch events take ownership from the first finger once the second lands.
    if (e.pointerType === 'touch' && (isPinchingRef.current || !e.isPrimary || touchCountRef.current > 1)) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The pointer can already be gone (or be a synthetic event); the drag
      // still works through the canvas' own move/up handlers.
    }

    // Select tool: rubber-band over drawn objects instead of inking.
    if (activeTool === 'select') {
      fingerTapRef.current = null;
      handleSelectPointerDown(e);
      return;
    }

    // Finger contact is ambiguous until it moves: remember the touchdown so a
    // stationary tap can hand the caret to the note sheet on lift.
    if (e.pointerType === 'touch') {
      fingerTapRef.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        time: Date.now(),
        moved: false,
        drawsInk: !(isSpenEraserArmedRef.current || selectedToolRef.current === 'eraser')
      };
    } else {
      fingerTapRef.current = null;
    }

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
      currentStrokeRef.current = buildInkStroke(startPoint);
    }

    redraw();
  };

  // Pointer Move (coalesced 120Hz events loop)
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPinchingRef.current || (e.pointerType === 'touch' && !e.isPrimary)) return;
    if (isStylusOnly && e.pointerType !== 'pen' && activeTool !== 'select') return;
    if (isStylusActiveRef.current && e.pointerType === 'touch') return;

    if (e.pointerType === 'pen' && !spenTipDownRef.current) {
      if (isStylusActiveRef.current) handlePointerUp(e);
      return;
    }
    if (e.pointerType === 'pen' && spenTipDownRef.current && !isStylusActiveRef.current) {
      handlePointerDown(e);
      return;
    }

    if (activeTool === 'select') {
      if (marqueeRef.current) updateMarquee(getPagePoint(e.clientX, e.clientY));
      return;
    }

    // A finger that travels is swiping (insert drawing), not tapping.
    const fingerTap = fingerTapRef.current;
    if (fingerTap && fingerTap.pointerId === e.pointerId && !fingerTap.moved) {
      const dx = e.clientX - fingerTap.x;
      const dy = e.clientY - fingerTap.y;
      if (dx * dx + dy * dy > FINGER_TAP_SLOP_PX * FINGER_TAP_SLOP_PX) {
        fingerTap.moved = true;
      }
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const nativeEvent = e.nativeEvent as PointerEvent;

    // Don't add points when a pressure-sensitive pen briefly reports zero.
    // Such a sample must never extend a stroke or erase: if the browser dropped
    // the pointerup (Chromium does while the side button is held), the drag is
    // still open and hovering used to keep carving ink away. Close it after a
    // second sample so one odd reading cannot split a stroke; pens that never
    // report pressure keep the old behaviour.
    if (e.pointerType === 'pen' && nativeEvent.pressure === 0 && dragSawPressureRef.current) {
      zeroPressureSamplesRef.current += 1;
      if (zeroPressureSamplesRef.current >= 2) {
        commitActiveDrag();
        isStylusActiveRef.current = false;
      }
      return;
    }
    if (e.pointerType === 'pen' && nativeEvent.pressure > 0) {
      dragSawPressureRef.current = true;
      zeroPressureSamplesRef.current = 0;
    }

    const rawEvents = nativeEvent.getCoalescedEvents?.() ?? [];
    const coalescedEvents = rawEvents.length > 0 ? rawEvents : [nativeEvent];

    const isEraserNow = isSpenEraserArmedRef.current || selectedToolRef.current === 'eraser';
    if (e.pointerType === 'pen' && isStylusActiveRef.current && spenTipDownRef.current) {
      if (isEraserNow && !isEraserDrawingRef.current) {
        commitActiveDrag();
        isEraserDrawingRef.current = true;
        previewStrokesRef.current = strokesRef.current;
      } else if (!isEraserNow && !currentStrokeRef.current && selectedToolRef.current !== 'text') {
        currentStrokeRef.current = buildInkStroke(getCanvasPoint(e));
        return;
      }
    }
    // ERASER MODE: preview erasing locally; committed as one undoable step on lift
    if (isEraserNow && isEraserDrawingRef.current) {
      let currentStrokes = previewStrokesRef.current ?? strokesRef.current;
      let anyErased = false;

      for (const ce of coalescedEvents) {
        const point = getPagePointFromClient(ce.clientX, ce.clientY);
        const res = eraseAtPoint(currentStrokes, point.x, point.y);
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

      const point = getPagePointFromClient(ce.clientX, ce.clientY);
      currentStrokeRef.current.points.push({
        x: point.x,
        y: point.y,
        pressure,
        time: Date.now()
      });
    }

    redraw();
  };

  // End the drag without changing the independent side-button state.
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Lifting a finger during a pinch must not commit the stroke the first
    // finger started (it was already discarded when the pinch began).
    if (isPinchingRef.current || (e.pointerType === 'touch' && (!e.isPrimary || isStylusActiveRef.current))) return;

    if (e.pointerType === 'pen' && spenTipDownRef.current) return;
    if (activeTool === 'select') {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {}
      }
      if (e.pointerType === 'pen') {
        isStylusActiveRef.current = false;
      }
      finalizeSelection();
      return;
    }

    dragSawPressureRef.current = false;
    zeroPressureSamplesRef.current = 0;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }

    if (e.pointerType === 'pen') {
      isStylusActiveRef.current = false;
    }

    // Commit the eraser drag or ink stroke as a single undoable step
    commitActiveDrag();

    // A finger tap that never travelled shows the writing cursor instead: the
    // single-point dot it drew was discarded by commitActiveDrag above.
    const fingerTap = fingerTapRef.current;
    fingerTapRef.current = null;
    if (
      fingerTap &&
      e.pointerType === 'touch' &&
      fingerTap.pointerId === e.pointerId &&
      !fingerTap.moved &&
      fingerTap.drawsInk &&
      Date.now() - fingerTap.time <= FINGER_TAP_MAX_MS
    ) {
      // The tap asks for the caret, so the sheet becomes the active tool.
      setSelectedTool('text');
      selectedToolRef.current = 'text';
      onFingerTap?.();
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // A cancelled touch is never a tap: only a clean lift hands over the caret.
    fingerTapRef.current = null;
    handlePointerUp(e);
  };

  // Keeps the browser's own context menu off the canvas. S Pen button presses
  // are handled by the global capture listeners, which run first.
  const suppressCanvasMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
    selectedToolRef.current = tool;

    if (tool === 'text') {
      onRequestTextFocus?.();
    } else if (tool !== 'select') {
      setSelection([]);
      marqueeRef.current = null;
      setMarquee(null);
    }
  };

  // spenLogVersion is bumped (throttled) by logSpenSample while the panel is
  // open; reading the buffer here on every render keeps the list and the
  // header count in sync, since other state changes repaint this component too.
  void spenLogVersion;
  const spenLogEntries = spenLogRef.current.slice(-SPEN_LOG_RENDER_LIMIT).reverse();

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectionBounds = useMemo(() => {
    const strokeBounds = getStrokesBounds(
      strokes.filter((stroke) => selectedIdSet.has(stroke.id))
    );
    if (!isTextSelected) return strokeBounds;

    const local = textBlockBoxRef.current;
    const textBounds = local
      ? transformTextBlockBounds(local, textBlockLayoutRef.current)
      : null;
    return unionBounds(strokeBounds, textBounds);
    // textBlockLayout is read through its ref; the dependency keeps the box in
    // sync after a committed text transform.
  }, [strokes, selectedIdSet, isTextSelected, textBlockBoxVersion, textBlockLayout]);
  selectionBoundsRef.current = selectionBounds;

  /** Outline for the rubber band currently being dragged. */
  const renderMarquee = (geometry: MarqueeGeometry) => {
    const x = Math.min(geometry.start.x, geometry.end.x);
    const y = Math.min(geometry.start.y, geometry.end.y);
    const width = Math.abs(geometry.end.x - geometry.start.x);
    const height = Math.abs(geometry.end.y - geometry.start.y);
    const common = {
      fill: 'rgba(124, 58, 237, 0.10)',
      stroke: '#7c3aed',
      strokeWidth: 1.5,
      strokeDasharray: '5 4'
    };

    if (geometry.mode === 'lasso') {
      return (
        <polygon
          points={(geometry.points ?? []).map((point) => `${point.x},${point.y}`).join(' ')}
          {...common}
        />
      );
    }
    if (geometry.mode === 'ellipse') {
      return (
        <ellipse
          cx={x + width / 2}
          cy={y + height / 2}
          rx={Math.max(1, width / 2)}
          ry={Math.max(1, height / 2)}
          {...common}
        />
      );
    }
    return <rect x={x} y={y} width={width} height={height} {...common} />;
  };

  const displayTextLayout =
    isTextSelected && liveTransform
      ? composeTextBlockLayout(textBlockLayout, liveTransform)
      : textBlockLayout;
  const textLayerStyle: React.CSSProperties | undefined = isIdentityTextBlockLayout(
    displayTextLayout
  )
    ? undefined
    : {
        transformOrigin: '0 0',
        transform: `translate(${displayTextLayout.x}px, ${displayTextLayout.y}px) rotate(${displayTextLayout.rotation}rad) scale(${displayTextLayout.scale})`
      };

  const drawingTools = (
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
      onOpenSPenMenu={() => openQuickMenu(null)}
      lastWritingTool={lastWritingToolRef.current}
      selectMode={selectMode}
      onChangeSelectMode={setSelectMode}
    />
  );

  return (
    <div className="flex flex-col w-full h-full relative select-none">
      <div className="relative z-10 shrink-0 pointer-events-auto" data-ink-ui="toolbar-shell">
        {textEditor && onChangeBackground ? (
          <NoteRibbon
            editor={textEditor}
            textActive={activeTool === 'text'}
            enableText={() => {
              if (selectedToolRef.current === 'text') return;
              // Make the page editable before running the ribbon command, preserving the caret.
              flushSync(() => {
                selectedToolRef.current = 'text';
                setSelectedTool('text');
              });
            }}
            drawingTools={drawingTools}
            orientation={pageLayout}
            background={background}
            onOrientationChange={changePageLayout}
            onBackgroundChange={onChangeBackground}
          />
        ) : (
          <div className="flex justify-center px-4 py-2">{drawingTools}</div>
        )}
      </div>

      {/* The note page: an A4 sheet floating on the desk. Ruling, back ink,
          typed text and front ink all live on the one paper surface. */}
      <div className="relative flex-1 min-h-0 z-0">
        <div
          ref={scrollRef}
          className="note-desk absolute inset-0 overflow-auto"
          data-ink-ui="page-viewport"
        >
          <div className="note-desk-inner px-3 py-4 sm:px-6 sm:py-8">
            <div
              className="mx-auto"
              style={{
                width: `${pageSize.width * zoom}px`,
                height: `${Math.max(pageHeight, pageSize.height) * zoom}px`
              }}
            >
              <div
                ref={pageRef}
                className="note-paper relative"
                style={{
                  width: `${pageSize.width}px`,
                  minHeight: `${pageSize.height}px`,
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left'
                }}
              >
                <div
                  ref={containerRef}
                  onContextMenu={suppressCanvasMenu}
                  onAuxClick={suppressCanvasMenu}
                  className="relative w-full"
                  style={{ minHeight: `${pageSize.height}px` }}
                >
                  <canvas
                    ref={backgroundCanvasRef}
                    aria-hidden="true"
                    className="absolute inset-0 z-0 block pointer-events-none"
                  />
                  <canvas
                    ref={backCanvasRef}
                    aria-hidden="true"
                    className="absolute inset-0 z-10 block pointer-events-none"
                  />

                  {/* Typed text lives between the back and front ink layers. Its
                      saved layout moves / scales / rotates the whole block. */}
                  <div
                    ref={textLayerRef}
                    className={`relative z-20 ${activeTool === 'text' ? '' : 'pointer-events-none'}`}
                    style={textLayerStyle}
                  >
                    {textLayer}
                  </div>

                  <canvas
                    ref={canvasRef}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerCancel}
                    onPointerLeave={(e) => {
                      // A rubber band or a selection drag may legitimately travel
                      // past the page edge; only ink drags end on leave.
                      if (activeTool !== 'select') handlePointerCancel(e);
                    }}
                    onContextMenu={suppressCanvasMenu}
                    onAuxClick={suppressCanvasMenu}
                    className={`ink-canvas absolute inset-0 z-30 block ${activeTool === 'text' ? 'pointer-events-none' : ''}`}
                    style={{
                      cursor: activeTool === 'select' ? 'default' : 'crosshair',
                      touchAction: 'none'
                    }}
                  />

                  {activeTool === 'select' && marquee && (
                    <svg className="absolute inset-0 z-40 w-full h-full pointer-events-none" aria-hidden="true">
                      {renderMarquee(marquee)}
                    </svg>
                  )}

                  {activeTool === 'select' && selectionBounds && (
                    <SelectionOverlay
                      bounds={selectionBounds}
                      transform={liveTransform}
                      count={selectedIdSet.size}
                      textSelected={isTextSelected}
                      onStartMove={startSelectionMove}
                      onStartResize={(corner, e) => beginTransform('resize', corner, e)}
                      onStartRotate={(e) => beginTransform('rotate', null, e)}
                      onBringToFront={bringSelectionToFront}
                      onSendToBack={sendSelectionToBack}
                      onDelete={deleteSelection}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Overlays that stay put while the page scrolls. */}
        <div className="pointer-events-none absolute inset-0 z-40">
        {/* Bottom Left: S Pen Live Telemetry / Diagnostic Badge */}
        <div className="pointer-events-auto absolute bottom-4 left-4 z-10 flex flex-col items-start gap-1" data-ink-ui="stylus-status">
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

          <button
            type="button"
            onClick={() => {
              const next = !isSpenLogOpenRef.current;
              isSpenLogOpenRef.current = next;
              setIsSpenLogOpen(next);
              setSpenLogVersion((v) => v + 1);
            }}
            title="S Pen sample log — button, pressure and tool changes, copyable for bug reports"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-surface-light/80 dark:bg-surface-dark/80 backdrop-blur-md border border-surface-subtle-light dark:border-surface-subtle-dark text-[11px] font-medium text-ink-muted-light dark:text-ink-muted-dark shadow-subtle hover:text-ink-light dark:hover:text-ink-dark transition"
          >
            <ClipboardCopy className="w-3 h-3" />
            <span>Log{spenLogRef.current.length > 0 ? ` · ${spenLogRef.current.length}` : ''}</span>
          </button>

          {diagnosticHUD && (
            <div className="p-2.5 rounded-xl bg-surface-light/95 dark:bg-surface-dark/95 backdrop-blur-md border border-surface-subtle-light dark:border-surface-subtle-dark shadow-floating text-[10px] font-mono text-ink-light dark:text-ink-dark space-y-1 animate-in fade-in">
              <div>Eraser Active: <span className={isSpenEraserArmed ? "font-bold text-rose-500" : "text-emerald-500"}>{isSpenEraserArmed ? `YES (${eraserMode === 'pixel' ? 'Pixel' : 'Object'}, ${eraserWidth}px)` : `NO (${penWidth}px Pen)`}</span></div>
              <div>Buttons: <span className="font-semibold text-violet-500">{stylusTelemetry.buttons}</span> (button: {stylusTelemetry.button})</div>
              <div>Pressure: <span className="font-semibold">{stylusTelemetry.pressure.toFixed(2)}</span></div>
              <div>Last Event: <span className="text-emerald-500">{stylusTelemetry.lastTrigger}</span></div>
            </div>
          )}

          {isSpenLogOpen && (
            <div
              data-ink-ui="spen-log"
              className="w-[22rem] max-w-[85vw] rounded-xl bg-surface-light/95 dark:bg-surface-dark/95 backdrop-blur-md border border-surface-subtle-light dark:border-surface-subtle-dark shadow-floating text-[10px] text-ink-light dark:text-ink-dark"
            >
              <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-b border-surface-subtle-light dark:border-surface-subtle-dark">
                <span className="font-semibold uppercase tracking-wider text-ink-muted-light dark:text-ink-muted-dark">
                  S Pen log · {spenLogRef.current.length}/{SPEN_LOG_LIMIT}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={copySpenLog}
                    title="Copy log to clipboard"
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-subtle-light dark:bg-surface-subtle-dark hover:text-violet-600 dark:hover:text-violet-400 transition active:scale-95"
                  >
                    <ClipboardCopy className="w-3 h-3" />
                    <span>{spenLogCopied ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={downloadSpenLog}
                    title="Download log as .txt"
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-subtle-light dark:bg-surface-subtle-dark hover:text-violet-600 dark:hover:text-violet-400 transition active:scale-95"
                  >
                    <Download className="w-3 h-3" />
                    <span>Save</span>
                  </button>
                  <button
                    type="button"
                    onClick={clearSpenLog}
                    title="Clear the log"
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-subtle-light dark:bg-surface-subtle-dark hover:text-rose-600 transition active:scale-95"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto px-2.5 py-2 font-mono space-y-0.5">
                {spenLogEntries.length === 0 ? (
                  <p className="text-ink-muted-light dark:text-ink-muted-dark">
                    No samples yet — write with the S Pen.
                  </p>
                ) : (
                  spenLogEntries.map((entry, i) => (
                    <div key={`${entry.t}-${i}`} className="whitespace-nowrap">
                      <span className="text-ink-muted-light dark:text-ink-muted-dark">
                        {new Date(entry.t).toLocaleTimeString()}
                      </span>{' '}
                      <span className="font-semibold text-violet-600 dark:text-violet-400">{entry.kind}</span>{' '}
                      <span className={entry.tool === 'eraser' ? 'text-rose-500' : 'text-emerald-500'}>{entry.tool}</span>{' '}
                      <span>b={entry.buttons ?? '-'}</span>{' '}
                      <span>p={entry.pressure !== undefined ? entry.pressure.toFixed(2) : '-'}</span>
                      {entry.contact ? <span className="text-emerald-500"> touch</span> : null}
                      {entry.note ? (
                        <span className="text-ink-muted-light dark:text-ink-muted-dark"> {entry.note}</span>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Center: page zoom. Pinch and trackpad pinch do the same. */}
        <div
          className="pointer-events-auto absolute bottom-4 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-0.5 rounded-2xl border border-surface-subtle-light bg-surface-light/90 px-1 py-1 shadow-floating backdrop-blur-md dark:border-surface-subtle-dark dark:bg-surface-dark/90 md:flex"
          data-ink-ui="zoom-controls"
        >
          <button
            type="button"
            onClick={() => zoomBy(1 / (1 + PAGE_ZOOM_STEP))}
            title="Zoom out"
            aria-label="Zoom out"
            className="flex h-8 w-8 items-center justify-center rounded-xl text-ink-light transition hover:bg-surface-subtle-light active:scale-95 dark:text-ink-dark dark:hover:bg-surface-subtle-dark"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={resetZoom}
            title="Actual size (100%)"
            className="min-w-[3.25rem] rounded-lg px-1.5 py-1 text-[11px] font-semibold tabular-nums text-ink-muted-light transition hover:bg-surface-subtle-light hover:text-ink-light dark:text-ink-muted-dark dark:hover:bg-surface-subtle-dark dark:hover:text-ink-dark"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1 + PAGE_ZOOM_STEP)}
            title="Zoom in"
            aria-label="Zoom in"
            className="flex h-8 w-8 items-center justify-center rounded-xl text-ink-light transition hover:bg-surface-subtle-light active:scale-95 dark:text-ink-dark dark:hover:bg-surface-subtle-dark"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <span className="mx-0.5 h-5 w-px bg-surface-subtle-light dark:bg-surface-subtle-dark" aria-hidden="true" />
          <button
            type="button"
            onClick={fitPageWidth}
            title="Fit page width"
            aria-label="Fit page width"
            className="flex h-8 w-8 items-center justify-center rounded-xl text-ink-light transition hover:bg-surface-subtle-light active:scale-95 dark:text-ink-dark dark:hover:bg-surface-subtle-dark"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        {/* Bottom Right: Quick S Pen Floating Trigger Badge */}
        <div className="pointer-events-auto absolute bottom-4 right-4 z-10 flex items-center gap-2" data-ink-ui="floating-tools">
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
      </div>

      {/* S Pen Quick Menu Palette Modal */}
      <SPenQuickMenu
        isOpen={isQuickMenuOpen}
        onClose={() => setIsQuickMenuOpen(false)}
        position={quickMenuPos}
        activeTool={activeTool}
        onSelectTool={handleManualToolSelect}
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
