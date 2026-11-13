import { describe, it, expect } from 'vitest';
import { 
  generateRandomVaultKey, 
  isValidVaultKey,
  mergeNotes, 
  mergeSettings, 
  parseVaultJson,
  pruneTombstones
} from './syncService';
import { Note } from '../types/note';
import { DEFAULT_SETTINGS } from '../types/settings';

describe('Cross-Device Sync Service', () => {
  it('generates formatted random vault keys', () => {
    const key = generateRandomVaultKey();
    expect(key).toMatch(/^aura-sync-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    expect(isValidVaultKey(key)).toBe(true);
  });

  it('rejects malformed vault keys', () => {
    expect(isValidVaultKey('short')).toBe(false);
    expect(isValidVaultKey('aura sync key')).toBe(false);
    expect(isValidVaultKey('aura-sync-ok-key')).toBe(true);
    expect(isValidVaultKey('')).toBe(false);
  });

  it('prunes expired tombstones but keeps recent deletions', () => {
    const now = 100 * 24 * 60 * 60 * 1000;
    const pruned = pruneTombstones(
      {
        recent: now - 5 * 24 * 60 * 60 * 1000,
        old: now - 120 * 24 * 60 * 60 * 1000
      },
      now
    );
    expect(pruned).toHaveProperty('recent');
    expect(pruned).not.toHaveProperty('old');
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

  it('protects drawn ink strokes from being overwritten by equal-timestamp empty notes', () => {
    const noteWithDrawing: Note = {
      id: 'note-1',
      title: 'Drawing Note',
      content: '',
      inkStrokes: [
        {
          id: 'stroke-1',
          points: [{ x: 10, y: 10, pressure: 0.5, time: 100 }],
          color: '#000000',
          width: 4,
          tool: 'pen'
        }
      ],
      tags: [],
      color: '#3b82f6',
      createdAt: 1000,
      updatedAt: 2000
    };

    const emptyNoteSameTime: Note = {
      id: 'note-1',
      title: 'Drawing Note',
      content: '',
      inkStrokes: [],
      tags: [],
      color: '#3b82f6',
      createdAt: 1000,
      updatedAt: 2000
    };

    // When remote has no strokes and same updatedAt, local drawings are preserved
    const merged1 = mergeNotes([noteWithDrawing], [emptyNoteSameTime]);
    expect(merged1[0].inkStrokes.length).toBe(1);

    // Conversely, when remote has drawings and local has none, remote drawings win
    const merged2 = mergeNotes([emptyNoteSameTime], [noteWithDrawing]);
    expect(merged2[0].inkStrokes.length).toBe(1);
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
