import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, LogIn, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import {
  buildSignInUrl,
  displayNameFor,
  fetchFreebuffSession,
  signOutOfFreebuff,
  FreebuffUser
} from '../services/authService';

type PanelState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: FreebuffUser }
  | { status: 'signing-out' }
  | { status: 'error'; message: string };

interface AccountPanelProps {
  /** Current session from the app shell; omit to let the panel fetch it. */
  user?: FreebuffUser | null;
  /** Called after a successful sign-out so the app can swap namespaces. */
  onSignedOut?: () => void;
}

/**
 * Optional account section inside the sync modal. Notes stay local and
 * editable while signed out; signing in switches the app to that visitor's
 * account namespace (D1 metadata + R2 payloads).
 */
export const AccountPanel: React.FC<AccountPanelProps> = ({ user, onSignedOut }) => {
  const [state, setState] = useState<PanelState>({ status: 'loading' });

  useEffect(() => {
    if (user !== undefined) {
      setState(user ? { status: 'signed-in', user } : { status: 'signed-out' });
      return;
    }

    let cancelled = false;
    fetchFreebuffSession().then((session) => {
      if (cancelled) return;
      if (session.status === 'signed-in') {
        setState({ status: 'signed-in', user: session.user });
      } else {
        setState({ status: session.status });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (state.status === 'loading' || state.status === 'unavailable') {
    return null;
  }

  const handleSignOut = async () => {
    setState({ status: 'signing-out' });
    try {
      await signOutOfFreebuff();
      setState({ status: 'signed-out' });
      onSignedOut?.();
    } catch {
      setState({ status: 'error', message: 'Could not sign out. Check your connection and try again.' });
    }
  };

  return (
    <div className="p-5 rounded-3xl bg-surface-subtle-light/70 dark:bg-surface-subtle-dark/70 border border-surface-subtle-light dark:border-surface-subtle-dark space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold text-sm text-ink-light dark:text-ink-dark flex items-center gap-2">
          <UserRound className="w-4 h-4 text-violet-500" />
          Your Account
        </h4>
        <span className="text-[10px] uppercase tracking-wider text-ink-muted-light dark:text-ink-muted-dark">
          Sign in with Freebuff
        </span>
      </div>

      {state.status === 'signed-in' && (
        <>
          <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink-light dark:text-ink-dark truncate">
                {displayNameFor(state.user)}
              </p>
              {state.user.email && state.user.name && (
                <p className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark truncate">
                  {state.user.email}
                </p>
              )}
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-ink-light dark:text-ink-dark bg-surface-subtle-light dark:bg-surface-subtle-dark hover:bg-surface-subtle-light/80 dark:hover:bg-surface-subtle-dark/80 border border-surface-subtle-light dark:border-surface-subtle-dark transition active:scale-95"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>
          <p className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark flex items-start gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
            <span>
              Identity comes from Freebuff (Google, GitHub or Apple). While you're signed in, notes
              sync to your account's Cloudflare storage and stay available offline on this device.
            </span>
          </p>
        </>
      )}

      {state.status === 'signed-out' && (
        <>
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
            Sign in to keep your notes in your own Cloudflare-backed account and open them on any
            device. Notes still save locally while signed out.
          </p>
          <a
            href={buildSignInUrl(window.location.pathname + window.location.search)}
            className="w-full py-2.5 px-4 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs shadow-md transition active:scale-95 flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            <span>Sign in with Freebuff</span>
          </a>
        </>
      )}

      {state.status === 'signing-out' && (
        <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Signing out...</span>
        </p>
      )}

      {state.status === 'error' && (
        <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{state.message}</span>
        </p>
      )}
    </div>
  );
};
