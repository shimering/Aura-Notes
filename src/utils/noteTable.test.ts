// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { changeTableShape, createNoteTable, recalculateTable, setCellFormula, setTableDimension } from './noteTable';
import { sanitizeNoteHtml } from './noteHtml';

it('recalculates cell dependencies after values change and keeps formulas saved', () => {
  const table = createNoteTable(2, 3);
  const [a, b, c] = Array.from(table.rows[0].cells);
  const d = table.rows[1].cells[0];
  a.textContent = '9';
  b.textContent = '4';
  expect(setCellFormula(table, c, '=a1-b1')).toBe(true);
  expect(setCellFormula(table, d, '=C1+A1')).toBe(true);
  expect([c.textContent, d.textContent]).toEqual(['5', '14']);
  b.textContent = '7';
  recalculateTable(table);
  expect([c.textContent, d.textContent]).toEqual(['2', '11']);
  expect(sanitizeNoteHtml(table.outerHTML)).toContain('data-cell-formula="=A1-B1"');
  expect(setCellFormula(table, a, '=C1+B1')).toBe(true);
  expect([a.textContent, c.textContent, d.textContent]).toEqual(['#ERROR', '#ERROR', '#ERROR']);
});

it('moves formula references with their cells and preserves sizes through sanitation', () => {
  const table = createNoteTable(2, 3);
  const [a, b, c] = Array.from(table.rows[0].cells);
  a.textContent = '2';
  b.textContent = '4';
  setCellFormula(table, c, '=A1+B1');
  const inserted = changeTableShape(table, a, 'column', 'add')!;
  expect(c.dataset.cellFormula).toBe('=A1+C1');
  expect(c.textContent).toBe('6');
  setTableDimension(table, inserted, 'column', 170);
  setTableDimension(table, inserted, 'row', 56);
  const saved = sanitizeNoteHtml(table.outerHTML);
  const restored = new DOMParser().parseFromString(saved, 'text/html');
  expect(restored.querySelectorAll('col')[1].style.width).toBe('170px');
  expect(restored.querySelector('tr')?.style.height).toBe('56px');
  changeTableShape(table, b, 'column', 'remove');
  expect(c.dataset.cellFormula).toBe('=A1+#REF!');
  expect(sanitizeNoteHtml(table.outerHTML)).toContain('data-cell-formula="=A1+#REF!"');
  expect(c.textContent).toBe('#ERROR');
});
