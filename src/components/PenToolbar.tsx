import React, { useEffect, useRef, useState } from 'react';
import {
  Pen,
  Feather,
  Highlighter,
  Eraser,
  ChevronDown,
  Ellipsis,
  Undo2,
  Redo2,
  Trash2,
  Wand2,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Circle,
  ClipboardCopy,
  Square,
  Type,
  MousePointer2,
  Lasso
} from 'lucide-react';
import { PenTool, EraserMode, SelectMode } from '../types/note';

export const INK_PALETTE = [
  { name: 'Pure White (Dark Mode)', hex: '#ffffff' },
  { name: 'Platinum', hex: '#e2e8f0' },
  { name: 'Charcoal', hex: '#1e293b' },
  { name: 'Pure Black', hex: '#000000' },
  { name: 'Ocean Blue', hex: '#2563eb' },
  { name: 'Midnight Navy', hex: '#1e3a8a' },
  { name: 'Emerald', hex: '#059669' },
  { name: 'Crimson', hex: '#dc2626' },
  { name: 'Violet', hex: '#7c3aed' },
  { name: 'Amber', hex: '#d97706' },
];

export const HIGHLIGHTER_PALETTE = [
  { name: 'Pastel Yellow', hex: '#fef08a' },
  { name: 'Pastel Green', hex: '#86efac' },
  { name: 'Pastel Blue', hex: '#93c5fd' },
  { name: 'Pastel Purple', hex: '#d8b4fe' },
  { name: 'Pastel Pink', hex: '#f472b6' },
  { name: 'Pastel Orange', hex: '#fdba74' },
];

interface PenToolbarProps {
  phone?: boolean;
  activeTool: PenTool;
  onSelectTool: (tool: PenTool) => void;
  color: string;
  onChangeColor: (color: string) => void;
  width: number;
  onChangeWidth: (width: number) => void;
  eraserWidth?: number;
  onChangeEraserWidth?: (width: number) => void;
  eraserMode?: EraserMode;
  onChangeEraserMode?: (mode: EraserMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onScribbleToText: () => void;
  hasStrokes: boolean;
  isStylusOnly: boolean;
  onToggleStylusOnly: () => void;
  onOpenSPenMenu?: () => void;
  onToggleSPenLog?: () => void;
  lastWritingTool?: PenTool;
  selectMode?: SelectMode;
  onChangeSelectMode?: (mode: SelectMode) => void;
}

/** Which dropdown is currently open. Only one panel is ever visible at a time. */
type ToolbarMenu = 'tool' | 'color' | 'size' | null;

const TOOL_OPTIONS: {
  id: PenTool;
  label: string;
  hint: string;
  icon: React.ReactNode;
  accent: string;
}[] = [
  {
    id: 'text',
    label: 'Text',
    hint: 'Create or edit a text box',
    icon: <Type className="w-4 h-4" />,
    accent: 'bg-violet-600 text-white shadow-md'
  },
  {
    id: 'select',
    label: 'Select',
    hint: 'Tap or drag to pick up objects',
    icon: <MousePointer2 className="w-4 h-4" />,
    accent: 'bg-violet-600 text-white shadow-md'
  },
  {
    id: 'fountain',
    label: 'Fountain pen',
    hint: 'Calligraphic, pressure sensitive',
    icon: <Feather className="w-4 h-4" />,
    accent: 'bg-violet-600 text-white shadow-md'
  },
  {
    id: 'pen',
    label: 'Ballpoint pen',
    hint: 'Smooth, consistent line',
    icon: <Pen className="w-4 h-4" />,
    accent: 'bg-violet-600 text-white shadow-md'
  },
  {
    id: 'highlighter',
    label: 'Highlighter',
    hint: 'Translucent marker',
    icon: <Highlighter className="w-4 h-4" />,
    accent: 'bg-amber-500 text-white shadow-md'
  },
  {
    id: 'eraser',
    label: 'Eraser',
    hint: 'Object or pixel erase',
    icon: <Eraser className="w-4 h-4" />,
    accent: 'bg-rose-500 text-white shadow-md'
  }
];

const SELECT_MODES: { id: SelectMode; label: string; description: string; icon: React.ReactNode }[] = [
  {
    id: 'rect',
    label: 'Rectangle',
    description: 'Select objects inside a rectangle',
    icon: <Square className="w-3.5 h-3.5" />
  },
  {
    id: 'ellipse',
    label: 'Circle',
    description: 'Select objects inside a circle',
    icon: <Circle className="w-3.5 h-3.5" />
  },
  {
    id: 'lasso',
    label: 'Lasso',
    description: 'Select objects with a freehand lasso',
    icon: <Lasso className="w-3.5 h-3.5" />
  }
];

const ERASER_MODES: {
  id: EraserMode;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    id: 'object',
    label: 'Object',
    description: 'Object eraser — remove each touched stroke completely',
    icon: <Trash2 className="w-3.5 h-3.5" />
  },
  {
    id: 'pixel',
    label: 'Pixel',
    description: 'Pixel eraser — erase only the covered part of a stroke',
    icon: <Eraser className="w-3.5 h-3.5" />
  }
];

