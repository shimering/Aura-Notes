/** A link the app created and is willing to open from a note. */
export const noteLinkHref = /^(?:https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>@]+@[^\s"'<>]+)$/i;

const email = /[\w.!#$%&'*+/=?^`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/i;
const website = /(?:https?:\/\/|www\.)[^\s<>"'`]+/i;
const trailingMarks = '.,;:!?…\'"”’';
const closing = { ')': '(', ']': '[', '}': '{' } as const;

export interface NoteLink {
  /** Offset of the link inside the scanned string. */
  index: number;
  /** Link text exactly as it appears in the note. */
  text: string;
  /** Absolute href, with a scheme the app can open. */
  href: string;
}

function trimEnd(text: string): string {
  let end = text.length;
  while (end > 0 && trailingMarks.includes(text[end - 1])) end--;
  // Keep a closing bracket only when it pairs with one inside the link.
  while (end > 0) {
    const last = text[end - 1] as keyof typeof closing;
    if (!(last in closing)) break;
    const slice = text.slice(0, end);
    const opens = slice.split(closing[last]).length - 1;
    const closes = slice.split(last).length - 1;
    if (closes <= opens) break;
    end--;
  }
  return text.slice(0, end);
}

export function toNoteLinkHref(text: string): string {
  if (/^www\./i.test(text)) return `https://${text}`;
  return email.test(text) && !/^https?:/i.test(text) ? `mailto:${text}` : text;
}

/** True for hrefs the app itself links to and can open. */
export function isNoteLink(href: string): boolean {
  return noteLinkHref.test(href);
}

/**
 * Input events that finish a word, the only ones that autolink while typing:
 * a space or a line break. Paste, leaving the box and page load run their own
 * pass, so mid-word keystrokes never rewrite the text or the undo history.
 */
export function endsWord(inputType: string, data: string | null): boolean {
  if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') return true;
  return inputType === 'insertText' && !!data && /\s$/.test(data);
}

/** Finds bare web addresses and email addresses in plain note text. */
export function findNoteLinks(text: string): NoteLink[] {
  const links: NoteLink[] = [];
  const pattern = new RegExp(`${website.source}|\\b${email.source}`, 'gi');
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const trimmed = trimEnd(match[0]);
    if (!trimmed) continue;
    const href = toNoteLinkHref(trimmed);
    if (!isNoteLink(href)) continue;
    links.push({ index: start, text: trimmed, href });
  }
  return links;
}
