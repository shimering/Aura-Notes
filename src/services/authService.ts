/**
 * Client helpers for Sign in with Freebuff.
 *
 * These only ever call the site's own origin: the session lives in an
 * HttpOnly cookie set by the Worker, so no token is ever readable here.
 */

export interface FreebuffUser {
  /** Stable identity for this visitor in this project. Key all records on it. */
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export type FreebuffSession =
  | { status: 'signed-in'; user: FreebuffUser }
  | { status: 'signed-out' }
  | { status: 'unavailable' }; // auth routes absent (local Vite dev, or not configured)

const SESSION_URL = '/auth/freebuff/session';

export async function fetchFreebuffSession(): Promise<FreebuffSession> {
  try {
    const response = await fetch(SESSION_URL, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });

    // In `vite dev` there is no Worker, so the SPA fallback answers with HTML.
    const contentType = response.headers.get('content-type') || '';
    if (response.status === 404 || !contentType.includes('application/json')) {
      return { status: 'unavailable' };
    }
    if (!response.ok) {
      return { status: 'unavailable' };
    }

    const data = await response.json();
    const user = data?.user;
    if (user && typeof user.sub === 'string' && user.sub) {
      return { status: 'signed-in', user };
    }
    return { status: 'signed-out' };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * Only same-origin paths are allowed as a return target; the session cookie is
 * host-only, so an absolute URL would silently land signed out.
 */
export function buildSignInUrl(returnTo?: string): string {
  const path =
    returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  return `/auth/freebuff/signin?returnTo=${encodeURIComponent(path)}`;
}

/** Sign-out is a same-origin POST; the Worker revokes the session at Freebuff. */
export async function signOutOfFreebuff(): Promise<void> {
  await fetch('/auth/freebuff/signout', {
    method: 'POST',
    credentials: 'same-origin'
  });
}

export function displayNameFor(user: FreebuffUser): string {
  return user.name?.trim() || user.email?.trim() || 'Signed in';
}
