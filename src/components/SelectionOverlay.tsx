import React from 'react';
import { BringToFront, SendToBack, Trash2, RotateCw, Pencil } from 'lucide-react';
import { Bounds, InkTransform, Point } from '../utils/inkSelection';

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

interface SelectionOverlayProps {
  bounds: Bounds;
  /** Live move / resize / rotate being dragged, or null at rest. */
  transform: InkTransform | null;
  hovering?: boolean;
  /** Number of ink objects in the selection. */
  count: number;
  boxCount?: number;
  tableSelected?: boolean;
  pictureCount?: number;
  onEditText?: () => void;
  onStartResize?: (corner: ResizeCorner, e: React.PointerEvent) => void;
  widthHandle?: Point | null;
  onStartWidth?: (e: React.PointerEvent) => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  onReplacePicture?: () => void;
  onInkColor?: (color: string) => void;
  onInkWidth?: (width: number) => void;
  inkColor?: string;
  inkWidth?: number;
  onStartRotate: (e: React.PointerEvent) => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
  onDelete?: () => void;
}

const CORNERS: { corner: ResizeCorner; className: string; cursor: string }[] = [
  { corner: 'nw', className: '-top-3 -left-3', cursor: 'cursor-nwse-resize' },
  { corner: 'ne', className: '-top-3 -right-3', cursor: 'cursor-nesw-resize' },
  { corner: 'sw', className: '-bottom-3 -left-3', cursor: 'cursor-nesw-resize' },
  { corner: 'se', className: '-bottom-3 -right-3', cursor: 'cursor-nwse-resize' }
];

export function TextWidthHandle({ point, onPointerDown }: {
  point: Point;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      title="Resize text box width"
      aria-label="Resize text box width"
      data-ink-ui="text-width"
      tabIndex={-1}
      style={{ left: point.x, top: point.y }}
      className="absolute z-[41] flex h-11 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center pointer-events-auto cursor-ew-resize touch-none select-none"
    >
      <span className="pointer-events-none h-5 w-2 rounded-full bg-violet-600 ring-2 ring-white" />
    </button>
  );
}

/**
 * Dotted frame, resize corners, rotation grip and the z-order / delete actions
 * for the objects currently selected on the note page.
 *
 * The frame keeps the page's untransformed bounds and mirrors the live
 * transform, so the box follows the objects while a drag is in progress. It
 * sits above the ink canvas so the finger and S Pen can grab the handles
 * instead of starting a new rubber band.
 */
