import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Mail,
  ShieldCheck,
  UserRound,
  UserPlus
} from 'lucide-react';
import {
  AuthUser,
  changeAccountPassword,
  displayNameFor,
  fetchAuthSession,
  signInWithEmail,
  signInWithGoogle,
  signOutOfAccount,
  signUpWithEmail
} from '../services/authService';

type PanelState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: AuthUser }
  | { status: 'signing-out'; user: AuthUser };

type FormMode = 'sign-in' | 'sign-up';

interface AccountPanelProps {
  /** Current session from the app shell; omit to let the panel fetch it. */
  user?: AuthUser | null;
  /** Hides the Google button when OAuth credentials are not configured. */
  googleEnabled?: boolean;
  /** Called after a successful sign-in or sign-up so the app can swap namespaces. */
  onSignedIn?: () => void;
  /** Called after a successful sign-out so the app can swap namespaces. */
  onSignedOut?: () => void;
}

/**
 * Optional account section inside the sync modal. Notes stay local and
 * editable while signed out; signing in switches the app to that account's
 * namespace (D1 metadata + R2 payloads).
 */
export const AccountPanel: React.FC<AccountPanelProps> = ({
  user,
  googleEnabled = false,
  onSignedIn,
  onSignedOut
}) => {
  const [state, setState] = useState<PanelState>({ status: 'loading' });

  const [mode, setMode] = useState<FormMode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (user !== undefined) {
      setState(user ? { status: 'signed-in', user } : { status: 'signed-out' });
      return;
    }

    let cancelled = false;
    fetchAuthSession().then((session) => {
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

  const resetFeedback = () => {
    setFormError(null);
    setPasswordError(null);
    setPasswordNotice(null);
  };

  const switchMode = (next: FormMode) => {
    setMode(next);
    resetFeedback();
  };

  const handleSignOut = async () => {
    if (state.status !== 'signed-in') return;
    const signedInUser = state.user;
    setState({ status: 'signing-out', user: signedInUser });
    try {
      await signOutOfAccount();
      onSignedOut?.();
    } catch {
      setState({ status: 'signed-in', user: signedInUser });
      setFormError('Could not sign out. Check your connection and try again.');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    resetFeedback();

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setFormError('Enter your email and password.');
      return;
    }
    if (mode === 'sign-up' && password.length < 8) {
      setFormError('Use at least 8 characters for your password.');
      return;
    }

    setSubmitting(true);
    const result =
      mode === 'sign-up'
        ? await signUpWithEmail({ name: name.trim() || trimmedEmail, email: trimmedEmail, password })
        : await signInWithEmail({ email: trimmedEmail, password });
    setSubmitting(false);

    if (!result.ok) {
      setFormError(result.message);
      return;
    }

    setPassword('');
    onSignedIn?.();
  };

  const handleGoogle = async () => {
    resetFeedback();
    setSubmitting(true);
    const result = await signInWithGoogle(window.location.pathname + window.location.search);
    setSubmitting(false);
    if (!result.ok) {
      setFormError(result.message);
    }
    // On success the browser navigates to Google, so there is nothing else to do.
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordNotice(null);

    if (newPassword.length < 8) {
      setPasswordError('Use at least 8 characters for the new password.');
      return;
    }

    setPasswordBusy(true);
    const result = await changeAccountPassword({ currentPassword, newPassword });
    setPasswordBusy(false);

    if (!result.ok) {
      setPasswordError(result.message);
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    setPasswordNotice('Password updated. Other devices were signed out.');
  };

  if (state.status === 'signed-in' || state.status === 'signing-out') {
    const signedInUser = state.user;
    const signingOut = state.status === 'signing-out';
    return (
      <div className="p-5 rounded-3xl bg-surface-subtle-light/70 dark:bg-surface-subtle-dark/70 border border-surface-subtle-light dark:border-surface-subtle-dark space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-semibold text-sm text-ink-light dark:text-ink-dark flex items-center gap-2">
            <UserRound className="w-4 h-4 text-violet-500" />
            Your Account
          </h4>
          <span className="text-[10px] uppercase tracking-wider text-ink-muted-light dark:text-ink-muted-dark">
            Signed in
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark">
          <div className="min-w-0 flex items-center gap-2.5">
            {signedInUser.image ? (
              <img
                src={signedInUser.image}
                alt=""
                className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-300 flex items-center justify-center text-xs font-bold flex-shrink-0">
                {(signedInUser.name || signedInUser.email || '?').trim().charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink-light dark:text-ink-dark truncate">
                {displayNameFor(signedInUser)}
              </p>
              {signedInUser.email && (
                <p className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark truncate">
                  {signedInUser.email}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-ink-light dark:text-ink-dark bg-surface-subtle-light dark:bg-surface-subtle-dark hover:bg-surface-subtle-light/80 dark:hover:bg-surface-subtle-dark/80 border border-surface-subtle-light dark:border-surface-subtle-dark transition active:scale-95 flex-shrink-0 disabled:opacity-50"
          >
            {signingOut ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LogOut className="w-3.5 h-3.5" />
            )}
            <span>{signingOut ? 'Signing out...' : 'Sign out'}</span>
          </button>
        </div>

        {formError && (
          <p className="text-[11px] text-rose-600 dark:text-rose-400 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{formError}</span>
          </p>
        )}

        <button
          onClick={() => {
            setShowPasswordChange((open) => !open);
            setFormError(null);
            setPasswordError(null);
            setPasswordNotice(null);
          }}
          className="text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1.5"
        >
          <KeyRound className="w-3.5 h-3.5" />
          <span>{showPasswordChange ? 'Hide password form' : 'Change password'}</span>
        </button>

        {showPasswordChange && (
          <form onSubmit={handleChangePassword} className="space-y-2">
            <div className="relative">
              <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted-light dark:text-ink-muted-dark" />
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark outline-none focus:ring-2 focus:ring-violet-500 text-ink-light dark:text-ink-dark"
              />
            </div>
            <div className="relative">
              <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted-light dark:text-ink-muted-dark" />
              <input
                type="password"
                autoComplete="new-password"
                placeholder="New password (8+ characters)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark outline-none focus:ring-2 focus:ring-violet-500 text-ink-light dark:text-ink-dark"
              />
            </div>
            <button
              type="submit"
              disabled={passwordBusy}
              className="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {passwordBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>{passwordBusy ? 'Updating...' : 'Update password'}</span>
            </button>
          </form>
        )}

        {passwordNotice && (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-start gap-1.5">
            <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{passwordNotice}</span>
          </p>
        )}
        {passwordError && (
          <p className="text-[11px] text-rose-600 dark:text-rose-400 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{passwordError}</span>
          </p>
        )}

        <p className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark flex items-start gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
          <span>
            While you're signed in, notes sync to your account's Cloudflare storage and stay available
            offline on this device.
          </span>
        </p>
      </div>
    );
  }

  const busy = submitting;

  return (
    <div className="p-5 rounded-3xl bg-surface-subtle-light/70 dark:bg-surface-subtle-dark/70 border border-surface-subtle-light dark:border-surface-subtle-dark space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold text-sm text-ink-light dark:text-ink-dark flex items-center gap-2">
          <UserRound className="w-4 h-4 text-violet-500" />
          Your Account
        </h4>
        <span className="text-[10px] uppercase tracking-wider text-ink-muted-light dark:text-ink-muted-dark">
          {mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </span>
      </div>

      <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
        Sign in to keep your notes in your own Cloudflare-backed account and open them on any
        device. Notes still save locally while signed out.
      </p>

      <form onSubmit={handleSubmit} className="space-y-2">
        {mode === 'sign-up' && (
          <div className="relative">
            <UserRound className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted-light dark:text-ink-muted-dark" />
            <input
              type="text"
              autoComplete="name"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark outline-none focus:ring-2 focus:ring-violet-500 text-ink-light dark:text-ink-dark"
            />
          </div>
        )}

        <div className="relative">
          <Mail className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted-light dark:text-ink-muted-dark" />
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark outline-none focus:ring-2 focus:ring-violet-500 text-ink-light dark:text-ink-dark"
          />
        </div>

        <div className="relative">
          <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted-light dark:text-ink-muted-dark" />
          <input
            type="password"
            required
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            placeholder={mode === 'sign-up' ? 'Password (8+ characters)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark outline-none focus:ring-2 focus:ring-violet-500 text-ink-light dark:text-ink-dark"
          />
        </div>

        {formError && (
          <p className="text-[11px] text-rose-600 dark:text-rose-400 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{formError}</span>
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full py-2.5 px-4 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs shadow-md transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : mode === 'sign-up' ? (
            <UserPlus className="w-4 h-4" />
          ) : (
            <LogIn className="w-4 h-4" />
          )}
          <span>
            {busy
              ? 'Please wait...'
              : mode === 'sign-up'
                ? 'Create account'
                : 'Sign in with email'}
          </span>
        </button>
      </form>

      <button
        type="button"
        onClick={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
        className="w-full text-[11px] text-ink-muted-light dark:text-ink-muted-dark hover:text-violet-600 dark:hover:text-violet-400 transition"
      >
        {mode === 'sign-in'
          ? "Don't have an account? Create one"
          : 'Already have an account? Sign in'}
      </button>

      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-ink-muted-light dark:text-ink-muted-dark">
            <span className="flex-1 h-px bg-surface-subtle-light dark:bg-surface-subtle-dark" />
            <span>or</span>
            <span className="flex-1 h-px bg-surface-subtle-light dark:bg-surface-subtle-dark" />
          </div>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={busy}
            className="w-full py-2.5 px-4 rounded-2xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark font-semibold text-xs transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
              />
            </svg>
            <span>Continue with Google</span>
          </button>
        </>
      )}
    </div>
  );
};