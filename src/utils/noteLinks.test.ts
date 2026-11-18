import { describe, expect, it } from 'vitest';
import { endsWord, findNoteLinks, isNoteLink, toNoteLinkHref } from './noteLinks';

describe('note links', () => {
  it('detects web addresses with their offsets', () => {
    const links = findNoteLinks('Read https://aura.example/path?a=1 now');
    expect(links).toEqual([
      { index: 5, text: 'https://aura.example/path?a=1', href: 'https://aura.example/path?a=1' },
    ]);
  });

  it('completes www addresses and email addresses', () => {
    expect(findNoteLinks('www.example.com')).toEqual([
      { index: 0, text: 'www.example.com', href: 'https://www.example.com' },
    ]);
    expect(findNoteLinks('write to note@example.com')).toEqual([
      { index: 9, text: 'note@example.com', href: 'mailto:note@example.com' },
    ]);
  });

  it('ignores sentence punctuation after a link but keeps balanced brackets', () => {
    expect(findNoteLinks('See https://example.com/a, and https://example.com/b_(c).').map((link) => link.text))
      .toEqual(['https://example.com/a', 'https://example.com/b_(c)']);
  });

  it('autolinks only after a finished word', () => {
    expect(endsWord('insertText', 'https://example.co')).toBe(false);
    expect(endsWord('insertText', ' ')).toBe(true);
    expect(endsWord('insertText', 'done ')).toBe(true);
    expect(endsWord('insertParagraph', null)).toBe(true);
    expect(endsWord('insertLineBreak', null)).toBe(true);
    expect(endsWord('insertFromPaste', 'see https://example.com')).toBe(false);
    expect(endsWord('deleteContentBackward', null)).toBe(false);
  });

  it('leaves plain text and unsafe schemes alone', () => {
    expect(findNoteLinks('version 1.2.3, javascript:alert(1), notes.txt')).toEqual([]);
    expect(isNoteLink('javascript:alert(1)')).toBe(false);
    expect(isNoteLink('data:text/html,hi')).toBe(false);
    expect(isNoteLink('https://example.com')).toBe(true);
    expect(toNoteLinkHref('www.example.com')).toBe('https://www.example.com');
  });
});
