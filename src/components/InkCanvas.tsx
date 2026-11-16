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
import { NoteRibbon, type RibbonSelection } from './NoteRibbon';
import type { TextEditorRef } from './TextEditor';
import {
  boxPlacement, boxSelector, measureBox, measurePicture, offsetWithin, pageBoxPlacement,
  pointInTextLayer, snapObjectMove, transformBox, transformPicture,
} from '../utils/pageObjects';
import { setTableDimension, tableBoxSelector, tableDimensions } from '../utils/noteTable';
import { TableResizeHandles, type TableResizeAxis } from './TableResizeHandles';
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
  ClipboardCopy,
  ClipboardPaste,
  Download,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCw, Pencil, Image, BringToFront, SendToBack,
  type LucideIcon
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
  keyboardOpen?: boolean;
  textEditing?: boolean;
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

type TouchTap = { pointer: number; client: Point; run: () => void; hold?: number };

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

function ribbonButton(label: string, Icon: LucideIcon, action: () => void) {
  return (
    <button type="button" className="ribbon-command" onMouseDown={(event) => event.preventDefault()} onClick={action}>
      <Icon size={16} /> {label}
    </button>
  );
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
  keyboardOpen,
  textEditing,
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

  const [selectedTool, setSelectedTool] = useState<PenTool>('text');
  const [drawRequest, setDrawRequest] = useState(0);
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
  const replacementInput = useRef<HTMLInputElement>(null);
  const stopPanMomentum = useRef<(() => void) | null>(null);
  const [hovering, setHovering] = useState(false);
  const hoverKey = useRef<ObjectHit['key'] | null>(null);
  const editingTap = useRef<{ box: HTMLElement; point: Point; time: number } | null>(null);
  const touchTap = useRef<TouchTap | null>(null);
  const [pasteMenu, setPasteMenu] = useState<{ point: Point; client: Point; noteId: string } | null>(null);
  const pasteButton = useRef<HTMLButtonElement>(null);
  const pastePending = useRef(false);
  const clearTouchTap = useCallback(() => {
    window.clearTimeout(touchTap.current?.hold);
    touchTap.current = null;
  }, []);

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

  const setSelection = useCallback((
    ids: string[], boxes: HTMLElement[] = [], pictures: HTMLImageElement[] = [], hover: ObjectHit['key'] | null = null,
  ) => {
    hoverKey.current = hover;
    setHovering(hover !== null);
    selectedPicturesRef.current = pictures;
    setSelectedPictures(pictures);
    selectedIdsRef.current = ids;
    selectedBoxesRef.current = boxes;
    setSelectedIds(ids);
    setSelectedBoxes(boxes);
    setEditActions(false);
    setTableCell(null);
  }, []);

  const selectObject = (object: ObjectHit, hover = false) => {
    setSelection(object.ids, object.box ? [object.box] : [], object.picture ? [object.picture] : [], hover ? object.key : null);
    selectionBoundsRef.current = object.bounds;
    if (object.cell) setTableCell(object.cell);
  };

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
    if (selectionNoteId.current !== noteId && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
    selectionNoteId.current = noteId;
    editingTap.current = null;
    clearTouchTap();
    setPasteMenu(null);
    transformCleanupRef.current?.();
    stopPanMomentum.current?.();
    setSelection([]);
    selectionPointerRef.current = null;
    marqueeRef.current = null;
    setMarquee(null);
    setPictureError('');
  }, [noteId, setSelection, clearTouchTap]);

  useLayoutEffect(() => {
    onToolChange?.(activeTool);
  }, [activeTool, onToolChange]);

  useEffect(() => () => {
    transformCleanupRef.current?.();
    clearTouchTap();
  }, [clearTouchTap]);

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
    const editingTable = tableCell?.closest(tableBoxSelector);
    const objects = new Set([...selectedBoxes, ...selectedPictures]);
    if (editingTable instanceof HTMLElement) objects.add(editingTable);
    objects.forEach((object) => observer?.observe(object));
    const mutations = new MutationObserver(remeasure);
    mutations.observe(editor, { childList: true, subtree: true, characterData: true });
    editor.addEventListener('load', remeasure, true);
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      editor.removeEventListener('load', remeasure, true);
    };
  }, [getEditor, selectedBoxes, selectedPictures, setSelection, tableCell]);

  const previousDefaultTool = useRef(defaultTool);
  useEffect(() => {
    if (previousDefaultTool.current === defaultTool) return;
    previousDefaultTool.current = defaultTool;
    if (defaultTool !== 'text' && defaultTool !== 'select' && defaultTool !== 'eraser') {
      lastWritingToolRef.current = defaultTool;
    }
    if (selectedToolRef.current !== 'text') setSelectedTool(defaultTool);
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
    clearTouchTap();
    editingTap.current = null;
    currentStrokeRef.current = null;
    isEraserDrawingRef.current = false;
    previewStrokesRef.current = null;
    if (transformDragRef.current) transformCleanupRef.current?.();
    if (marqueeRef.current) {
      marqueeRef.current = null;
      setMarquee(null);
    }
    redraw();
  }, [clearTouchTap, redraw]);

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
    let single: {
      id: number; start: Point; last: Point; scrolling: boolean;
      time: number; velocity: Point;
    } | null = null;
    let coastFrame = 0;
    const stopCoast = () => {
      cancelAnimationFrame(coastFrame);
      coastFrame = 0;
    };
    stopPanMomentum.current = stopCoast;

    const coast = (velocity: Point) => {
      let { x, y } = velocity;
      let left = node.scrollLeft;
      let top = node.scrollTop;
      let previousTime = performance.now();
      const step = (time: number) => {
        if (isStylusActiveRef.current || spenTipDownRef.current) return;
        const elapsed = Math.min(32, Math.max(0, time - previousTime));
        previousTime = time;
        const decay = Math.exp(-elapsed / 180);
        const distanceFactor = 180 * (1 - decay);
        left += x * distanceFactor;
        top += y * distanceFactor;
        const maxLeft = node.scrollWidth - node.clientWidth;
        const maxTop = node.scrollHeight - node.clientHeight;
        x = left <= 0 || left >= maxLeft ? 0 : x * decay;
        y = top <= 0 || top >= maxTop ? 0 : y * decay;
        left = Math.max(0, Math.min(maxLeft, left));
        top = Math.max(0, Math.min(maxTop, top));
        node.scrollTo(left, top);
        if (Math.hypot(x, y) >= 0.025) coastFrame = requestAnimationFrame(step);
      };
      if (Math.hypot(x, y) >= 0.06) coastFrame = requestAnimationFrame(step);
    };

    const touchesInViewport = (event: TouchEvent) =>
      Array.from(event.touches).filter((touch) =>
        (touch as Touch & { touchType?: string }).touchType !== 'stylus' && node.contains(touch.target as Node));

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
      stopCoast();
      const touches = touchesInViewport(event);
      updateGesture(touches);
      if (isPinchingRef.current) {
        event.preventDefault();
      } else if (touches.length === 1 && !transformDragRef.current &&
        !isStylusActiveRef.current && !spenTipDownRef.current &&
        !findInkUiControl(event.target)) {
        const [touch] = touches;
        const point = { x: touch.clientX, y: touch.clientY };
        single = { id: touch.identifier, start: point, last: point, scrolling: false,
          time: performance.now(), velocity: { x: 0, y: 0 } };
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      const touches = touchesInViewport(event);
      updateGesture(touches);
      if (!isPinchingRef.current) {
        if (transformDragRef.current) {
          event.preventDefault();
          return;
        }
        if (!single || isStylusActiveRef.current || spenTipDownRef.current) return;
        const touch = touches.find(({ identifier }) => identifier === single?.id);
        if (!touch) return;
        const point = { x: touch.clientX, y: touch.clientY };
        if (!single.scrolling && Math.hypot(point.x - single.start.x, point.y - single.start.y) < SELECTION_TAP_SLOP) return;
        event.preventDefault();
        clearTouchTap();
        editingTap.current = null;
        const now = performance.now();
        const elapsed = Math.max(8, now - single.time);
        const left = node.scrollLeft;
        const top = node.scrollTop;
        pan(single.last, point);
        const weight = single.scrolling && elapsed < 85 ? 0.65 : 1;
        const speed = (distance: number, previous: number) =>
          distance === 0 ? 0 : Math.max(-3, Math.min(3, previous * (1 - weight) + weight * distance / elapsed));
        single.velocity = {
          x: speed(node.scrollLeft - left, single.velocity.x),
          y: speed(node.scrollTop - top, single.velocity.y),
        };
        single.scrolling = true;
        single.time = now;
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
      if (single && !touches.some(({ identifier }) => identifier === single?.id)) {
        const idle = performance.now() - single.time;
        if (event.type === 'touchend' && touches.length === 0 && single.scrolling && idle < 90) {
          const factor = Math.exp(-idle / 75);
          coast({ x: single.velocity.x * factor, y: single.velocity.y * factor });
        }
        single = null;
      }
      if (touches.length < 2) gesture = null;
      // Suppress ink until both fingers from the gesture are off the page.
      if (touches.length === 0) isPinchingRef.current = false;
    };

    // Desktop pinch arrives as a ctrl/meta wheel gesture from the trackpad.
    const onWheel = (event: WheelEvent) => {
      stopCoast();
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
    node.addEventListener('pointerdown', stopCoast, true);

    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchEnd);
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('pointerdown', stopCoast, true);
      stopCoast();
      stopPanMomentum.current = null;
    };
  }, [abortActiveCanvasDrag, applyZoom, clearTouchTap]);

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
    const editor = getEditor();
    const layer = textLayerRef.current;
    const baseLayout = textBlockLayoutRef.current;
    const bounds = selectionBoundsRef.current;
    if (!bounds || transformDragRef.current || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startClient = { x: e.clientX, y: e.clientY };
    const start = getPagePoint(startClient.x, startClient.y);
    const startZoom = zoomRef.current;
    const baseStrokes = strokesRef.current;
    const ids = new Set(selectedIdsRef.current);
    transformDragRef.current = true;
    const pictures = getPictures(selectedPicturesRef.current);
    const editorOffset = editor && layer ? offsetWithin(editor, layer) : { x: 0, y: 0 };
    const boxes = layer ? selectedBoxesRef.current.map((box) => ({
      box, placement: boxPlacement(box, layer), pagePlacement: pageBoxPlacement(box, layer, baseLayout),
      width: box.offsetWidth, height: box.offsetHeight,
      previousWidth: box.style.width, previousHeight: box.style.minHeight,
      previousLeft: box.style.left, previousTop: box.style.top,
    })) : [];
    const resizeBox = kind === 'width' || (kind === 'resize' && boxes.length === 1 && !ids.size && !pictures.length &&
      !boxes[0].box.matches(tableBoxSelector)) ? boxes[0] : null;
    const resizeLeft = corner === 'nw' || corner === 'sw';
    const resizeTop = corner === 'nw' || corner === 'ne';
    const getNeighbors = () => [
      ...Array.from(inkObjects(baseStrokes).values(), (group) =>
        group.some((stroke) => ids.has(stroke.id)) ? null : getStrokesBounds(group)),
      ...getPictures().filter(({ image }) => !pictures.some((picture) => picture.image === image)).map(({ bounds }) => bounds),
      ...(layer ? getTextBoxes().filter((box) => !boxes.some((moving) => moving.box === box))
        .map((box) => measureBox(box, layer, baseLayout)) : []),
    ].filter((box): box is Bounds => !!box);
    let neighbors: Bounds[] | undefined;
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
          neighbors ??= getNeighbors(), SNAP_DISTANCE / zoomRef.current);
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
      event.preventDefault();
      const point = { x: start.x + dx / startZoom, y: start.y + dy / startZoom };
      moved = true;
      window.clearTimeout(holdTimer);
      if (resizeBox) {
        const { box, placement, pagePlacement, width, height } = resizeBox;
        const local = pointInTextLayer(point, pagePlacement);
        const localStart = pointInTextLayer(start, pagePlacement);
        const dx = local.x - localStart.x;
        const limit = kind === 'width' ? (editor?.clientWidth ?? 8192) - box.offsetLeft : 8192;
        const nextWidth = Math.max(48, Math.min(8192, Math.max(width, limit), Math.round(width + (resizeLeft ? -dx : dx))));
        box.style.width = `${nextWidth}px`;
        if (corner) {
          const dy = local.y - localStart.y;
          box.style.minHeight = `${Math.max(24, Math.min(8192, Math.round(height + (resizeTop ? -dy : dy))))}px`;
          const fixedCorner = transformTextBlockPoint({
            x: resizeLeft ? width - box.offsetWidth : 0,
            y: resizeTop ? height - box.offsetHeight : 0,
          }, placement);
          box.style.left = `${Math.round(fixedCorner.x - editorOffset.x)}px`;
          box.style.top = `${Math.round(fixedCorner.y - editorOffset.y)}px`;
        }
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

      if (resizeBox) {
        const { box, previousWidth, previousHeight, previousLeft, previousTop } = resizeBox;
        if (commit && moved && editor?.contains(box)) textEditor?.current?.savePageObjects();
        else {
          box.style.width = previousWidth;
          box.style.minHeight = previousHeight;
          box.style.left = previousLeft;
          box.style.top = previousTop;
        }
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
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (moved) onMove(event);
      finish(true);
    };
    const onCancel = (event: PointerEvent) => { if (event.pointerId === pointerId) finish(false); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    transformCleanupRef.current = () => finish(false);
    if (click?.hold) holdTimer = window.setTimeout(() => {
      finish(false);
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

  const placePictures = async (files: File[], point: Point, pageId = noteId) => {
    if (selectionNoteId.current !== pageId) return;
    setPictureError('');
    try {
      const images = await textEditor?.current?.dropPictures(files, pointInEditor(point));
      if (selectionNoteId.current !== pageId || !images?.length || !images.every((image) => getEditor()?.contains(image))) return;
      textEditor?.current?.finishEditing();
      setSelection([], [], images);
    } catch (error) {
      if (selectionNoteId.current === pageId) setPictureError(error instanceof Error ? error.message : 'Could not add the pictures.');
    }
  };

  const handlePictureDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((file) => file.type.startsWith('image/'));
    if (files.length) void placePictures(files, getPagePoint(e.clientX, e.clientY));
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
    const nearby: ObjectHit[] = [];
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
        const { offsetWidth: width, offsetHeight: height } = child;
        if (!width || !height) continue;
        const exact = pointInBounds(local, { x: 0, y: 0, width, height });
        const padding = tolerance / placement.scale;
        if (!exact && !pointInBounds(local, { x: -padding, y: -padding, width: width + 2 * padding, height: height + 2 * padding })) continue;
        (exact ? hits : nearby).push({
          key: child, ids: [], box, picture, bounds: measureBox(child, layer, layout),
          cell: box?.matches(tableBoxSelector) ? tableCellAt(box, client) : null,
        });
      }
    }
    pickInk(true);
    return hits.length ? hits : nearby;
  };

  const isSelectedObject = ({ box, picture, ids }: ObjectHit) =>
    !hoverKey.current && (
      (box && selectedBoxesRef.current.includes(box)) ||
      (picture && selectedPicturesRef.current.includes(picture)) ||
      (ids.length > 0 && ids.every((id) => selectedIdsRef.current.includes(id))));

  const beginObjectMove = (e: React.PointerEvent, hit: ObjectHit | undefined) => {
    const selected = hit && isSelectedObject(hit);
    const mouse = e.pointerType === 'mouse';
    // A mouse hover exposes the same handles without pinning a selection.
    if (hit && !selected) selectObject(hit, mouse);
    beginTransform('move', null, e, {
      tap: () => {
        if (selected) setSelection([]);
        else if (mouse && hit && selectedToolRef.current === 'select') selectObject(hit);
      },
      hold: !mouse && hit ? () => {
        selectObject(hit);
        if (hit.box) editSelectedText(hit.box, hit.cell ?? null);
        else setEditActions(true);
      } : undefined,
    });
  };

  const handleHover = (e: React.PointerEvent) => {
    if (transformDragRef.current || e.buttons || pasteMenu) return;
    if (!hoverKey.current && (selectedIdsRef.current.length || selectedBoxesRef.current.length || selectedPicturesRef.current.length)) return;
    const target = e.target as Element;
    if (target.closest('[data-ink-ui="selection"], .table-resize-handle')) return;
    const client = { x: e.clientX, y: e.clientY };
    const point = getPagePoint(client.x, client.y);
    if (target.closest('[contenteditable="true"]')) {
      if (hoverKey.current) setSelection([]);
      return;
    }
    const hit = pickObjects(point, client, 4 / zoomRef.current)[0];
    if (hit) {
      if (hoverKey.current !== hit.key) selectObject(hit, true);
    } else if (hoverKey.current && (!selectionBoundsRef.current || !pointInBounds(point, selectionBoundsRef.current))) {
      setSelection([]);
    }
  };

  const startMarquee = (e: React.PointerEvent, point: Point, client: Point) => {
    setSelection([]);
    const geometry: MarqueeGeometry = { mode: selectModeRef.current, start: point, end: point, points: [point] };
    selectionPointerRef.current = e.pointerId;
    selectionStartClient.current = client;
    selectionDragged.current = false;
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
      if (selectedToolRef.current === 'text') startTextBox(geometry.start);
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

  const openPasteMenu = (point: Point, client: Point) => {
    clearTouchTap();
    setPictureError('');
    if (hoverKey.current) setSelection([]);
    setPasteMenu({ point, client, noteId });
  };

  useEffect(() => {
    if (!pasteMenu) return;
    pasteButton.current?.focus({ preventScroll: true });
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !pasteButton.current?.contains(event.target)) setPasteMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPasteMenu(null);
    };
    const closeOnScroll = () => setPasteMenu(null);
    const viewport = scrollRef.current;
    window.addEventListener('pointerdown', closeOutside, true);
    window.addEventListener('keydown', closeOnEscape);
    viewport?.addEventListener('scroll', closeOnScroll);
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true);
      window.removeEventListener('keydown', closeOnEscape);
      viewport?.removeEventListener('scroll', closeOnScroll);
    };
  }, [pasteMenu]);

  const pasteImage = async () => {
    if (!pasteMenu || pastePending.current) return;
    const { point, noteId: pageId } = pasteMenu;
    pastePending.current = true;
    try {
      if (!navigator.clipboard?.read) throw new Error('Use your device’s Paste command to paste a copied image.');
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const type = item.types.find((mime) => /^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(mime));
        if (type) files.push(new File([await item.getType(type)], 'Clipboard image', { type }));
      }
      if (!files.length) throw new Error('Copy an image before pasting.');
      if (selectionNoteId.current === pageId) {
        setPasteMenu((current) => current === pasteMenu ? null : current);
        await placePictures(files, point, pageId);
      }
    } catch (error) {
      if (selectionNoteId.current === pageId) setPictureError(error instanceof DOMException
        ? 'Clipboard access was blocked. Use your device’s Paste command.'
        : error instanceof Error ? error.message : 'Could not read the clipboard.');
    } finally {
      pastePending.current = false;
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (isInkUiTarget(target) || target.closest('[contenteditable="true"]')) return;
    e.preventDefault();
    const client = { x: e.clientX, y: e.clientY };
    const point = getPagePoint(client.x, client.y);
    if ((e.nativeEvent as PointerEvent).pointerType === 'pen') return;
    if (textEditor && !pickObjects(point, client, 4 / zoomRef.current).length) openPasteMenu(point, client);
  };

  const handleTouchDown = (e: React.PointerEvent, point: Point, client: Point, target: Element) => {
    const editor = getEditor();
    const editing = editor?.querySelector('[contenteditable="true"]');
    const activeBox = editing?.closest<HTMLElement>(boxSelector);
    const editingBox = activeBox && target.closest(boxSelector) === activeBox ? activeBox : null;
    const cell = target.closest<HTMLTableCellElement>('td, th');
    const hits = editingBox ? [] : pickObjects(point, client, 10 / zoomRef.current);
    const hit = hits.find(isSelectedObject) ?? hits[0];
    if (hit && !editing) {
      beginObjectMove(e, hit);
      return;
    }

    clearTouchTap();
    const tap: TouchTap = {
      pointer: e.pointerId, client, run: () => {
        if (editingBox) {
          const previous = editingTap.current;
          const time = performance.now();
          if (previous?.box === editingBox && time - previous.time <= 350 &&
            Math.hypot(client.x - previous.point.x, client.y - previous.point.y) <= 24) {
            editingTap.current = null;
            textEditor?.current?.finishEditing(true);
            textEditor?.current?.savePageObjects();
            setSelection([], [editingBox]);
            if (cell) setTableCell(cell);
          } else {
            editingTap.current = { box: editingBox, point: client, time };
            if (cell && !cell.isContentEditable) textEditor?.current?.editBox(editingBox, cell);
          }
          return;
        }
        editingTap.current = null;
        const hadSelection = !hoverKey.current &&
          !!(selectedBoxesRef.current.length || selectedPicturesRef.current.length || selectedIdsRef.current.length);
        if (editing) {
          textEditor?.current?.finishEditing();
          textEditor?.current?.savePageObjects();
        }
        if (hit) selectObject(hit);
        else if (hadSelection || editing || selectedToolRef.current === 'select') setSelection([]);
        else startTextBox(point);
      },
    };
    if (!editingBox) {
      e.preventDefault();
      if (textEditor && !hit) tap.hold = window.setTimeout(() => openPasteMenu(point, client), OBJECT_HOLD_MS);
    }
    touchTap.current = tap;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || isPinchingRef.current || transformDragRef.current || selectionPointerRef.current !== null) return;
    const pen = e.pointerType === 'pen';
    if (pen && !spenTipDownRef.current) return;
    const target = e.target as Element;
    if (isInkUiTarget(target) || (!pen && target.closest('a[download]'))) return;

    const client = { x: e.clientX, y: e.clientY };
    const point = getPagePoint(client.x, client.y);
    if (e.pointerType === 'touch') {
      if (e.isPrimary && touchCountRef.current < 2 && !isStylusActiveRef.current && !spenTipDownRef.current) {
        handleTouchDown(e, point, client, target);
      }
      return;
    }

    if (pen && selectedToolRef.current === 'text') {
      textEditor?.current?.finishEditing();
      selectedToolRef.current = lastWritingToolRef.current;
      setSelectedTool(lastWritingToolRef.current);
      setDrawRequest((request) => request + 1);
    }
    if (!pen && selectedToolRef.current === 'text') {
      if (target.closest('[contenteditable="true"]')) return;
      const cell = target.closest<HTMLTableCellElement>('td, th');
      const table = cell?.closest<HTMLElement>(tableBoxSelector);
      if (cell && table?.querySelector('[contenteditable="true"]')) {
        textEditor?.current?.editBox(table, cell);
        setTableCell(cell);
        return;
      }
      editingTap.current = null;
      textEditor?.current?.finishEditing();
    }

    const selecting = !isSpenEraserArmedRef.current &&
      (selectedToolRef.current === 'select' || selectedToolRef.current === 'text');
    const hits = selecting || !pen ? pickObjects(point, client, 6 / zoomRef.current) : [];
    const hit = hits.find(isSelectedObject) ?? hits[0];
    const withinFrame = selectionBoundsRef.current && pointInBounds(point, selectionBoundsRef.current);
    if (!selecting && !hit && isStylusOnly && !pen) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer may have no active capture.
    }

    if (hit || ((selecting || !pen) && withinFrame)) {
      beginObjectMove(e, hit);
      return;
    }
    if (selecting) {
      e.preventDefault();
      startMarquee(e, point, client);
      return;
    }

    dragSawPressureRef.current = false;
    zeroPressureSamplesRef.current = 0;
    if (pen) isStylusActiveRef.current = true;
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
    if (e.pointerType === 'touch') {
      const tap = touchTap.current;
      if (tap?.pointer === e.pointerId && Math.hypot(e.clientX - tap.client.x, e.clientY - tap.client.y) >= SELECTION_TAP_SLOP) {
        clearTouchTap();
        editingTap.current = null;
      }
      return;
    }
    if (isPinchingRef.current) return;
    if (selectionPointerRef.current === e.pointerId) {
      if (selectionTravel(e.clientX, e.clientY) >= SELECTION_TAP_SLOP) selectionDragged.current = true;
      if (selectionDragged.current) {
        updateMarquee(getPagePoint(e.clientX, e.clientY));
      }
      return;
    }
    if (e.pointerType === 'mouse' && !e.buttons) handleHover(e);
    if (transformDragRef.current || activeTool === 'select' || activeTool === 'text') return;
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
    if (e.pointerType === 'touch') {
      const tap = touchTap.current;
      if (tap?.pointer === e.pointerId) {
        clearTouchTap();
        if (Math.hypot(e.clientX - tap.client.x, e.clientY - tap.client.y) < SELECTION_TAP_SLOP) tap.run();
      }
      return;
    }
    if (selectionPointerRef.current === e.pointerId) {
      updateMarquee(getPagePoint(e.clientX, e.clientY));
      finalizeSelection(e.clientX, e.clientY);
      return;
    }
    if (e.pointerType === 'pen' && spenTipDownRef.current) return;
    if (e.pointerType === 'pen') isStylusActiveRef.current = false;
    commitActiveDrag();
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    editingTap.current = null;
    if (touchTap.current?.pointer === e.pointerId) clearTouchTap();
    if (selectionPointerRef.current === e.pointerId) {
      selectionPointerRef.current = null;
      marqueeRef.current = null;
      setMarquee(null);
      return;
    }
    if (e.pointerType !== 'touch') handlePointerUp(e);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (isInkUiTarget(target) || target.closest('[contenteditable="true"], a[download]')) return;
    const client = { x: e.clientX, y: e.clientY };
    const hit = pickObjects(getPagePoint(client.x, client.y), client, 0).find(({ box }) => box);
    if (hit?.box) {
      e.preventDefault();
      editSelectedText(hit.box, hit.cell ?? null);
    }
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
    if (hoverKey.current) setSelection([]);
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
  const selectedTable = tableCell?.closest('table');
  const tableBox = selectedTable?.closest<HTMLElement>(tableBoxSelector);
  const layer = textLayerRef.current;
  const tablePlacement = tableBox && layer ? pageBoxPlacement(tableBox, layer, textBlockLayout) : null;
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

  const saveObjects = () => {
    textEditor?.current?.savePageObjects();
    setObjectSizeVersion((version) => version + 1);
  };

  const beginTableResize = (
    event: React.PointerEvent, cell: HTMLTableCellElement, axis: TableResizeAxis,
  ) => {
    if (!selectedTable || !tablePlacement || transformDragRef.current || isPinchingRef.current ||
        event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    const pointer = event.pointerId;
    const row = cell.parentElement as HTMLTableRowElement;
    const target = axis === 'row' ? row
      : selectedTable.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col')[cell.cellIndex];
    if (!target) return;
    const startSize = axis === 'row' ? row.offsetHeight : cell.offsetWidth;
    const previousStyle = axis === 'row' ? target.style.height : target.style.width;
    const previousTableWidth = selectedTable.style.width;
    const start = { x: event.clientX, y: event.clientY };
    const scale = zoomRef.current * tablePlacement.scale;
    const { rotation } = tablePlacement;
    let changed = false;
    transformDragRef.current = true;

    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      const { x, y } = pointInTextLayer({ x: next.clientX, y: next.clientY }, { ...start, scale, rotation });
      const delta = axis === 'column' ? x : y;
      if (!changed && Math.abs(delta) < 1) return;
      changed = true;
      setTableDimension(selectedTable, cell, axis, startSize + delta);
      setObjectSizeVersion((version) => version + 1);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', blur);
      transformCleanupRef.current = null;
      transformDragRef.current = false;
      if (!changed) return;
      if (commit && getEditor()?.contains(cell)) saveObjects();
      else {
        if (axis === 'row') target.style.height = previousStyle;
        else {
          target.style.width = previousStyle;
          selectedTable.style.width = previousTableWidth;
        }
        setObjectSizeVersion((version) => version + 1);
      }
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      if (changed) move(next);
      finish(true);
    };
    const cancel = (next: PointerEvent) => { if (next.pointerId === pointer) finish(false); };
    const blur = () => finish(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', blur);
    transformCleanupRef.current = blur;
  };

  const picture = selectedPictures.length === 1 && !selectedBoxes.length && !selectedIds.length
    ? selectedPictures[0] : null;
  const widthObject = picture ?? soleTextBox;
  const selectedStroke = strokes.find((stroke) => selectedIdSet.has(stroke.id));
  const hasSelection = selectedIds.length > 0 || selectedBoxes.length > 0 || selectedPictures.length > 0;
  const useRibbon = !!textEditor && !!onChangeBackground;
  const pasteViewport = pasteMenu && scrollRef.current?.getBoundingClientRect();
  const tableTools = tableCell && selectedTable && (
    <TableToolbar cell={tableCell} onChangeCell={(cell) => {
      setTableCell(cell);
      if (cell && tableBox && selectedBoxesRef.current.length === 0) textEditor?.current?.editBox(tableBox, cell);
    }} onSave={saveObjects} />
  );
  const selectionTools: RibbonSelection | undefined = tableTools && tableBox && !selectedIds.length && !selectedPictures.length && selectedBoxes.length <= 1
    ? {
        tab: 'Table Tools', target: tableBox, tools: <div className="ribbon-context-tools">
          {tableTools}
          {selectedBoxes.length === 1 && <div className="ribbon-selection-tools">
            {ribbonButton('Edit table', Pencil, () => editSelectedText())}
            {ribbonButton('Delete table', Trash2, deleteSelection)}
          </div>}
        </div>,
      }
    : hasSelection ? {
        tab: picture ? 'Picture Tools' : soleTextBox ? 'Text Box Tools'
          : selectedStroke && !selectedBoxes.length && !selectedPictures.length ? 'Ink Tools' : 'Selection Tools',
        target: selectedBoxes[0] ?? selectedPictures[0] ?? selectedIds.join(','),
        tools: <div className="ribbon-selection-tools">
          {tableTools}
          {picture && ribbonButton('Replace picture', Image, () => replacementInput.current?.click())}
          {soleTextBox && ribbonButton('Edit text', Pencil, () => editSelectedText())}
          {soleTextBox && Array.from(soleTextBox.querySelectorAll<HTMLAnchorElement>('a[download]'), (link, index) =>
            <a className="ribbon-command" key={index} href={link.href} download={link.download}>
              <Download size={16} /> {link.download || 'Download PDF'}
            </a>)}
          {widthObject && <form key={widthObject.offsetWidth} onSubmit={(event) => {
              event.preventDefault();
              const width = Number(new FormData(event.currentTarget).get('width'));
              widthObject.style.width = `${width}px`;
              saveObjects();
            }}>
              <label>Width <input name="width" type="number" min={picture ? 1 : 48} max={8192}
                defaultValue={widthObject.offsetWidth || (picture ? 1 : 48)} required /></label>
              <button type="submit" className="ribbon-command">Apply width</button>
            </form>}
          {picture && ribbonButton('Rotate 90°', RotateCw, () => {
            const measured = getPictures([picture])[0];
            if (!measured) return;
            const { x, y, width, height } = measured.bounds;
            transformPicture(measured, textBlockLayout, { ...IDENTITY_INK_TRANSFORM,
              originX: x + width / 2, originY: y + height / 2, rotation: Math.PI / 2 }, true);
            saveObjects();
          })}
          {selectedStroke && <>
            <label>Ink color <input type="color" aria-label="Ink color"
              value={/^#[0-9a-f]{6}$/i.test(selectedStroke.color) ? selectedStroke.color : '#1e293b'}
              onChange={(event) => updateSelectedInk({ color: event.target.value })} /></label>
            <form onSubmit={(event) => {
              event.preventDefault();
              updateSelectedInk({ width: Number(new FormData(event.currentTarget).get('width')) });
            }}>
              <label>Ink width <input name="width" type="number" min={1} max={120}
                key={selectedStroke.id} defaultValue={Math.round(selectedStroke.width)} required /></label>
              <button type="submit" className="ribbon-command">Apply ink width</button>
            </form>
            {selectedDrawings.size > 1 && <button type="button" className="ribbon-command" onClick={() => changeInkGroup(false)}>Group ink</button>}
            {hasGroupedInk && <button type="button" className="ribbon-command" onClick={() => changeInkGroup(true)}>Ungroup ink</button>}
            {ribbonButton('Bring to front', BringToFront, bringSelectionToFront)}
            {ribbonButton('Send to back', SendToBack, sendSelectionToBack)}
          </>}
          {ribbonButton('Delete selection', Trash2, deleteSelection)}
        </div>,
      } : undefined;

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
    <div className="flex flex-col w-full h-full min-h-0 flex-1 relative select-none">
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
            drawRequest={drawRequest}
            orientation={pageLayout}
            background={background}
            onOrientationChange={changePageLayout}
            onBackgroundChange={onChangeBackground}
            selection={hovering ? undefined : selectionTools}
            keyboardOpen={keyboardOpen}
            textEditing={textEditing}
          />
        ) : (
          <div className="flex justify-center items-center gap-2 px-4 py-2">{drawingTools}</div>
        )}
        {!useRibbon && tableTools}
        {pictureError && <p role="alert" className="px-4 py-1 text-sm text-rose-600 dark:text-rose-400">{pictureError}</p>}
      </div>

      {/* The note page: an A4 sheet floating on the desk. Ruling, back ink,
          typed text and front ink all live on the one paper surface. */}
      <div className="relative flex-1 min-h-0 z-0">
        <div
          ref={scrollRef}
          className="note-desk absolute inset-0 overflow-auto"
          data-ink-ui="page-viewport"
          onScroll={() => {
            if (hoverKey.current && !transformDragRef.current) setSelection([]);
          }}
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
                  onContextMenu={handleContextMenu}
                  onDoubleClick={handleDoubleClick}
                  onPointerLeave={(event) => {
                    if (event.pointerType === 'mouse' && hoverKey.current && !transformDragRef.current) setSelection([]);
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
                      hovering={hovering}
                      count={selectedDrawings.size}
                      boxCount={selectedBoxes.length}
                      tableSelected={selectedBoxes.length === 1 && selectedBoxes[0].matches(tableBoxSelector)}
                      pictureCount={selectedPictures.length}
                      onEditText={selectedBoxes.length === 1 ? () => editSelectedText() : undefined}
                      onStartResize={canScale ? (corner, e) => beginTransform('resize', corner, e) : undefined}
                      widthHandle={widthHandle}
                      onStartWidth={(event) => beginTransform('width', null, event)}
                      onGroup={selectedDrawings.size > 1 ? () => changeInkGroup(false) : undefined}
                      onUngroup={hasGroupedInk ? () => changeInkGroup(true) : undefined}
                      onReplacePicture={!useRibbon && editActions && selectedPictures.length === 1 ? () => replacementInput.current?.click() : undefined}
                      onInkColor={!useRibbon && editActions && selectedIds.length ? (color) => updateSelectedInk({ color }) : undefined}
                      onInkWidth={!useRibbon && editActions && selectedIds.length ? (width) => updateSelectedInk({ width }) : undefined}
                      inkColor={selectedStroke?.color}
                      inkWidth={selectedStroke?.width}
                      onStartRotate={(e) => beginTransform('rotate', null, e)}
                      onBringToFront={bringSelectionToFront}
                      onSendToBack={sendSelectionToBack}
                      onDelete={deleteSelection}
                    />
                  )}
                  {selectedTable && tableBox && tablePlacement && !liveTransform && (
                    <TableResizeHandles table={selectedTable} box={tableBox} placement={tablePlacement}
                      onStart={beginTableResize}
                      onStep={(cell, axis, delta) => {
                        const size = tableDimensions(selectedTable, cell);
                        setTableDimension(selectedTable, cell, axis, (axis === 'column' ? size.width : size.height) + delta);
                        saveObjects();
                      }} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {pasteMenu && pasteViewport && (
          <button
            ref={pasteButton}
            type="button"
            className="absolute z-50 flex items-center gap-2 rounded-lg border border-surface-subtle-light bg-surface-light px-3 py-2 text-sm text-ink-light shadow-floating dark:border-surface-subtle-dark dark:bg-surface-dark dark:text-ink-dark"
            data-ink-ui="paste-image"
            style={{
              left: Math.max(4, Math.min(pasteMenu.client.x - pasteViewport.left, pasteViewport.width - 148)),
              top: Math.max(4, Math.min(pasteMenu.client.y - pasteViewport.top + 10, pasteViewport.height - 48)),
            }}
            onClick={() => void pasteImage()}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
              if (!files.length) return;
              event.preventDefault();
              setPasteMenu(null);
              void placePictures(files, pasteMenu.point, pasteMenu.noteId);
            }}
          >
            <ClipboardPaste size={16} /> Paste image
          </button>
        )}

        {/* Overlays that stay put while the page scrolls. */}
        <div className="pointer-events-none absolute inset-0 z-40">
        <div className="pointer-events-auto absolute bottom-4 left-4 z-10 flex flex-col items-start gap-1" data-ink-ui="stylus-status">
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