export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({
  bounds,
  transform,
  hovering = false,
  count,
  boxCount = 0,
  tableSelected = false,
  pictureCount = 0,
  onEditText,
  onStartResize,
  widthHandle,
  onStartWidth,
  onGroup,
  onUngroup,
  onReplacePicture,
  onInkColor,
  onInkWidth,
  inkColor,
  inkWidth,
  onStartRotate,
  onBringToFront,
  onSendToBack,
  onDelete
}) => {
  const objectCount = count + pictureCount + boxCount;
  const style: React.CSSProperties = {
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transformOrigin: transform
      ? `${transform.originX - bounds.x}px ${transform.originY - bounds.y}px`
      : 'center',
    transform: transform
      ? `translate(${transform.translateX}px, ${transform.translateY}px) rotate(${transform.rotation}rad) scale(${transform.scale})`
      : undefined
  };

  return (
    <div
      className={`absolute pointer-events-none ${hovering ? 'z-[34]' : 'z-40'}`}
      style={style}
      data-ink-hover={hovering ? '' : undefined}
      data-ink-ui="selection"
      aria-hidden={false}
    >
      <div className="absolute inset-0 rounded-[3px] border-2 border-dashed border-violet-500 bg-violet-500/5" />
      {widthHandle && onStartWidth && <TextWidthHandle point={widthHandle} onPointerDown={onStartWidth} />}

      {/* Rotation grip above the frame. */}
      <button
        type="button"
        onPointerDown={onStartRotate}
        title="Rotate selection"
        aria-label="Rotate selection"
        tabIndex={-1}
        className={`absolute left-1/2 -top-11 -translate-x-1/2 pointer-events-auto p-2 rounded-full bg-surface-light dark:bg-surface-dark border border-violet-500 text-violet-600 dark:text-violet-400 shadow-floating cursor-grab active:cursor-grabbing touch-none ${hovering ? 'before:absolute before:inset-x-0 before:top-full before:h-3' : ''}`}
      >
        <RotateCw className="w-4 h-4" />
      </button>
      <div className="absolute left-1/2 -top-5 h-3 w-px -translate-x-1/2 bg-violet-500/70 pointer-events-none" />

      {/* Corner resize handles. Kept large enough to grab with a finger. */}
      {onStartResize && CORNERS.map((item) => (
        <button
          key={item.corner}
          type="button"
          onPointerDown={(e) => onStartResize(item.corner, e)}
          title="Resize selection"
          aria-label="Resize selection"
          tabIndex={-1}
          className={`absolute ${item.className} w-6 h-6 pointer-events-auto rounded-md bg-surface-light dark:bg-surface-dark border-2 border-violet-500 shadow-sm touch-none flex items-center justify-center ${item.cursor}`}
        >
          <span className="w-1.5 h-1.5 rounded-[1px] bg-violet-500/70" />
        </button>
      ))}

      {/* Object actions, pinned under the selected frame. */}
      {!hovering && <div
        onPointerDown={(e) => e.stopPropagation()}
        className={`absolute left-1/2 ${tableSelected ? '-bottom-20' : '-bottom-12'} -translate-x-1/2 pointer-events-auto flex items-center gap-1 px-1.5 py-1 rounded-xl glass-panel shadow-floating border border-surface-subtle-light dark:border-surface-subtle-dark text-[11px] text-ink-light dark:text-ink-dark whitespace-nowrap`}
      >
        <span
          className="px-1 text-ink-muted-light dark:text-ink-muted-dark"
          title={`${objectCount} selected`}
        >
          {objectCount === 1 ? (tableSelected ? 'Table' : boxCount ? 'Text' : pictureCount ? 'Image' : 'Ink') : objectCount}
        </span>
        {onEditText && (
          <button
            type="button"
            onClick={onEditText}
            className="flex items-center gap-1 rounded-lg px-3 py-2 font-semibold hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark"
          >
            <Pencil className="w-3.5 h-3.5" />
            {tableSelected ? 'Edit table' : 'Edit text'}
          </button>
        )}
        {onGroup && <button type="button" className="px-2 py-1" onClick={onGroup}>Group ink</button>}
        {onUngroup && <button type="button" className="px-2 py-1" onClick={onUngroup}>Ungroup ink</button>}
        {onReplacePicture && <button type="button" className="px-2 py-1" onClick={onReplacePicture}>Replace image</button>}
        {onInkColor && <input type="color" aria-label="Ink color" className="w-7 h-7"
          value={/^#[0-9a-f]{6}$/i.test(inkColor ?? '') ? inkColor : '#1e293b'}
          onChange={(event) => onInkColor(event.target.value)} />}
        {onInkWidth && <label className="flex gap-1 items-center">Ink width
          <input type="number" aria-label="Ink width" className="w-12 bg-transparent"
            min={1} max={120} defaultValue={Math.round(inkWidth ?? 4)}
            onBlur={(event) => { if (event.target.validity.valid && event.target.value) onInkWidth(event.target.valueAsNumber); }}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        </label>}
        <button
          type="button"
          onClick={onBringToFront}
          disabled={count === 0}
          title="Bring in front of the text"
          className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark transition active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <BringToFront className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Front</span>
        </button>
        <button
          type="button"
          onClick={onSendToBack}
          disabled={count === 0}
          title="Send behind the text"
          className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark transition active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <SendToBack className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Back</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete selection"
          aria-label="Delete selection"
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition active:scale-95"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>}
    </div>
  );
};
