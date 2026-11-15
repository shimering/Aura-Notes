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

it('preserves image wrapping and positioned text through save and reload', () => {
  const html = sanitizeNoteHtml(
    '<div data-note-positioned="true" style="left: 36px; top: 420px; position: fixed"><p>Typed here</p></div>' +
    '<img data-picture-wrap="free" src="data:image/png;base64,AAAA" style="left: -3px; top: 74px; width: 156px; rotate: -12.25deg; transform: scale(99)">' +
    '<img data-picture-wrap="left" src="data:image/png;base64,AAAB">' +
    '<img data-picture-wrap="unknown" src="data:image/png;base64,AAAC">',
  );
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const block = doc.querySelector<HTMLElement>('[data-note-positioned]')!;
  expect(block.style.top).toBe('420px');
  expect(block.style.position).toBe('');
  const [free, wrapped, invalid] = doc.querySelectorAll('img');
  expect(free.style.left).toBe('-3px');
  expect(free.style.rotate).toBe('-12.25deg');
  expect(free.style.width).toBe('156px');
  expect(free.style.transform).toBe('');
  expect(wrapped.dataset.pictureWrap).toBe('left');
  expect(invalid.dataset.pictureWrap).toBeUndefined();
});
