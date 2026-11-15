
import { useLayoutEffect, useRef, useState } from 'react';
import { cellName, changeTableShape, setCellFormula, setTableDimension, tableDimensions } from '../utils/noteTable';

interface TableToolbarProps {
  cell: HTMLTableCellElement;
  onChangeCell: (cell: HTMLTableCellElement | null) => void;
  onSave: () => void;
}

export function TableToolbar({ cell, onChangeCell, onSave }: TableToolbarProps) {
  const [error, setError] = useState('');
  const sizeForm = useRef<HTMLFormElement>(null);
  const formulaForm = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => {
    formulaForm.current?.reset();
    setError('');
  }, [cell]);
  const table = cell.closest('table');
  const { width, height } = table ? tableDimensions(table, cell) : { width: 0, height: 0 };
  useLayoutEffect(() => {
    sizeForm.current?.reset();
  }, [cell, width, height]);
  if (!table) return null;
  const name = cellName(cell);

  const changeShape = (axis: 'row' | 'column', action: 'add' | 'remove') => {
    onChangeCell(changeTableShape(table, cell, axis, action));
    onSave();
  };

  return (
    <div className="table-toolbar" role="group" aria-label="Table tools">
      <span className="font-semibold" aria-label="Selected cell">{name}</span>
      <button type="button" onClick={() => changeShape('row', 'add')}>Add row</button>
      <button type="button" onClick={() => changeShape('row', 'remove')} disabled={table.rows.length <= 1}>Remove row</button>
      <button type="button" onClick={() => changeShape('column', 'add')}>Add column</button>
      <button type="button" onClick={() => changeShape('column', 'remove')} disabled={table.rows[0].cells.length <= 1}>Remove column</button>
      <form ref={sizeForm} onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        setTableDimension(table, cell, 'column', Number(values.get('width')));
        setTableDimension(table, cell, 'row', Number(values.get('height')));
        onSave();
      }}>
        <label>Column width <input name="width" type="number" min="24" max="1200" required defaultValue={width} /></label>
        <label>Row height <input name="height" type="number" min="24" max="1200" required defaultValue={height} /></label>
        <button type="submit">Apply size</button>
      </form>
      <form ref={formulaForm} onSubmit={(event) => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get('formula') ?? '');
        if (!setCellFormula(table, cell, value)) {
          setError('Use a formula such as =A1+B1 or =A1-B1.');
          return;
        }
        setError('');
        onSave();
      }}>
        <label>Formula <input name="formula" placeholder="=A1+B1" defaultValue={cell.dataset.cellFormula ?? ''} onChange={() => setError('')} /></label>
        <button type="submit">Apply formula</button>
      </form>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
