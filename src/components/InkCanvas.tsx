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
  transformTextBlockPoint,
  unionBounds
} from '../utils/inkSelection';
import { SelectionOverlay, ResizeCorner } from './SelectionOverlay';
import { isSpenHardwareKeyEvent } from '../utils/spenDetection';
import { createSpenGesture } from '../utils/spenGesture';
import { PenToolbar } from './PenToolbar';
import { NoteRibbon } from './NoteRibbon';
import type { TextEditorRef } from './TextEditor';
import {
  boxPlacement, boxSelector, measureBox, measurePicture, offsetWithin, pageBoxPlacement,
  pointInTextLayer, snapObjectMove, transformBox, transformPicture,
} from '../utils/pageObjects';
import { tableBoxSelector } from '../utils/noteTable';
import { TableToolbar } from './TableToolbar';
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
  /** Placement inherited from notes created before independent objects. */
  textLayout?: TextBlockLayout;
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

const SELECTION_TAP_SLOP = 7;

type TransformKind = 'move' | 'resize' | 'rotate' | 'width';

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

const OBJECT_HOLD_MS = 480;
const SNAP_DISTANCE = 10;

type ObjectHit = {
  key: string | HTMLElement;
  ids: string[];
  bounds: Bounds;
  box?: HTMLElement;
  picture?: HTMLImageElement;
  cell?: HTMLTableCellElement | null;
};

function inkObjectKey(stroke: Stroke) {
  return stroke.groupId ? `drawing:${stroke.groupId}` : `stroke:${stroke.id}`;
}

function inkObjects(strokes: Stroke[]) {
  const objects = new Map<string, Stroke[]>();
  for (const stroke of strokes) {
    const key = inkObjectKey(stroke);
    const group = objects.get(key);
    if (group) group.push(stroke);
    else objects.set(key, [stroke]);
  }
  return objects;
}

