/**
 * Client helpers for the site's self-hosted Better Auth instance.
 *
 * Everything goes through the site's own origin: the session lives in an
 * HttpOnly cookie set by the Worker, so no token is ever readable here.
 */

export interface AuthUser {
  /** Stable identity for this account. All note records are keyed on it. */
  id: string;
  email: string;
  name: string;
  image?: string | null;
  emailVerified?: boolean;
}

export type AuthSession =
  | { status: 'signed-in'; user: AuthUser }
  | { status: 'signed-out' }
  | { status: 'unavailable' }; // auth routes absent (plain Vite dev) or not configured

export interface AuthConfig {
  /** False when the Worker has no database/secret, so sign-in cannot work. */
  available: boolean;
  /** True when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured. */
  google: boolean;
}

export type AuthActionResult = { ok: true } | { ok: false; message: string };

const AUTH_BASE = '/api/auth';
const CONFIG_URL = '/api/auth-config';

function hasJsonBody(response: Response): boolean {
  return (response.headers.get('content-type') || '').includes('application/json');
}

function normalizeUser(value: Record<string, unknown>): AuthUser | null {
  if (typeof value.id !== 'string' || !value.id) return null;
  return {
    id: value.id,
    email: typeof value.email === 'string' ? value.email : '',
    name: typeof value.name === 'string' ? value.name : '',
    image: typeof value.image === 'string' ? value.image : null,
    emailVerified: value.emailVerified === true
  };
}

export async function fetchAuthSession(): Promise<AuthSession> {
  try {
    const response = await fetch(`${AUTH_BASE}/get-session`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });

    // In `vite dev` there is no Worker, so the SPA fallback answers with HTML.
    if (response.status === 404 || !hasJsonBody(response)) {
      return { status: 'unavailable' };
    }
    // 503 means the Worker is running but auth is not configured.
    if (response.status === 503) {
      return { status: 'unavailable' };
    }
    // Other failures (rate limiting, a transient 5xx) are not configuration
    // problems, so keep offering the form instead of hiding the panel.
    if (!response.ok) {
      return { status: 'signed-out' };
    }

    const data = await response.json();
    if (!data || !data.user) return { status: 'signed-out' };

    const user = normalizeUser(data.user as Record<string, unknown>);
    return user ? { status: 'signed-in', user } : { status: 'signed-out' };
  } catch {
    return { status: 'unavailable' };
  }
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const response = await fetch(CONFIG_URL, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok || !hasJsonBody(response)) {
      return { available: false, google: false };
    }
    const data = await response.json();
    return { available: data?.available === true, google: data?.google === true };
  } catch {
    return { available: false, google: false };
  }
}

async function authPost(path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${AUTH_BASE}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

async function failureMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    const message = data?.message || data?.error;
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // Fall through to the generic message.
  }
  if (response.status === 429) return 'Too many attempts. Please wait a minute and try again.';
  return fallback;
}

export async function signUpWithEmail(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthActionResult> {
  try {
    const response = await authPost('/sign-up/email', {
      name: input.name,
      email: input.email,
      password: input.password
    });
    if (!response.ok) {
      return {
        ok: false,
        message: await failureMessage(response, 'Could not create your account. Please try again.')
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
  }
}

export async function signInWithEmail(input: {
  email: string;
  password: string;
}): Promise<AuthActionResult> {
  try {
    const response = await authPost('/sign-in/email', {
      email: input.email,
      password: input.password
    });
    if (!response.ok) {
      return {
        ok: false,
        message: await failureMessage(response, 'Invalid email or password.')
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
  }
}

/**
 * Starts the Google OAuth flow. On success the browser leaves this page for
 * Google and returns to the app once the callback has set a session cookie.
 */
export async function signInWithGoogle(returnTo?: string): Promise<AuthActionResult> {
  const path =
    returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  const callbackURL = new URL(path, window.location.origin).toString();

  try {
    const response = await authPost('/sign-in/social', {
      provider: 'google',
      callbackURL
    });
    if (!response.ok) {
      return {
        ok: false,
        message: await failureMessage(response, 'Google sign-in is not available right now.')
      };
    }
    const data = await response.json();
    if (!data || typeof data.url !== 'string' || !data.url) {
      return { ok: false, message: 'Google sign-in did not return a redirect URL.' };
    }
    window.location.assign(data.url);
    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
  }
}

export async function signOutOfAccount(): Promise<void> {
  const response = await fetch(`${AUTH_BASE}/sign-out`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: '{}'
  });
  // The caller keeps the signed-in view when this throws, so surface non-2xx
  // responses instead of reloading with the session still active.
  if (!response.ok) {
    throw new Error(`Sign out failed (${response.status})`);
  }
}

export async function changeAccountPassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<AuthActionResult> {
  try {
    const response = await authPost('/change-password', {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      revokeOtherSessions: true
    });
    if (!response.ok) {
      return {
        ok: false,
        message: await failureMessage(response, 'Could not change your password.')
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
  }
}

export function displayNameFor(user: AuthUser): string {
  return user.name?.trim() || user.email?.trim() || 'Signed in';
}