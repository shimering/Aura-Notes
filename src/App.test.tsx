// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { rememberOfflineAccount, readOfflineAccountId } from './services/authService';
import {
  __resetStorageForTests, getNoteById, saveNote, setStorageNamespace
} from './services/storage';
import { saveSettings } from './services/syncService';
import type { Note } from './types/note';

vi.mock('./components/InkCanvas', () => ({
  InkCanvas: ({ textLayer }: { textLayer: ReactNode }) => textLayer,
}));

function note(id: string, title = id): Note {
  return {
    id, title, content: '<p>A note</p>', tags: [], inkStrokes: [], color: '',
    createdAt: 1000, updatedAt: 2000,
  };
}

const accountUser = { id: 'test-account', name: 'Note owner', email: 'owner@example.test' };

describe('note persistence in the workspace', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/get-session') return Response.json(null);
      if (url === '/api/auth-config') return Response.json({ available: true });
      return Response.json({}, { status: 404 });
    }));
    await __resetStorageForTests();
    await saveSettings({ syncVaultKey: '', autoSyncEnabled: true });
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function mount() {
    await act(async () => root.render(<App />));
  }

  function button(label: string): HTMLButtonElement {
    const match = [...container.querySelectorAll('button')].find((el) => el.textContent?.trim() === label);
    if (!match) throw new Error(`No button labeled "${label}"`);
    return match;
  }

  it('persists rapid changes to two different notes', async () => {
    await saveNote(note('first'));
    await saveNote(note('second'));
    await mount();

    const pins = [...container.querySelectorAll<HTMLButtonElement>('[title="Pin to top"]')];
    expect(pins).toHaveLength(2);
    await act(async () => {
      for (const pin of pins) pin.click();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect((await getNoteById('first'))?.pinned).toBe(true);
    expect((await getNoteById('second'))?.pinned).toBe(true);
  });

  it('persists a remote vault deletion and keeps an unrelated edit made during sync', async () => {
    await saveNote(note('vault-deleted'));
    await saveNote(note('keep-edit'));
    await saveSettings({ syncVaultKey: 'fixture-vault' });
    let reply!: (value: Response) => void;
    const syncResponse = new Promise<Response>((resolve) => { reply = resolve; });
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/auth/get-session') return Response.json(null);
      if (url === '/api/auth-config') return Response.json({ available: true });
      if (url === '/api/sync/vault/fixture-vault') return syncResponse;
      return Response.json({}, { status: 404 });
    });
    await mount();
    expect(container.textContent).toContain('vault-deleted');
    const heading = [...container.querySelectorAll('h3')].find((el) => el.textContent === 'keep-edit');
    const pin = heading?.parentElement?.querySelector<HTMLButtonElement>('[title="Pin to top"]');
    expect(pin).toBeDefined();
    await act(async () => pin?.click());
    await act(async () => {
      reply(Response.json({ notes: [note('keep-edit')], deletedNoteIds: ['vault-deleted'] }));
      await syncResponse;
    });

    expect(container.textContent).not.toContain('vault-deleted');
    expect(await getNoteById('vault-deleted')).toBeUndefined();
    expect((await getNoteById('keep-edit'))?.pinned).toBe(true);
  });

  it('opens cached account notes only by choice and resumes sync for the verified owner', async () => {
    await saveNote(note('device-notebook'));
    setStorageNamespace(accountUser.id);
    await saveNote(note('cached-account-note'));
    setStorageNamespace(null);
    rememberOfflineAccount(accountUser.id);
    let user: typeof accountUser | undefined;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/auth/get-session') {
        return user ? Response.json({ user }) : Response.json({}, { status: 503 });
      }
      if (url === '/api/auth-config') return Response.json({ available: true });
      if (url === '/api/notes') return Response.json({ notes: [] });
      if (url.startsWith('/api/notes/watch')) return Response.json({}, { status: 404 });
      if (url.startsWith('/api/notes/')) return Response.json({ ok: true });
      return Response.json({}, { status: 404 });
    });

    await mount();
    expect(container.textContent).not.toContain('cached-account-note');
    await act(async () => button('Open cached account notes').click());
    expect(container.textContent).toContain('cached-account-note');
    expect(container.textContent).not.toContain('device-notebook');
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/notes'))).toBe(false);

    user = { ...accountUser, id: 'different-account' };
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(container.textContent).toContain('Sync is paused');
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/notes'))).toBe(false);

    user = accountUser;
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(container.textContent).not.toContain('Sync is paused');
    expect(fetch).toHaveBeenCalledWith('/api/notes', expect.objectContaining({
      headers: expect.objectContaining({ 'X-Aura-Account': accountUser.id })
    }));
  });

  it('clears cached access when the server confirms sign-out', async () => {
    rememberOfflineAccount(accountUser.id);
    await saveNote(note('device-notebook'));
    await mount();
    expect(container.textContent).toContain('device-notebook');
    expect(readOfflineAccountId()).toBeNull();
  });
});
