
import { cellFormula } from './noteHtml';

export const tableBoxSelector = '[data-note-table="true"]';
const columnWidth = 112;
const rowHeight = 32;
const referencePattern = /([A-Z]{1,3})([1-9]\d{0,2})/gi;

function columnIndex(letters: string) {
  return Array.from(letters.toUpperCase()).reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function columnName(index: number) {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + (value - 1) % 26) + name;
  }
  return name;
}

export function cellName(cell: HTMLTableCellElement) {
  return columnName(cell.cellIndex) + ((cell.parentElement as HTMLTableRowElement).rowIndex + 1);
}

function makeColumn(width = columnWidth) {
  const column = document.createElement('col');
  column.style.width = `${width}px`;
  return column;
}

export function createNoteTable(rows: number, columns: number) {
  const table = document.createElement('table');
  const body = table.createTBody();
  for (let r = 0; r < rows; r++) {
    const row = body.insertRow();
    for (let c = 0; c < columns; c++) row.insertCell().append(document.createElement('br'));
  }
  ensureTableColumns(table);
  return table;
}

export function ensureTableColumns(table: HTMLTableElement) {
  let columns = table.querySelector<HTMLTableColElement>(':scope > colgroup');
  if (!columns) {
    columns = document.createElement('colgroup');
    table.prepend(columns);
  }
  const count = Math.max(1, ...Array.from(table.rows, (row) => row.cells.length));
  while (columns.children.length < count) columns.append(makeColumn());
  fitTable(table, columns);
  return columns;
}

function fitTable(table: HTMLTableElement, columns: HTMLTableColElement) {
  const width = Array.from(columns.children).reduce((total, node) =>
    total + (parseInt((node as HTMLElement).style.width, 10) || columnWidth), 0);
  table.style.width = `${width}px`;
}

export function tableDimensions(table: HTMLTableElement, cell: HTMLTableCellElement) {
  const column = table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col')[cell.cellIndex];
  return {
    width: parseInt(column?.style.width ?? '', 10) || columnWidth,
    height: parseInt((cell.parentElement as HTMLElement).style.height, 10) || rowHeight,
  };
}

export function setTableDimension(table: HTMLTableElement, cell: HTMLTableCellElement, axis: 'row' | 'column', size: number) {
  if (!Number.isFinite(size)) return;
  const pixels = `${Math.max(24, Math.min(1200, Math.round(size)))}px`;
  if (axis === 'row') (cell.parentElement as HTMLElement).style.height = pixels;
  else {
    const columns = ensureTableColumns(table);
    (columns.children[cell.cellIndex] as HTMLElement).style.width = pixels;
    fitTable(table, columns);
  }
}

export function recalculateTable(table: HTMLTableElement) {
  const values = new Map<HTMLTableCellElement, number>();
  const visiting = new Set<HTMLTableCellElement>();

  const evaluate = (cell: HTMLTableCellElement): number => {
    const previous = values.get(cell);
    if (previous !== undefined) return previous;
    if (visiting.has(cell)) return NaN;
    const formula = cell.dataset.cellFormula;
    if (!formula) return Number(cell.textContent?.trim() ?? '');
    if (!cellFormula.test(formula)) return NaN;
    visiting.add(cell);
    let result = 0;
    for (const token of formula.toUpperCase().matchAll(/([=+-]) *(?:([A-Z]{1,3})(\d+)|(#REF!))/g)) {
      const [, operator, column, row] = token;
      const other = row ? table.rows[Number(row) - 1]?.cells[columnIndex(column)] : undefined;
      if (!other) {
        result = NaN;
        break;
      }
      result += (operator === '-' ? -1 : 1) * evaluate(other);
    }
    visiting.delete(cell);
    values.set(cell, result);
    return result;
  };

  table.querySelectorAll<HTMLTableCellElement>('[data-cell-formula]').forEach((cell) => {
    const value = evaluate(cell);
    const text = Number.isFinite(value) ? String(Number(value.toPrecision(12))) : '#ERROR';
    if (cell.textContent !== text) cell.textContent = text;
  });
}

export function setCellFormula(table: HTMLTableElement, cell: HTMLTableCellElement, input: string) {
  const formula = input.trim().toUpperCase();
  if (formula && !cellFormula.test(formula)) return false;
  if (formula) cell.dataset.cellFormula = formula;
  else delete cell.dataset.cellFormula;
  recalculateTable(table);
  return true;
}

/** Insert after the current cell, or remove its row/column. References follow surviving cells. */
export function changeTableShape(
  table: HTMLTableElement, cell: HTMLTableCellElement, axis: 'row' | 'column', action: 'add' | 'remove',
): HTMLTableCellElement | null {
  const row = cell.parentElement as HTMLTableRowElement;
  const columns = ensureTableColumns(table);
  const rowIndex = row.rowIndex;
  const colIndex = cell.cellIndex;
  const index = (axis === 'row' ? rowIndex : colIndex) + (action === 'add' ? 1 : 0);
  const count = axis === 'row' ? table.rows.length : columns.children.length;
  if (action === 'remove' && count <= 1) return cell;

  if (axis === 'row') {
    if (action === 'remove') table.deleteRow(index);
    else {
      const parent = row.parentElement as HTMLTableSectionElement;
      const added = parent.insertRow(row.sectionRowIndex + 1);
      for (let i = 0; i < columns.children.length; i++) added.insertCell().append(document.createElement('br'));
    }
  } else if (action === 'remove') {
    columns.children[index]?.remove();
    Array.from(table.rows).forEach((item) => { if (item.cells[index]) item.deleteCell(index); });
  } else {
    columns.insertBefore(makeColumn(), columns.children[index] ?? null);
    Array.from(table.rows).forEach((item) => item.insertCell(Math.min(index, item.cells.length)).append(document.createElement('br')));
  }

  table.querySelectorAll<HTMLTableCellElement>('[data-cell-formula]').forEach((item) => {
    item.dataset.cellFormula = item.dataset.cellFormula!.replace(referencePattern, (reference, column: string, number: string) => {
      const r = Number(number) - 1;
      const c = columnIndex(column);
      const current = axis === 'row' ? r : c;
      if (current < index) return reference;
      if (current === index && action === 'remove') return '#REF!';
      const shift = action === 'add' ? 1 : -1;
      return axis === 'row' ? column + (r + shift + 1) : columnName(c + shift) + (r + 1);
    });
  });
  fitTable(table, columns);
  recalculateTable(table);
  const nextRow = table.rows[Math.min(axis === 'row' ? index : rowIndex, table.rows.length - 1)];
  return nextRow?.cells[Math.min(axis === 'column' ? index : colIndex, nextRow.cells.length - 1)] ?? null;
}
