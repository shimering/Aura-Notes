import React, { useRef, useState } from 'react';
import type { NoteArrow } from '../types/note';
import type { Point } from '../utils/inkSelection';
import {
  arrowGeometry, arrowHeadPoints, arrowPath, moveArrow,
  type ArrowTarget,
} from '../utils/noteArrows';

interface NoteArrowLayerProps {
  arrows: NoteArrow[];
  targets: ArrowTarget[];
  /** Arrow being dragged out from the Insert tab, drawn but not yet saved. */
  draft?: NoteArrow | null;
  selectedId: string | null;
  pageWidth: number;
  pageHeight: number;
  /** Page zoom, so handles keep a constant on-screen size at any zoom. */
  zoom: number;
  /** Client coordinates to page coordinates, including scroll and zoom. */
  toPage: (clientX: number, clientY: number) => Point;
  /** Snaps a page point to nearby object edges and reports the object. */
  snap: (point: Point) => { point: Point; objectId?: string };
  onSelect: (id: string | null) => void;
  onChange: (arrow: NoteArrow) => void;
  /** Saves any object ids assigned while snapping. */
  onObjectsChanged: () => void;
}

type DragMode = 'move' | 'start' | 'end' | 'bend';

const DRAFT_ID = 'arrow-draft';

/**
 * Arrows and their editing handles, drawn above the typed objects so a map
 * chart's connectors always stay on top. Everything is SVG in page units, so
 * lines and heads stay vector-sharp at any zoom, and the arrow is redrawn on
 * every pointer move while a handle is dragged. The layer only takes pointer
 * events on the arrows themselves, so ink and text keep working around them.
 */
export const NoteArrowLayer: React.FC<NoteArrowLayerProps> = ({
  arrows, targets, draft, selectedId, pageWidth, pageHeight, zoom, toPage, snap,
  onSelect, onChange, onObjectsChanged,
}) => {
  const [live, setLive] = useState<NoteArrow | null>(null);
  const dragRef = useRef<{ mode: DragMode; base: NoteArrow; start: Point } | null>(null);
  const selected = live ?? arrows.find((arrow) => arrow.id === selectedId) ?? null;
  const selectedGeometry = selected ? arrowGeometry(selected, targets) : null;

  // Dragging a handle shows the new shape immediately, before it is saved.
  const withLive = live ? arrows.map((arrow) => (arrow.id === live.id ? live : arrow)) : arrows;
  const visible = draft ? [...withLive, { ...draft, id: DRAFT_ID }] : withLive;
  // Controls live in the zoomed page, so scale them back to screen pixels.
  const uiScale = 1 / Math.max(0.05, zoom || 1);

  const beginDrag = (event: React.PointerEvent, arrow: NoteArrow, mode: DragMode) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(arrow.id);
    dragRef.current = {
      mode,
      base: arrow,
      start: toPage(event.clientX, event.clientY),
    };
    let settled: NoteArrow | null = null;

    const onMove = (moveEvent: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const point = toPage(moveEvent.clientX, moveEvent.clientY);
      const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y };
      if (drag.mode === 'move') {
        settled = moveArrow(drag.base, delta);
      } else if (drag.mode === 'bend') {
        const current = arrowGeometry(drag.base, targets);
        settled = { ...drag.base, bend: { x: current.control.x + delta.x, y: current.control.y + delta.y } };
      } else {
        const snapped = snap(point);
        settled = drag.mode === 'start'
          ? { ...drag.base, start: snapped.point, startAnchor: snapped.objectId ? { objectId: snapped.objectId } : undefined }
          : { ...drag.base, end: snapped.point, endAnchor: snapped.objectId ? { objectId: snapped.objectId } : undefined };
      }
      setLive(settled);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      dragRef.current = null;
      const finished = settled;
      setLive(null);
      if (!finished) return;
      const stored = arrows.find((arrow) => arrow.id === finished.id);
      if (stored && (stored.start.x !== finished.start.x || stored.end.x !== finished.end.x
        || stored.bend?.x !== finished.bend?.x || stored.startAnchor?.objectId !== finished.startAnchor?.objectId
        || stored.endAnchor?.objectId !== finished.endAnchor?.objectId)) {
        onChange(finished);
        onObjectsChanged();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const width = Math.max(1, pageWidth);
  const height = Math.max(1, pageHeight);
  // Finger-sized grab: a 28px-wide shaft hit area, whatever the page zoom.
  const hitSlop = 28 * uiScale;
  const handleStyle = (point: Point): React.CSSProperties => ({
    left: point.x,
    top: point.y,
    transform: `translate(-50%, -50%) scale(${uiScale})`,
    transformOrigin: 'center',
  });

  return (
    <>
      <svg
        className="absolute left-0 top-0 z-[35]"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        shapeRendering="geometricPrecision"
        style={{ pointerEvents: 'none', overflow: 'visible' }}
        aria-label="Arrows"
        role="group"
      >
        {visible.map((arrow) => {
          const geometry = arrowGeometry(arrow, targets);
          return (
            <g key={arrow.id} data-note-arrow={arrow.id}>
              <path
                d={arrowPath(arrow, geometry)}
                fill="none"
                stroke={arrow.color}
                strokeWidth={arrow.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polygon points={arrowHeadPoints(geometry)} fill={arrow.color} />
              {!draft && (
                <path
                  d={arrowPath(arrow, geometry)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(hitSlop, arrow.width + 14)}
                  strokeLinecap="round"
                  style={{ pointerEvents: 'stroke', cursor: 'move' }}
                  onPointerDown={(event) => beginDrag(event, arrow, 'move')}
                />
              )}
            </g>
          );
        })}
      </svg>

      {selected && selectedGeometry && !draft && (
        <div className="absolute inset-0 z-[36] pointer-events-none" data-ink-ui="arrow-selection">
          <button
            type="button"
            aria-label="Move tail"
            title="Drag the tail; release near an object to attach it"
            onPointerDown={(event) => beginDrag(event, selected, 'start')}
            style={handleStyle(selectedGeometry.start)}
            className="pointer-events-auto absolute grid h-11 w-11 cursor-crosshair place-items-center rounded-full touch-none"
          >
            <span className="h-7 w-7 rounded-full border-2 border-violet-500 bg-white shadow-md" />
          </button>
          <button
            type="button"
            aria-label="Move arrowhead"
            title="Drag the head; release near an object to attach it"
            onPointerDown={(event) => beginDrag(event, selected, 'end')}
            style={handleStyle(selectedGeometry.end)}
            className="pointer-events-auto absolute grid h-11 w-11 cursor-crosshair place-items-center rounded-full touch-none"
          >
            <span className="h-7 w-7 rounded-full border-2 border-violet-500 bg-white shadow-md" />
          </button>
          {selected.kind === 'curved' && (
            <button
              type="button"
              aria-label="Adjust curve"
              title="Drag to bend the curve"
              onPointerDown={(event) => beginDrag(event, selected, 'bend')}
              style={handleStyle(selectedGeometry.control)}
              className="pointer-events-auto absolute grid h-11 w-11 cursor-grab place-items-center rounded-full touch-none active:cursor-grabbing"
            >
              <span className="h-6 w-6 rounded-full border-2 border-violet-500 bg-violet-100 shadow-md" />
            </button>
          )}
        </div>
      )}
    </>
  );
};
