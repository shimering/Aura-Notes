import { expect, it, vi } from 'vitest';
import worker from './worker';

vi.mock('./auth', () => ({
  getAuth: () => ({ auth: { api: { getSession: async () => ({ user: { id: 'current-account' } }) } } }),
}));

it('rejects a sync request from a tab still showing another account', async () => {
  const prepare = vi.fn();
  const put = vi.fn();
  const response = await worker.fetch(new Request('https://notes.example.test/api/notes/note-1', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://notes.example.test',
      'X-Aura-Account': 'previous-account',
    },
    body: JSON.stringify({ id: 'note-1', title: 'Offline note' }),
  }), {
    ASSETS: { fetch: vi.fn() },
    DB: { prepare },
    NOTES_BUCKET: { put, get: vi.fn(), delete: vi.fn() },
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ code: 'auth_required' });
  expect(prepare).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});
