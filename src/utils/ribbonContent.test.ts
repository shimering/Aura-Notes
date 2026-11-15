// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { sanitizeNoteHtml } from './noteHtml';

it('preserves the ribbon formatting and media through HTML sanitation', () => {
  const html = sanitizeNoteHtml(
    '<p style="text-align: center"><font face="Georgia" size="4"><b>Note</b></font></p>' +
    '<table><tbody><tr><td>Cell</td></tr></tbody></table>' +
    '<img src="data:image/png;base64,AAAA" alt="photo.png">' +
    '<a href="data:application/pdf;base64,JVBERi0=" download="report.pdf">report.pdf</a>',
  );
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelector('p')?.style.textAlign).toBe('center');
  expect(doc.querySelector('font[face="Georgia"][size="4"] > b')?.textContent).toBe('Note');
  expect(doc.querySelector('table td')?.textContent).toBe('Cell');
  expect(doc.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  expect(doc.querySelector('a[download="report.pdf"]')?.getAttribute('href')).toBe('data:application/pdf;base64,JVBERi0=');
});

it('blocks executable and remote content in inserted media markup', () => {
  const html = sanitizeNoteHtml(
    '<img src="data:image/svg+xml;base64,AAAA">' +
    '<img src="https://example.test/pixel.png">' +
    '<a href="data:text/html;base64,AAAA" download="bad.pdf">Bad PDF</a>' +
    '<a href="javascript:alert(1)">Script</a>' +
    '<img src="data:image/png;base64,AAAA" onerror="alert(1)">',
  );
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelectorAll('img')).toHaveLength(1);
  expect(doc.querySelector('[href], [download], [onerror]')).toBeNull();
});
