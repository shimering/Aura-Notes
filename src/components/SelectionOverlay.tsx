import React from 'react';
import { BringToFront, SendToBack, Trash2, RotateCw } from 'lucide-react';
import { Bounds, InkTransform } from '../utils/inkSelection';

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

interface SelectionOverlayProps {
  bounds: Bounds;
  /** Live move / resize / rotate being dragged, or null at rest. */
  transform: InkTransform | null;
  /** Number of ink objects in the selection. */
  count: number;
  /** True when the note's typed text block is part of the selection. */
  textSelected?: boolean;
  onStartMove: (e: React.PointerEvent) => void;
  onStartResize: (corner: ResizeCorner, e: React.PointerEvent) => void;
  onStartRotate: (e: React.PointerEvent) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
}

const CORNERS: { corner: ResizeCorner; className: string; cursor: string }[] = [
  { corner: 'nw', className: '-top-3 -left-3', cursor: 'cursor-nwse-resize' },
  { corner: 'ne', className: '-top-3 -right-3', cursor: 'cursor-nesw-resize' },
  { corner: 'sw', className: '-bottom-3 -left-3', cursor: 'cursor-nesw-resize' },
  { corner: 'se', className: '-bottom-3 -right-3', cursor: 'cursor-nwse-resize' }
];

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
  count,
  textSelected = false,
  onStartMove,
  onStartResize,
  onStartRotate,
  onBringToFront,
  onSendToBack,
  onDelete
}) => {
  const objectCount = count + (textSelected ? 1 : 0);
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
      className="absolute z-40 pointer-events-none"
      style={style}
      data-ink-ui="selection"
      aria-hidden={false}
    >
      {/* The frame itself: drag anywhere inside to move the selection. */}
      <div
        role="presentation"
        onPointerDown={onStartMove}
        className="absolute inset-0 pointer-events-auto cursor-move rounded-[3px] border-2 border-dashed border-violet-500 bg-violet-500/5 touch-none"
      />

      {/* Rotation grip above the frame. */}
      <button
        type="button"
        onPointerDown={onStartRotate}
        title="Rotate selection"
        aria-label="Rotate selection"
        className="absolute left-1/2 -top-11 -translate-x-1/2 pointer-events-auto p-2 rounded-full bg-surface-light dark:bg-surface-dark border border-violet-500 text-violet-600 dark:text-violet-400 shadow-floating cursor-grab active:cursor-grabbing touch-none"
      >
        <RotateCw className="w-4 h-4" />
      </button>
      <div className="absolute left-1/2 -top-5 h-3 w-px -translate-x-1/2 bg-violet-500/70 pointer-events-none" />

      {/* Corner resize handles. Kept large enough to grab with a finger. */}
      {CORNERS.map((item) => (
        <button
          key={item.corner}
          type="button"
          onPointerDown={(e) => onStartResize(item.corner, e)}
          title="Resize selection"
          aria-label="Resize selection"
          className={`absolute ${item.className} w-6 h-6 pointer-events-auto rounded-md bg-surface-light dark:bg-surface-dark border-2 border-violet-500 shadow-sm touch-none flex items-center justify-center ${item.cursor}`}
        >
          <span className="w-1.5 h-1.5 rounded-[1px] bg-violet-500/70" />
        </button>
      ))}

      {/* Object actions, pinned under the frame. */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute left-1/2 -bottom-12 -translate-x-1/2 pointer-events-auto flex items-center gap-1 px-1.5 py-1 rounded-xl glass-panel shadow-floating border border-surface-subtle-light dark:border-surface-subtle-dark text-[11px] text-ink-light dark:text-ink-dark whitespace-nowrap"
      >
        <span
          className="px-1 text-ink-muted-light dark:text-ink-muted-dark"
          title={textSelected ? 'Text block selected' : 'Ink objects selected'}
        >
          {textSelected ? (count > 0 ? `${count} + text` : 'Text') : objectCount}
        </span>
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
      </div>
    </div>
  );
};