function tableCellAt(box: HTMLElement, client: Point) {
  return Array.from(box.querySelectorAll<HTMLTableCellElement>('td, th')).find((cell) => {
    const rect = cell.getBoundingClientRect();
    return pointInBounds(client, rect);
  }) ?? box.querySelector<HTMLTableCellElement>('td, th');
}

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
  const [selectedPictures, setSelectedPictures] = useState<HTMLImageElement[]>([]);
  const selectedPicturesRef = useRef<HTMLImageElement[]>([]);
  const [pictureError, setPictureError] = useState('');
  const selectionPointerRef = useRef<number | null>(null);
  const selectionStartClient = useRef<Point | null>(null);
  const selectionDragged = useRef(false);
  const selectionDismissedText = useRef(false);
  const [selectedBoxes, setSelectedBoxes] = useState<HTMLElement[]>([]);
  const selectedBoxesRef = useRef<HTMLElement[]>([]);
  const [tableCell, setTableCell] = useState<HTMLTableCellElement | null>(null);
  const [editActions, setEditActions] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeGeometry | null>(null);
  const marqueeRef = useRef<MarqueeGeometry | null>(null);
  const [liveTransform, setLiveTransform] = useState<InkTransform | null>(null);
  const liveTransformRef = useRef<InkTransform | null>(null);
  const transformDragRef = useRef(false);
  const transformCleanupRef = useRef<(() => void) | null>(null);
  const selectionBoundsRef = useRef<Bounds | null>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const textBlockLayout = textLayout ?? IDENTITY_TEXT_BLOCK_LAYOUT;
  const textBlockLayoutRef = useRef(textBlockLayout);
  textBlockLayoutRef.current = textBlockLayout;
  const [objectSizeVersion, setObjectSizeVersion] = useState(0);
  const selectPointerTypeRef = useRef<string>('mouse');
  const replacementInput = useRef<HTMLInputElement>(null);
  const lastPick = useRef<{ point: Point; keys: (string | HTMLElement)[] } | null>(null);
  const editingTap = useRef<{ box: HTMLElement; point: Point; time: number } | null>(null);

  const getEditor = useCallback(() =>
    textLayerRef.current?.querySelector<HTMLElement>('[data-note-editor]') ?? null, []);

  const getTextBoxes = useCallback(() => Array.from(
    getEditor()?.querySelectorAll<HTMLElement>(`:scope > ${boxSelector}`) ?? [],
  ), [getEditor]);

  const getPictures = useCallback((images?: HTMLImageElement[]) => {
    const editor = getEditor();
    const layer = textLayerRef.current;
    if (!editor || !layer) return [];
    return (images ?? Array.from(editor.querySelectorAll('img')))
      .filter((image) => editor.contains(image) && image.offsetWidth > 0 && image.offsetHeight > 0)
      .map((image) => measurePicture(image, editor, layer, textBlockLayoutRef.current));
  }, [getEditor]);

  const setSelection = useCallback((ids: string[], boxes: HTMLElement[] = [], pictures: HTMLImageElement[] = []) => {
    selectedPicturesRef.current = pictures;
    setSelectedPictures(pictures);
    selectedIdsRef.current = ids;
    selectedBoxesRef.current = boxes;
    setSelectedIds(ids);
    setSelectedBoxes(boxes);
    setEditActions(false);
    setTableCell(null);
  }, []);

  useEffect(() => {
    const trackCell = () => {
      const anchor = window.getSelection()?.anchorNode;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      const cell = element?.closest<HTMLTableCellElement>('td[contenteditable="true"], th[contenteditable="true"]');
      if (cell && getEditor()?.contains(cell)) setTableCell(cell);
    };
    document.addEventListener('selectionchange', trackCell);
    return () => document.removeEventListener('selectionchange', trackCell);
  }, [getEditor]);

  useEffect(() => {
    if (!tableCell) return;
    tableCell.dataset.currentCell = 'true';
    return () => { delete tableCell.dataset.currentCell; };
  }, [tableCell]);

  // Momentary S Pen Eraser State: active while pressing button, DEACTIVATES ON RELEASE
  const [isSpenEraserArmed, setIsSpenEraserArmed] = useState<boolean>(false);
  const isSpenEraserArmedRef = useRef<boolean>(false);
  const selectedToolRef = useRef<PenTool>(selectedTool);
  const lastWritingToolRef = useRef<PenTool>(
    defaultTool === 'text' || defaultTool === 'select' || defaultTool === 'eraser' ? 'fountain' : defaultTool,
  );
  const selectionNoteId = useRef(noteId);
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

  useEffect(() => {
    if (selectionNoteId.current !== noteId && selectedToolRef.current === 'text' && navigator.maxTouchPoints > 0) {
      selectedToolRef.current = lastWritingToolRef.current;
      setSelectedTool(lastWritingToolRef.current);
    }
    selectionNoteId.current = noteId;
    lastPick.current = null;
    editingTap.current = null;
    transformCleanupRef.current?.();
    setSelection([]);
    selectionPointerRef.current = null;
    marqueeRef.current = null;
    setMarquee(null);
    setPictureError('');
  }, [noteId, setSelection]);

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
    if (next.length !== ids.length) setSelection(next, selectedBoxesRef.current, selectedPicturesRef.current);
  }, [strokes, setSelection]);

  useEffect(() => {
    const editor = getEditor();
    if (!editor || (!selectedBoxes.length && !selectedPictures.length && !tableCell)) return;
    const remeasure = () => {
      const boxes = selectedBoxesRef.current.filter((box) => editor.contains(box));
      const pictures = selectedPicturesRef.current.filter((image) => editor.contains(image));
      if (boxes.length !== selectedBoxesRef.current.length || pictures.length !== selectedPicturesRef.current.length) {
        setSelection(selectedIdsRef.current, boxes, pictures);
      }
      setTableCell((cell) => cell && !editor.contains(cell) ? null : cell);
      setObjectSizeVersion((version) => version + 1);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure);
    [...selectedBoxes, ...selectedPictures].forEach((object) => observer?.observe(object));
    const mutations = new MutationObserver(remeasure);
    mutations.observe(editor, { childList: true, subtree: true, characterData: true });
    editor.addEventListener('load', remeasure, true);
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      editor.removeEventListener('load', remeasure, true);
    };
  }, [getEditor, selectedBoxes, selectedPictures, setSelection, tableCell]);

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
    selectionPointerRef.current = null;
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
   * (reported as Ctrl + wheel). A second finger takes over an open selection drag.
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
      } else if (touches.length === 1 && selectionPointerRef.current === null && !transformDragRef.current &&
        !(event.target as Element).closest('.ink-canvas, [data-note-editor], [data-ink-ui=selection]')) {
        // The desk outside the sheet can still scroll with one finger.
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
  const getCanvasPoint = (e: React.PointerEvent): StrokePoint => {
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
    const boxes = selectedBoxesRef.current;
    const pictures = selectedPicturesRef.current;
    if (boxes.length && !window.confirm('Delete the selected text boxes or tables?')) return;
    if (boxes.length || pictures.length) {
      [...boxes, ...pictures].forEach((object) => object.remove());
      textEditor?.current?.savePageObjects();
    }
    setSelection([]);
    if (ids.size > 0) commitStrokes(strokesRef.current.filter((stroke) => !ids.has(stroke.id)));
  }, [commitStrokes, setSelection, textEditor]);

  const changeInkGroup = (ungroup: boolean) => {
    const ids = new Set(selectedIdsRef.current);
    const groupId = ungroup ? undefined : crypto.randomUUID();
    commitStrokes(strokesRef.current.map((stroke) => ids.has(stroke.id) ? { ...stroke, groupId } : stroke));
  };

  const updateSelectedInk = (change: Partial<Pick<Stroke, 'color' | 'width'>>) => {
    const ids = new Set(selectedIdsRef.current);
    commitStrokes(strokesRef.current.map((stroke) => ids.has(stroke.id) ? { ...stroke, ...change } : stroke));
  };

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
  const beginTransform = useCallback((
    kind: TransformKind, corner: ResizeCorner | null, e: React.PointerEvent,
    click?: { tap: () => void; hold?: () => void },
  ) => {
    const bounds = selectionBoundsRef.current;
    const editor = getEditor();
    const layer = textLayerRef.current;
    if (!bounds || transformDragRef.current || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startClient = { x: e.clientX, y: e.clientY };
    const start = getPagePoint(startClient.x, startClient.y);
    const startZoom = zoomRef.current;
    const baseStrokes = strokesRef.current;
    const ids = new Set(selectedIdsRef.current);
    transformDragRef.current = true;
    const baseLayout = textBlockLayoutRef.current;
    const pictures = getPictures(selectedPicturesRef.current);
    const editorOffset = editor && layer ? offsetWithin(editor, layer) : { x: 0, y: 0 };
    const boxes = layer ? selectedBoxesRef.current.map((box) => ({
      box, placement: boxPlacement(box, layer), pagePlacement: pageBoxPlacement(box, layer, baseLayout),
      width: box.offsetWidth, previousWidth: box.style.width,
    })) : [];
    const widthBox = kind === 'width' ? boxes[0] : null;
    const neighbors = kind === 'move' ? [
      ...Array.from(inkObjects(baseStrokes).values(), (group) =>
        group.some((stroke) => ids.has(stroke.id)) ? null : getStrokesBounds(group)),
      ...getPictures().filter(({ image }) => !selectedPicturesRef.current.includes(image)).map(({ bounds }) => bounds),
      ...(layer ? getTextBoxes().filter((box) => !selectedBoxesRef.current.includes(box))
        .map((box) => measureBox(box, layer, baseLayout)) : []),
    ].filter((box): box is Bounds => !!box) : [];
    const pointerId = e.pointerId;
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const anchor = {
      x: corner === 'nw' || corner === 'sw' ? bounds.x + bounds.width : bounds.x,
      y: corner === 'nw' || corner === 'ne' ? bounds.y + bounds.height : bounds.y,
    };
    const startDistance = Math.hypot(start.x - anchor.x, start.y - anchor.y);
    let moved = false;
    let holdTimer: number | undefined;

    const computeTransform = (point: Point): InkTransform => {
      if (kind === 'move') {
        const delta = snapObjectMove(bounds, { x: point.x - start.x, y: point.y - start.y },
          neighbors, SNAP_DISTANCE / zoomRef.current);
        return { ...IDENTITY_INK_TRANSFORM, translateX: delta.x, translateY: delta.y };
      }
      if (kind === 'rotate') {
        const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
        const angle = Math.atan2(point.y - center.y, point.x - center.x);
        return { ...IDENTITY_INK_TRANSFORM, originX: center.x, originY: center.y, rotation: angle - startAngle };
      }
      const distance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
      const scale = startDistance < 1 ? 1 : Math.min(20, Math.max(0.05, distance / startDistance));
      return { ...IDENTITY_INK_TRANSFORM, originX: anchor.x, originY: anchor.y, scale };
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId || isPinchingRef.current) return;
      const dx = event.clientX - startClient.x;
      const dy = event.clientY - startClient.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      const point = { x: start.x + dx / startZoom, y: start.y + dy / startZoom };
      moved = true;
      window.clearTimeout(holdTimer);
      if (widthBox) {
        const local = pointInTextLayer(point, widthBox.pagePlacement);
        const localStart = pointInTextLayer(start, widthBox.pagePlacement);
        const limit = Math.max(widthBox.width, (editor?.clientWidth ?? 8192) - widthBox.box.offsetLeft);
        const width = Math.max(64, Math.min(8192, limit, Math.round(widthBox.width + local.x - localStart.x)));
        widthBox.box.style.width = `${width}px`;
        setObjectSizeVersion((version) => version + 1);
        return;
      }
      const transform = computeTransform(point);
      if (ids.size) previewStrokesRef.current = applyInkTransform(baseStrokes, ids, transform);
      pictures.forEach((picture) => transformPicture(picture, baseLayout, transform, false));
      boxes.forEach(({ box, placement, width }) =>
        transformBox(box, placement, editorOffset, width, baseLayout, transform, false));
      liveTransformRef.current = transform;
      setLiveTransform(transform);
      redraw();
    };

    const finish = (commit: boolean) => {
      window.clearTimeout(holdTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      transformCleanupRef.current = null;
      transformDragRef.current = false;

      if (widthBox) {
        if (commit && moved && editor?.contains(widthBox.box)) textEditor?.current?.savePageObjects();
        else widthBox.box.style.width = widthBox.previousWidth;
        setObjectSizeVersion((version) => version + 1);
        return;
      }

      const transform = liveTransformRef.current;
      const preview = previewStrokesRef.current;
      liveTransformRef.current = null;
      previewStrokesRef.current = null;
      setLiveTransform(null);
      for (const object of [...boxes.map(({ box }) => box), ...pictures.map(({ image }) => image)]) {
        object.style.translate = '';
        object.style.transform = '';
      }

      if (commit && transform && !isIdentityTransform(transform)) {
        const livePictures = pictures.filter(({ image }) => editor?.contains(image));
        const liveBoxes = boxes.filter(({ box }) => editor?.contains(box));
        livePictures.forEach((picture) => transformPicture(picture, baseLayout, transform, true));
        liveBoxes.forEach(({ box, placement, width }) =>
          transformBox(box, placement, editorOffset, width, baseLayout, transform, true));
        if (livePictures.length || liveBoxes.length) {
          textEditor?.current?.savePageObjects();
          setObjectSizeVersion((version) => version + 1);
        }
        if (preview && ids.size && strokesRef.current === baseStrokes) commitStrokes(preview);
        else redraw();
      } else {
        redraw();
      }
      if (commit && !moved) click?.tap();
      if (moved) lastPick.current = null;
    };

    const onUp = (event: PointerEvent) => { if (event.pointerId === pointerId) finish(true); };
    const onCancel = (event: PointerEvent) => { if (event.pointerId === pointerId) finish(false); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    transformCleanupRef.current = () => finish(false);
    if (click?.hold) holdTimer = window.setTimeout(() => {
      finish(false);
      lastPick.current = null;
      click.hold?.();
    }, OBJECT_HOLD_MS);
  }, [commitStrokes, getEditor, getPagePoint, getPictures, getTextBoxes, redraw, textEditor]);

  const enableText = () => {
    if (selectedToolRef.current === 'text') return;
    flushSync(() => {
      setSelection([]);
      selectedToolRef.current = 'text';
      setSelectedTool('text');
    });
  };

  const editSelectedText = (box = selectedBoxesRef.current[0], cell = tableCell) => {
    if (!box) return;
    enableText();
    setSelection([]);
    setTableCell(cell);
    textEditor?.current?.editBox(box, cell ?? undefined);
  };

  const handlePictureDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    const point = pointInEditor(getPagePoint(e.clientX, e.clientY));
    setPictureError('');
    try {
      const images = await textEditor?.current?.dropPictures(files, point);
      if (!images?.length || !images.every((image) => getEditor()?.contains(image))) return;
      textEditor?.current?.finishEditing();
      if (selectedToolRef.current === 'text') {
        selectedToolRef.current = lastWritingToolRef.current;
        setSelectedTool(lastWritingToolRef.current);
      }
      setSelection([], [], images);
    } catch (error) {
      setPictureError(error instanceof Error ? error.message : 'Could not add the pictures.');
    }
  };

  const pointInEditor = (point: Point) => {
    const editor = getEditor();
    const layer = textLayerRef.current;
    if (!editor || !layer) return point;
    const local = pointInTextLayer(point, textBlockLayoutRef.current);
    const offset = offsetWithin(editor, layer);
    return { x: local.x - offset.x, y: local.y - offset.y };
  };

  const startTextBox = (point?: Point) => {
    lastPick.current = null;
    setSelection([]);
    enableText();
    if (!point) textEditor?.current?.insertTextBox();
    else if (textEditor?.current) textEditor.current.focusAt(pointInEditor(point));
    else onFingerTap?.();
  };

  const pickObjects = (point: Point, client: Point, tolerance: number): ObjectHit[] => {
    const strokes = strokesRef.current;
    const drawings = inkObjects(strokes);
    const hits: ObjectHit[] = [];
    const seen = new Set<string>();
    const pickInk = (back: boolean) => {
      for (let i = strokes.length - 1; i >= 0; i--) {
        const stroke = strokes[i];
        if ((stroke.layer === 'back') !== back) continue;
        const key = inkObjectKey(stroke);
        if (seen.has(key) || !hitTestStroke([stroke], point, tolerance)) continue;
        const group = drawings.get(key)!;
        const bounds = getStrokesBounds(group);
        if (!bounds) continue;
        seen.add(key);
        hits.push({ key, ids: group.map(({ id }) => id), bounds });
      }
    };
    pickInk(false);
    const layer = textLayerRef.current;
    const editor = getEditor();
    if (layer && editor) {
      const layout = textBlockLayoutRef.current;
      for (const child of Array.from(editor.children).reverse()) {
        if (!(child instanceof HTMLElement)) continue;
        const picture = child instanceof HTMLImageElement ? child : undefined;
        const box = child.matches(boxSelector) ? child : undefined;
        if (!box && !picture) continue;
        const placement = pageBoxPlacement(child, layer, layout);
        const local = pointInTextLayer(point, placement);
        if (!pointInBounds(local, { x: 0, y: 0, width: child.offsetWidth, height: child.offsetHeight })) continue;
        hits.push({
          key: child, ids: [], box, picture, bounds: measureBox(child, layer, layout),
          cell: box?.matches(tableBoxSelector) ? tableCellAt(box, client) : null,
        });
      }
    }
    pickInk(true);
    return hits;
  };

  const handleSelectPointerDown = (e: React.PointerEvent, dismissedEditor: boolean) => {
    const pointerType = e.pointerType;
    selectPointerTypeRef.current = pointerType;
    const client = { x: e.clientX, y: e.clientY };
    const point = getPagePoint(client.x, client.y);
    const hits = pickObjects(point, client, (pointerType === 'touch' ? 10 : 6) / zoomRef.current);
    const dismissText = pointerType === 'touch' && !hits.length &&
      (dismissedEditor || selectedBoxesRef.current.some((box) => !box.matches(tableBoxSelector)));
    const selectedHit = hits.find(({ box, picture, ids }) =>
      (box && selectedBoxesRef.current.includes(box)) ||
      (picture && selectedPicturesRef.current.includes(picture)) ||
      (ids.length > 0 && ids.every((id) => selectedIdsRef.current.includes(id))));
    const hit = selectedHit ?? hits[0];
    const previousBounds = selectionBoundsRef.current;
    const insideFrame = previousBounds && pointInBounds(point, previousBounds);
    const selectHit = (object: ObjectHit) => {
      setSelection(object.ids, object.box ? [object.box] : [], object.picture ? [object.picture] : []);
      selectionBoundsRef.current = object.bounds;
      if (object.cell) setTableCell(object.cell);
    };

    if (!dismissText && (hit || insideFrame)) {
      // A drag started on a box moves that box. Drag the empty area inside
      // a multi-object selection frame to move the entire selection.
      if (hit && (!selectedHit || hit.box)) selectHit(hit);
      beginTransform('move', null, e, {
        tap: () => {
          if (!hits.length) {
            if (pointerType === 'touch') startTextBox(point);
            return;
          }
          const keys = hits.map(({ key }) => key);
          const previous = lastPick.current;
          const close = previous && Math.hypot(point.x - previous.point.x, point.y - previous.point.y)
            * zoomRef.current <= SELECTION_TAP_SLOP;
          const same = close && keys.length === previous.keys.length && keys.every((key, index) => key === previous.keys[index]);
          const index = same && selectedHit ? (hits.indexOf(selectedHit) + 1) % hits.length : 0;
          selectHit(hits[index]);
          lastPick.current = { point, keys };
        },
        hold: hit && (() => {
          selectHit(hit);
          if (hit.box) editSelectedText(hit.box, hit.cell ?? null);
          else setEditActions(true);
        }),
      });
      return;
    }

    lastPick.current = null;
    setSelection([]);
    const geometry: MarqueeGeometry = { mode: selectModeRef.current, start: point, end: point, points: [point] };
    selectionPointerRef.current = e.pointerId;
    selectionStartClient.current = client;
    selectionDragged.current = false;
    selectionDismissedText.current = dismissText;
    marqueeRef.current = geometry;
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

  const selectionTravel = (clientX: number, clientY: number) => {
    const start = selectionStartClient.current;
    return start ? Math.hypot(clientX - start.x, clientY - start.y) : 0;
  };

  const finalizeSelection = (clientX: number, clientY: number) => {
    const geometry = marqueeRef.current;
    selectionPointerRef.current = null;
    marqueeRef.current = null;
    setMarquee(null);
    if (!geometry) return;

    const isTap = !selectionDragged.current && selectionTravel(clientX, clientY) < SELECTION_TAP_SLOP;
    if (isTap) {
      if (!selectionDismissedText.current &&
        (selectPointerTypeRef.current === 'touch' || selectedToolRef.current === 'text')) {
        startTextBox(geometry.start);
      }
      return;
    }

    const strokes = strokesRef.current;
    const ids = new Set(selectStrokeIds(strokes, geometry));
    const groups = new Set(strokes.filter((stroke) => ids.has(stroke.id)).map(inkObjectKey));
    const layer = textLayerRef.current;
    const boxes = layer ? getTextBoxes().filter((box) =>
      marqueeSelectsTextBlock(geometry, measureBox(box, layer, textBlockLayoutRef.current))) : [];
    const pictures = getPictures().filter(({ bounds }) => marqueeSelectsTextBlock(geometry, bounds));
    setSelection(strokes.filter((stroke) => groups.has(inkObjectKey(stroke))).map(({ id }) => id),
      boxes, pictures.map(({ image }) => image));
    if (boxes.length === 1 && boxes[0].matches(tableBoxSelector)) {
      setTableCell(boxes[0].querySelector<HTMLTableCellElement>('td, th'));
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || isPinchingRef.current || transformDragRef.current || selectionPointerRef.current !== null) return;
    if (e.pointerType === 'pen' && !spenTipDownRef.current) return;
    dragSawPressureRef.current = false;
    zeroPressureSamplesRef.current = 0;

    const touch = e.pointerType === 'touch';
    const mousePicture = e.pointerType === 'mouse' && activeTool !== 'text' && activeTool !== 'select' &&
      getPictures().some(({ bounds }) => pointInBounds(getPagePoint(e.clientX, e.clientY), bounds));
    const selecting = touch || mousePicture || activeTool === 'select' || activeTool === 'text';
    if (!selecting && isStylusOnly && e.pointerType !== 'pen') return;
    if (touch && (!e.isPrimary || touchCountRef.current > 1 || isStylusActiveRef.current ||
      e.width > 40 || e.height > 40)) return;

    let dismissedEditor = false;
    if (activeTool === 'text') {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('a[download]')) return;
      const box = target?.closest<HTMLElement>(boxSelector);
      const cell = target?.closest<HTMLTableCellElement>('td, th');
      const editingTable = cell?.closest<HTMLElement>(tableBoxSelector);
      const editingBox = box && (box.hasAttribute('contenteditable') ||
        editingTable?.querySelector('[contenteditable="true"]'));
      if (editingBox && box) {
        const previous = editingTap.current;
        const time = performance.now();
        const point = { x: e.clientX, y: e.clientY };
        if (previous?.box === box && time - previous.time <= 350 &&
          Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <= 24) {
          e.preventDefault();
          editingTap.current = null;
          lastPick.current = null;
          textEditor?.current?.finishEditing(true);
          if (getEditor()?.contains(box)) {
            textEditor?.current?.savePageObjects();
            setSelection([], [box]);
            if (cell) setTableCell(cell);
          }
          return;
        }
        editingTap.current = { box, point, time };
      } else {
        editingTap.current = null;
      }
      if (cell && editingTable?.querySelector('[contenteditable="true"]')) {
        if (!cell.isContentEditable) textEditor?.current?.editBox(editingTable, cell);
        setTableCell(cell);
        return;
      }
      if (target?.closest('[contenteditable="true"]')) return;
      dismissedEditor = touch && !!getEditor()?.querySelector(
        `:scope > ${boxSelector}:not(${tableBoxSelector})[contenteditable="true"]`,
      );
      textEditor?.current?.finishEditing();
      if (dismissedEditor) textEditor?.current?.savePageObjects();
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer may have no active capture.
    }

    if (selecting) {
      e.preventDefault();
      handleSelectPointerDown(e, dismissedEditor);
      return;
    }

    if (e.pointerType === 'pen') isStylusActiveRef.current = true;
    if (selectedIdsRef.current.length || selectedPicturesRef.current.length || selectedBoxesRef.current.length) setSelection([]);

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
  const handlePointerMove = (e: React.PointerEvent) => {
    const tap = editingTap.current;
    if (tap && e.buttons && Math.hypot(e.clientX - tap.point.x, e.clientY - tap.point.y) > 24) {
      editingTap.current = null;
    }
    if (isPinchingRef.current || (e.pointerType === 'touch' && !e.isPrimary)) return;
    if (selectionPointerRef.current === e.pointerId) {
      if (selectionTravel(e.clientX, e.clientY) >= SELECTION_TAP_SLOP) selectionDragged.current = true;
      if (selectionDragged.current) {
        updateMarquee(getPagePoint(e.clientX, e.clientY));
      }
      return;
    }
    if (e.pointerType === 'touch' || transformDragRef.current || activeTool === 'select' || activeTool === 'text') return;
    if (isStylusOnly && e.pointerType !== 'pen') return;

    if (e.pointerType === 'pen' && !spenTipDownRef.current) {
      if (isStylusActiveRef.current) handlePointerUp(e);
      return;
    }
    if (e.pointerType === 'pen' && spenTipDownRef.current && !isStylusActiveRef.current) {
      handlePointerDown(e);
      return;
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
  const handlePointerUp = (e: React.PointerEvent) => {
    if (isPinchingRef.current) return;
    if (selectionPointerRef.current === e.pointerId) {
      updateMarquee(getPagePoint(e.clientX, e.clientY));
      finalizeSelection(e.clientX, e.clientY);
      return;
    }
    if (e.pointerType === 'touch' || (e.pointerType === 'pen' && spenTipDownRef.current)) return;
    if (e.pointerType === 'pen') isStylusActiveRef.current = false;
    commitActiveDrag();
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    editingTap.current = null;
    if (selectionPointerRef.current === e.pointerId) {
      selectionPointerRef.current = null;
      marqueeRef.current = null;
      setMarquee(null);
      return;
    }
    if (e.pointerType !== 'touch') handlePointerUp(e);
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
      setSelection([]);
      onRequestTextFocus?.();
    } else {
      textEditor?.current?.finishEditing();
    }
    lastPick.current = null;
    if (tool !== 'select') {
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
  const selectedDrawings = new Set(strokes.filter((stroke) => selectedIdSet.has(stroke.id)).map(inkObjectKey));
  const hasGroupedInk = strokes.some((stroke) => selectedIdSet.has(stroke.id) && stroke.groupId);
  const selectionBounds = useMemo(() => {
    const layout = textBlockLayout;
    const layer = textLayerRef.current;
    let bounds = getStrokesBounds(strokes.filter((stroke) => selectedIdSet.has(stroke.id)));
    for (const picture of getPictures(selectedPictures)) bounds = unionBounds(bounds, picture.bounds);
    if (layer) for (const box of selectedBoxes) {
      if (layer.contains(box)) bounds = unionBounds(bounds, measureBox(box, layer, layout));
    }
    return bounds;
  }, [strokes, selectedIdSet, selectedBoxes, objectSizeVersion, textBlockLayout, selectedPictures, getPictures]);
  const soleTextBox = selectedBoxes.length === 1 && !selectedIds.length && !selectedPictures.length
    && !selectedBoxes[0].matches(tableBoxSelector) ? selectedBoxes[0] : null;
  const canScale = !selectedBoxes.some((box) => box.matches(tableBoxSelector));
  const widthHandle = soleTextBox && textLayerRef.current && selectionBounds ? (() => {
    const placement = pageBoxPlacement(soleTextBox, textLayerRef.current, textBlockLayout);
    const edge = transformTextBlockPoint({ x: soleTextBox.offsetWidth, y: soleTextBox.offsetHeight / 2 }, placement);
    return { x: edge.x - selectionBounds.x, y: edge.y - selectionBounds.y };
  })() : null;
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

  const textLayerStyle: React.CSSProperties | undefined = isIdentityTextBlockLayout(textBlockLayout)
    ? undefined
    : {
        transformOrigin: '0 0',
        transform: `translate(${textBlockLayout.x}px, ${textBlockLayout.y}px) rotate(${textBlockLayout.rotation}rad) scale(${textBlockLayout.scale})`
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
      <input ref={replacementInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp"
        hidden onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          const picture = selectedPicturesRef.current[0];
          if (!file || !picture) return;
          setPictureError('');
          try {
            await textEditor?.current?.replacePicture(picture, file);
          } catch (error) {
            setPictureError(error instanceof Error ? error.message : 'Could not replace the image.');
          }
        }} />
      <div className="relative z-10 shrink-0 pointer-events-auto" data-ink-ui="toolbar-shell">
        {textEditor && onChangeBackground ? (
          <NoteRibbon
            editor={textEditor}
            textActive={activeTool === 'text'}
            enableText={enableText}
            onInsertTextBox={startTextBox}
            onInsertTable={(box) => {
              setSelection([], [box]);
              setTableCell(box.querySelector<HTMLTableCellElement>('td, th'));
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
        {tableCell && <TableToolbar cell={tableCell} onChangeCell={(cell) => {
          setTableCell(cell);
          const box = cell?.closest<HTMLElement>(tableBoxSelector);
          if (cell && box && selectedBoxesRef.current.length === 0) textEditor?.current?.editBox(box, cell);
        }} onSave={() => {
          textEditor?.current?.savePageObjects();
          setObjectSizeVersion((version) => version + 1);
        }} />}
        {pictureError && <p role="alert" className="px-4 py-1 text-sm text-rose-600 dark:text-rose-400">{pictureError}</p>}
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
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                  onContextMenu={(event) => {
                    if (!(event.target instanceof Element) || !event.target.closest('[contenteditable="true"]')) {
                      suppressCanvasMenu(event);
                    }
                  }}
                  onPointerLeave={(event) => {
                    if (activeTool !== 'select' && event.pointerType !== 'touch') handlePointerCancel(event);
                  }}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes('Files')) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(event) => void handlePictureDrop(event)}
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
                    onContextMenu={suppressCanvasMenu}
                    onAuxClick={suppressCanvasMenu}
                    className={`ink-canvas absolute inset-0 z-30 block ${activeTool === 'text' ? 'pointer-events-none' : ''}`}
                    style={{
                      cursor: activeTool === 'select' ? 'default' : 'crosshair',
                      touchAction: 'none'
                    }}
                  />

                  {marquee && (
                    <svg className="absolute inset-0 z-40 w-full h-full pointer-events-none" aria-hidden="true">
                      {renderMarquee(marquee)}
                    </svg>
                  )}

                  {selectionBounds && (
                    <SelectionOverlay
                      bounds={selectionBounds}
                      transform={liveTransform}
                      count={selectedDrawings.size}
                      boxCount={selectedBoxes.length}
                      tableSelected={selectedBoxes.length === 1 && selectedBoxes[0].matches(tableBoxSelector)}
                      pictureCount={selectedPictures.length}
                      onEditText={selectedBoxes.length === 1 ? () => editSelectedText() : undefined}
                      onStartResize={canScale && !widthHandle ? (corner, e) => beginTransform('resize', corner, e) : undefined}
                      widthHandle={widthHandle}
                      onStartWidth={(event) => beginTransform('width', null, event)}
                      onGroup={selectedDrawings.size > 1 ? () => changeInkGroup(false) : undefined}
                      onUngroup={hasGroupedInk ? () => changeInkGroup(true) : undefined}
                      onReplacePicture={editActions && selectedPictures.length === 1 ? () => replacementInput.current?.click() : undefined}
                      onInkColor={editActions && selectedIds.length ? (color) => updateSelectedInk({ color }) : undefined}
                      onInkWidth={editActions && selectedIds.length ? (width) => updateSelectedInk({ width }) : undefined}
                      inkColor={strokes.find((stroke) => selectedIdSet.has(stroke.id))?.color}
                      inkWidth={strokes.find((stroke) => selectedIdSet.has(stroke.id))?.width}
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
