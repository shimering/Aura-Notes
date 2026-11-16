// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseVaultJson } from '../services/syncService';
import { plainTextToNoteHtml, sanitizeNoteHtml } from './noteHtml';

const note = {
  id: 'sample', title: 'Sample', content: '<p>Some text</p>',
  inkStrokes: [], tags: [], color: '', createdAt: 1000, updatedAt: 2000,
};

describe('safe note content', () => {
  it('keeps editor formatting and strips unsupported elements and attributes', () => {
    const html = '<h2>Heading</h2><ol start="2"><li><strong>Bold</strong></li></ol>' +
      '<p id="extra" onclick="" style="color: red; background-color: yellow; position: fixed">Colored</p>' +
      '<img alt="Unsupported image"><font color="#224466">Legacy color</font>';
    const safe = sanitizeNoteHtml(html);
    const document = new DOMParser().parseFromString(safe, 'text/html');

    expect(document.querySelector('h2')?.textContent).toBe('Heading');
    expect(document.querySelector('ol[start="2"] strong')?.textContent).toBe('Bold');
    expect(document.querySelector('p')?.style.color).toBe('red');
    expect(document.querySelector('p')?.style.backgroundColor).toBe('yellow');
    expect(document.querySelector('p')?.style.position).toBe('');
    expect(document.querySelector('[id], [onclick], img')).toBeNull();
    expect(document.querySelector('font')?.getAttribute('color')).toBe('#224466');
  });

  it('validates drawing records and sanitizes content on backup restore', () => {
    const blob = { notes: [{ ...note, content: '<p>Restored</p><img alt="Unsupported">' }], settings: {
      theme: 'dark', syncVaultKey: 'some-other-vault',
    } };
    const backup = parseVaultJson(JSON.stringify(blob));
    expect(backup.notes[0].content).toBe('<p>Restored</p>');
    expect(backup.settings).toEqual({ theme: 'dark' });
    expect(() => parseVaultJson(JSON.stringify({
      notes: [{ ...note, inkStrokes: [{ id: 'bad-stroke', points: null }] }]
    }))).toThrow('Invalid or duplicate note at position 1');
  });

  it('preserves literal OCR text and line breaks', () => {
    expect(plainTextToNoteHtml('a < b & c > d\r\n<strong>text</strong>'))
      .toBe('a &lt; b &amp; c &gt; d<br>&lt;strong&gt;text&lt;/strong&gt;');
  });
});