const PEN_SIZES = [
  { size: 2, label: 'Fine' },
  { size: 4, label: 'Regular' },
  { size: 7, label: 'Medium' },
  { size: 12, label: 'Bold' }
];

const ERASER_SIZES = [12, 24, 36, 56];

/** Shared look for the icon-only dropdown triggers. */
const TRIGGER =
  'relative flex h-10 shrink-0 items-center justify-center rounded-xl transition active:scale-95 text-ink-light dark:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark';
const TRIGGER_OPEN = 'bg-surface-subtle-light dark:bg-surface-subtle-dark';
const PANEL =
  'absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 p-2 rounded-2xl glass-panel shadow-floating border border-surface-subtle-light dark:border-surface-subtle-dark bg-surface-light dark:bg-surface-dark animate-in fade-in duration-150';
const DIVIDER = 'h-6 w-px shrink-0 bg-surface-subtle-light dark:bg-surface-subtle-dark';

const MenuHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted-light dark:text-ink-muted-dark">
    {children}
  </div>
);

export const PenToolbar: React.FC<PenToolbarProps> = ({
  phone = false,
  activeTool,
  onSelectTool,
  color,
  onChangeColor,
  width,
  onChangeWidth,
  eraserWidth,
  onChangeEraserWidth,
  eraserMode = 'object',
  onChangeEraserMode,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onScribbleToText,
  hasStrokes,
  isStylusOnly,
  onToggleStylusOnly,
  onOpenSPenMenu,
  onToggleSPenLog,
  lastWritingTool,
  selectMode = 'rect',
  onChangeSelectMode
}) => {
  const [openMenu, setOpenMenu] = useState<ToolbarMenu>(null);
  const [showDrawingOptions, setShowDrawingOptions] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const activeToolOption = TOOL_OPTIONS.find((tool) => tool.id === activeTool) ?? TOOL_OPTIONS[2];
  const currentPalette = activeTool === 'highlighter' ? HIGHLIGHTER_PALETTE : INK_PALETTE;
  const isEraser = activeTool === 'eraser';
  const currentEraserWidth = eraserWidth ?? 24;

  // A single panel at a time, dismissed by tapping elsewhere or pressing Escape.
  useEffect(() => {
    if (!openMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenu]);

  const toggleMenu = (menu: Exclude<ToolbarMenu, null>) =>
    setOpenMenu((current) => (current === menu ? null : menu));
  const closeMenu = () => setOpenMenu(null);

  const pickTool = (tool: PenTool) => {
    onSelectTool(tool);
    closeMenu();
  };

  const triggerClass = (menu: Exclude<ToolbarMenu, null>, extraClasses = '') =>
    `${TRIGGER} ${openMenu === menu ? TRIGGER_OPEN : ''} ${extraClasses}`;

  const dotSize = isEraser
    ? Math.min(16, Math.max(6, Math.round(currentEraserWidth / 3.5)))
    : Math.min(14, Math.max(5, Math.round(width) + 2));

  return (
    <div
      ref={toolbarRef}
      data-ink-ui="pen-toolbar"
      data-phone-drawing={phone ? (showDrawingOptions ? 'all' : 'quick') : undefined}
      className="relative rounded-2xl glass-panel shadow-floating border border-surface-subtle-light dark:border-surface-subtle-dark select-none"
    >
      <div className="pen-toolbar-controls flex flex-wrap items-center justify-center gap-1 p-1.5">
        {phone && !showDrawingOptions && <>
          <button type="button" className="phone-editor-action" aria-label="Pen"
            aria-pressed={activeTool === lastWritingTool} onClick={() => pickTool(lastWritingTool || 'fountain')}>
            <Pen size={18} aria-hidden="true" />
          </button>
          <button type="button" className="phone-editor-action" aria-label="Eraser" aria-pressed={isEraser}
            onClick={() => pickTool('eraser')}><Eraser size={18} aria-hidden="true" /></button>
        </>}
        {/* Active tool — the menu holds every tool and its options. */}
        <button
          type="button"
          onClick={() => toggleMenu('tool')}
          title={`Tool: ${activeToolOption.label}`}
          aria-label={`Drawing tool: ${activeToolOption.label}`}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'tool'}
          className={`flex h-10 w-12 shrink-0 items-center justify-center gap-1 rounded-xl px-2 transition active:scale-95 sm:w-36 sm:justify-start ${
            openMenu === 'tool' ? 'ring-2 ring-violet-400/70' : ''
          } ${phone && !showDrawingOptions ? 'phone-editor-action' : activeToolOption.accent}`}
        >
          {(!phone || showDrawingOptions) && <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            {activeToolOption.icon}
          </span>}
          <span className="hidden min-w-0 flex-1 truncate text-left text-xs font-semibold sm:inline">
            {activeToolOption.label}
          </span>
          <ChevronDown className={`w-3 h-3 shrink-0 opacity-80 transition ${openMenu === 'tool' ? 'rotate-180' : ''}`} />
        </button>

        <span className={DIVIDER} aria-hidden="true" />

        {/* Ink color */}
        <button
          type="button"
          onClick={() => toggleMenu('color')}
          title={`Ink color ${color}`}
          aria-label="Ink color"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'color'}
          className={triggerClass('color', 'w-12 gap-1')}
        >
          <span
            className="w-4 h-4 rounded-full border border-black/20 dark:border-white/25"
            style={{ backgroundColor: color }}
          />
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>

        {/* Pen / eraser size */}
        <button
          type="button"
          onClick={() => toggleMenu('size')}
          title={isEraser ? `Eraser size: ${currentEraserWidth}px` : `Pen width: ${width}px`}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'size'}
          className={triggerClass('size', 'w-12 gap-1 pen-secondary')}
        >
          <span
            className="rounded-full bg-current"
            style={{ width: `${dotSize}px`, height: `${dotSize}px` }}
          />
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>

        <span className={DIVIDER} aria-hidden="true" />

        {/* Stylus-only palm shield */}
        <button
          type="button"
          onClick={onToggleStylusOnly}
          title={
            isStylusOnly
              ? 'Ink input is limited to the stylus'
              : 'Limit ink input to the stylus'
          }
          aria-pressed={isStylusOnly}
          className={`${TRIGGER} w-10 pen-secondary ${
            isStylusOnly
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'text-ink-muted-light dark:text-ink-muted-dark'
          }`}
        >
          {isStylusOnly ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4 opacity-70" />}
        </button>

        {/* Scribble to text */}
        <button
          type="button"
          onClick={onScribbleToText}
          disabled={!hasStrokes}
          title="Convert handwritten scribbles to text"
          className={`${TRIGGER} w-10 pen-secondary ${
            hasStrokes
              ? 'bg-gradient-to-r from-violet-600 via-indigo-600 to-pink-600 text-white hover:opacity-90'
              : 'disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
        >
          <Wand2 className="w-4 h-4" />
        </button>

        {onOpenSPenMenu && (
          <button
            type="button"
            onClick={onOpenSPenMenu}
            title="S Pen Quick Menu"
            className={`${TRIGGER} w-10 pen-secondary text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/40`}
          >
            <Sparkles className="w-4 h-4" />
          </button>
        )}
        {phone && showDrawingOptions && onToggleSPenLog && (
          <button type="button" className="phone-editor-action" aria-label="S Pen log" title="S Pen log"
            onClick={() => { closeMenu(); onToggleSPenLog(); }}><ClipboardCopy size={16} aria-hidden="true" /></button>
        )}

        <span className={DIVIDER} aria-hidden="true" />

        {/* Undo, redo, clear */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo stroke"
            aria-label="Undo stroke"
            className="flex h-9 w-8 items-center justify-center rounded-xl text-ink-light dark:text-ink-dark transition hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo stroke"
            className="pen-secondary flex h-9 w-8 items-center justify-center rounded-xl text-ink-light dark:text-ink-dark transition hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={!hasStrokes}
            title="Clear all inking"
            className="pen-secondary flex h-9 w-8 items-center justify-center rounded-xl text-ink-muted-light transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        {phone && <button type="button" className="phone-editor-action phone-drawing-options"
          aria-label="Drawing options" aria-expanded={showDrawingOptions} onClick={() => {
            closeMenu();
            setShowDrawingOptions((open) => !open);
          }}><Ellipsis size={18} aria-hidden="true" /></button>}
      </div>

      {/* ---------- Dropdown panels ---------- */}

      {openMenu === 'tool' && (
        <div className={`${PANEL} w-[248px] max-h-[70vh] overflow-y-auto`} role="menu" aria-label="Tools">
          <MenuHeading>Tool</MenuHeading>
          <div className="flex flex-col gap-0.5">
            {TOOL_OPTIONS.map((tool) => {
              const isActive = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => pickTool(tool.id)}
                  className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition active:scale-[0.99] ${
                    isActive
                      ? 'bg-violet-600 text-white shadow-md'
                      : 'text-ink-light dark:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark'
                  }`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center">{tool.icon}</span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="text-xs font-semibold">{tool.label}</span>
                    <span className={`truncate text-[10px] ${isActive ? 'text-white/75' : 'text-ink-muted-light dark:text-ink-muted-dark'}`}>
                      {tool.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {activeTool === 'eraser' && (
            <>
              <div className="my-2 h-px bg-surface-subtle-light dark:bg-surface-subtle-dark" />
              <MenuHeading>Eraser mode</MenuHeading>
              <div className="grid grid-cols-2 gap-1">
                {ERASER_MODES.map((mode) => {
                  const isSelected = eraserMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => onChangeEraserMode?.(mode.id)}
                      title={mode.description}
                      aria-pressed={isSelected}
                      className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-[11px] transition active:scale-95 ${
                        isSelected
                          ? 'bg-rose-500 font-semibold text-white shadow-md'
                          : 'text-ink-light dark:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark'
                      }`}
                    >
                      {mode.icon}
                      <span>{mode.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="px-1 pt-1.5 text-[10px] leading-snug text-ink-muted-light dark:text-ink-muted-dark">
                {eraserMode === 'pixel'
                  ? 'Erases only the covered part of a stroke.'
                  : 'Removes each touched stroke completely.'}
              </p>
              <button
                type="button"
                onClick={() => pickTool(lastWritingTool || 'fountain')}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-2 py-1.5 text-[11px] font-medium text-white shadow-sm transition hover:bg-violet-700 active:scale-95"
              >
                <Feather className="w-3.5 h-3.5" />
                Back to pen
              </button>
            </>
          )}

          {activeTool === 'select' && (
            <>
              <div className="my-2 h-px bg-surface-subtle-light dark:bg-surface-subtle-dark" />
              <MenuHeading>Selection shape</MenuHeading>
              <div className="grid grid-cols-3 gap-1">
                {SELECT_MODES.map((mode) => {
                  const isSelected = selectMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        onChangeSelectMode?.(mode.id);
                        closeMenu();
                      }}
                      title={mode.description}
                      aria-pressed={isSelected}
                      className={`flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] transition active:scale-95 ${
                        isSelected
                          ? 'bg-violet-600 font-semibold text-white shadow-md'
                          : 'text-ink-light dark:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark'
                      }`}
                    >
                      {mode.icon}
                      <span>{mode.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {openMenu === 'color' && (
        <div className={`${PANEL} w-[232px]`} role="menu" aria-label="Ink color">
          <MenuHeading>{activeTool === 'highlighter' ? 'Highlighter color' : 'Ink color'}</MenuHeading>
          <div className="grid grid-cols-5 gap-1.5">
            {currentPalette.map((item) => {
              const isSelected = color.toLowerCase() === item.hex.toLowerCase();
              return (
                <button
                  key={item.hex}
                  type="button"
                  onClick={() => {
                    onChangeColor(item.hex);
                    closeMenu();
                  }}
                  title={item.name}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border transition active:scale-90 ${
                    isSelected
                      ? 'border-violet-500 ring-2 ring-violet-500 ring-offset-2 ring-offset-white dark:ring-offset-gray-900'
                      : 'border-black/10 opacity-90 hover:scale-105 hover:opacity-100 dark:border-white/15'
                  }`}
                  style={{ backgroundColor: item.hex }}
                />
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2 border-t border-surface-subtle-light pt-2 dark:border-surface-subtle-dark">
            <span className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark">Custom</span>
            <input
              type="color"
              value={color}
              onChange={(event) => onChangeColor(event.target.value)}
              title="Custom ink color"
              className="h-8 w-10 cursor-pointer rounded-lg border-0 bg-transparent"
            />
            <span className="font-mono text-[11px] uppercase text-ink-muted-light dark:text-ink-muted-dark">
              {color}
            </span>
          </div>
        </div>
      )}

      {openMenu === 'size' && (
        <div className={`${PANEL} w-[236px]`} role="menu" aria-label={isEraser ? 'Eraser size' : 'Pen size'}>
          <MenuHeading>{isEraser ? 'Eraser size' : 'Pen size'}</MenuHeading>
          <div className="grid grid-cols-4 gap-1">
            {(isEraser ? ERASER_SIZES : PEN_SIZES.map((item) => item.size)).map((size) => {
              const isSelected = isEraser ? currentEraserWidth === size : width === size;
              const label = isEraser
                ? `${size}px`
                : PEN_SIZES.find((item) => item.size === size)?.label ?? `${size}px`;
              const preview = isEraser
                ? Math.min(16, Math.max(6, Math.round(size / 3.5)))
                : Math.min(14, Math.max(5, size + 2));
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => {
                    if (isEraser) onChangeEraserWidth?.(size);
                    else onChangeWidth(size);
                    closeMenu();
                  }}
                  title={isEraser ? `Eraser size: ${size}px` : `Pen width: ${size}px`}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] transition active:scale-95 ${
                    isSelected
                      ? isEraser
                        ? 'bg-rose-500 font-bold text-white shadow-md'
                        : 'bg-violet-600 font-bold text-white shadow-md'
                      : 'text-ink-light dark:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark'
                  }`}
                >
                  <span
                    className="rounded-full bg-current"
                    style={{ width: `${preview}px`, height: `${preview}px` }}
                  />
                  <span className="whitespace-nowrap">{label}</span>
                </button>
              );
            })}
          </div>

          {isEraser && (
            <>
              <div className="my-2 h-px bg-surface-subtle-light dark:bg-surface-subtle-dark" />
              <MenuHeading>Eraser mode</MenuHeading>
              <div className="grid grid-cols-2 gap-1">
                {ERASER_MODES.map((mode) => {
                  const isSelected = eraserMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => onChangeEraserMode?.(mode.id)}
                      title={mode.description}
                      aria-pressed={isSelected}
                      className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-[11px] transition active:scale-95 ${
                        isSelected
                          ? 'bg-rose-500 font-semibold text-white shadow-md'
                          : 'text-ink-light dark:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark'
                      }`}
                    >
                      {mode.icon}
                      <span>{mode.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="px-1 pt-1.5 text-[10px] leading-snug text-ink-muted-light dark:text-ink-muted-dark">
                S Pen side button erases with these settings.
              </p>
            </>
          )}
        </div>
      )}

    </div>
  );
};
