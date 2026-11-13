export interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  title: string;
  tags: string[];
  color: string;
  content: string;
}

const BLANK: NoteTemplate = {
  id: 'blank',
  name: 'Blank Note',
  description: 'Start from a clean page',
  title: 'Untitled Note',
  tags: [],
  color: '#3b82f6',
  content: ''
};

export const NOTE_TEMPLATES: NoteTemplate[] = [
  BLANK,
  {
    id: 'meeting',
    name: 'Meeting Notes',
    description: 'Agenda, decisions, and action items',
    title: 'Meeting Notes',
    tags: ['Meeting'],
    color: '#8b5cf6',
    content: `
      <h2>Meeting Notes</h2>
      <p><strong>Date:</strong> <br/><strong>Attendees:</strong> </p>
      <h3>Agenda</h3>
      <ul><li></li></ul>
      <h3>Discussion</h3>
      <p></p>
      <h3>Decisions</h3>
      <ul><li></li></ul>
      <h3>Action Items</h3>
      <ul><li><strong>Owner:</strong> — <em>due</em></li></ul>
    `
  },
  {
    id: 'daily',
    name: 'Daily Journal',
    description: 'Reflect, plan, and capture the day',
    title: 'Daily Journal',
    tags: ['Journal'],
    color: '#10b981',
    content: `
      <h2>Daily Journal</h2>
      <p><strong>Three things I'm grateful for</strong></p>
      <ul><li></li><li></li><li></li></ul>
      <h3>Today's focus</h3>
      <p></p>
      <h3>Notes &amp; ideas</h3>
      <p></p>
      <h3>Tomorrow</h3>
      <ul><li></li></ul>
    `
  },
  {
    id: 'sketch',
    name: 'Sketch Pad',
    description: 'Blank canvas for stylus drawing',
    title: 'Sketch',
    tags: ['Sketch'],
    color: '#f59e0b',
    content: ''
  },
  {
    id: 'checklist',
    name: 'Checklist',
    description: 'A simple task list',
    title: 'Checklist',
    tags: ['Tasks'],
    color: '#ef4444',
    content: `
      <h2>Checklist</h2>
      <ul>
        <li>☐ </li>
        <li>☐ </li>
        <li>☐ </li>
      </ul>
    `
  }
];

export function getNoteTemplate(id?: string | null): NoteTemplate {
  return NOTE_TEMPLATES.find((t) => t.id === id) || BLANK;
}
