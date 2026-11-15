import type { PointerEvent } from 'react';
import { cellName } from '../utils/noteTable';
import { offsetWithin } from '../utils/pageObjects';
import type { TextBlockLayout } from '../types/note';

export type TableResizeAxis = 'column' | 'row';

interface TableResizeHandlesProps {
  table: HTMLTableElement;
  box: HTMLElement;
  placement: TextBlockLayout;
  onStart: (event: PointerEvent, cell: HTMLTableCellElement, axis: TableResizeAxis) => void;
  onStep: (cell: HTMLTableCellElement, axis: TableResizeAxis, delta: number) => void;
}

export function TableResizeHandles({ table, box, placement, onStart, onStep }: TableResizeHandlesProps) {
  const rows = Array.from(table.rows);
  const columns = Array.from(rows.reduce<HTMLTableRowElement | undefined>((widest, row) =>
    !widest || row.cells.length > widest.cells.length ? row : widest, undefined)?.cells ?? []);
  const edge = offsetWithin(table, box);
  const handle = (cell: HTMLTableCellElement, axis: TableResizeAxis, index: number) => {
    const isColumn = axis === 'column';
    const row = cell.parentElement as HTMLTableRowElement;
    const position = offsetWithin(isColumn ? cell : row, box);
    const left = isColumn ? position.x + cell.offsetWidth : edge.x + table.offsetWidth;
    const top = isColumn ? edge.y + table.offsetHeight : position.y + row.offsetHeight;
    const label = isColumn ? `Resize column ${cellName(cell).replace(/\d+$/, '')}` : `Resize row ${index + 1}`;
    return (
      <button key={`${axis}-${index}`} type="button" className={`table-resize-handle table-resize-${axis}`}
        title={label} aria-label={label}
        style={{ left, top }}
        onPointerDown={(event) => onStart(event, cell, axis)}
        onKeyDown={(event) => {
          const direction = event.key === (isColumn ? 'ArrowRight' : 'ArrowDown') ? 1
            : event.key === (isColumn ? 'ArrowLeft' : 'ArrowUp') ? -1 : 0;
          if (!direction) return;
          event.preventDefault();
          event.stopPropagation();
          onStep(cell, axis, direction * (event.shiftKey ? 10 : 1));
        }}>
        <span />
      </button>
    );
  };

  return (
    <div className="absolute inset-0 z-[41] origin-top-left pointer-events-none" data-ink-ui="selection"
      style={{ transform: `translate(${placement.x}px, ${placement.y}px) rotate(${placement.rotation}rad) scale(${placement.scale})` }}>
      {columns.map((cell, index) => handle(cell, 'column', index))}
      {rows.map((row, index) => row.cells[0] && handle(row.cells[0], 'row', index))}
    </div>
  );
}
