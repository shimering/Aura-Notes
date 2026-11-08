import { describe, it, expect } from 'vitest';
import { 
  generateRandomVaultKey, 
  mergeNotes, 
  mergeSettings, 
  parseVaultJson 
} from './syncService';
import { Note } from '../types/note';
import { DEFAULT_SETTINGS } from '../types/settings';

describe('Cross-Device Sync Service', () => {
  it('generates formatted random vault keys', () => {
    const key = generateRandomVaultKey();
    expect(key).toMatch(/^aura-sync-[a-z0-9]{4}-[a-z0-9]{4}$/);
  });

  it('merges notes across devices using Last-Write-Wins and preserves independent notes', () => {
    const localNoteA: Note = {
      id: 'note-1',
      title: 'Local Edit',
      content: 'Edited locally',
      inkStrokes: [],
      tags: [],
      color: '#3b82f6',
      createdAt: 1000,
      updatedAt: 2000
    };

    const remoteNoteA: Note = {
      id: 'note-1',
      title: 'Remote Edit (Newer)',
      content: 'Edited on tablet',
      inkStrokes: [],
      tags: [],
      color: '#3b82f6',
      createdAt: 1000,
      updatedAt: 3000 // Newer
    };

    const remoteNoteB: Note = {
      id: 'note-2',
      title: 'Created on Tablet',
      content: 'Only on tablet',
      inkStrokes: [],
      tags: [],
      color: '#10b981',
      createdAt: 2500,
      updatedAt: 2500
    };

    const localNoteC: Note = {
      id: 'note-3',
      title: 'Created on Laptop',
      content: 'Only on laptop',
      inkStrokes: [],
      tags: [],
      color: '#ef4444',
      createdAt: 2600,
      updatedAt: 2600
    };

    const merged = mergeNotes([localNoteA, localNoteC], [remoteNoteA, remoteNoteB]);
    expect(merged.length).toBe(3);

    // Note 1 should have taken the newer remote version
    const mergedNote1 = merged.find((n) => n.id === 'note-1');
    expect(mergedNote1?.title).toBe('Remote Edit (Newer)');

    // Note 2 and Note 3 should both be preserved
    expect(merged.some((n) => n.id === 'note-2')).toBe(true);
    expect(merged.some((n) => n.id === 'note-3')).toBe(true);
  });

  it('filters out deleted notes using tombstones', () => {
    const noteA: Note = {
      id: 'note-to-delete',
      title: 'Delete me',
      content: '',
      inkStrokes: [],
      tags: [],
      color: '#000',
      createdAt: 1000,
      updatedAt: 2000
    };

    const tombstones = {
      'note-to-delete': 2500 // deleted at t=2500
    };

    const merged = mergeNotes([], [noteA], tombstones);
    expect(merged.length).toBe(0);
  });

  it('merges settings when remote is newer', () => {
    const local = {
      ...DEFAULT_SETTINGS,
      theme: 'light' as const,
      updatedAt: 1000
    };

    const remote = {
      theme: 'dark' as const,
      viewMode: 'ink' as const,
      updatedAt: 2000 // Newer
    };

    const merged = mergeSettings(local, remote);
    expect(merged.theme).toBe('dark');
    expect(merged.viewMode).toBe('ink');
  });

  it('correctly parses and validates vault backup JSON', () => {
    const validJson = JSON.stringify({
      notes: [
        { id: '1', title: 'Note 1', content: 'test', inkStrokes: [], tags: [], color: '#fff', createdAt: 1, updatedAt: 1 }
      ],
      settings: { theme: 'dark' }
    });

    const parsed = parseVaultJson(validJson);
    expect(parsed.notes.length).toBe(1);
    expect(parsed.settings?.theme).toBe('dark');

    expect(() => parseVaultJson('{ "invalid": true }')).toThrow();
  });
});
