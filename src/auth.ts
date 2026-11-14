import { betterAuth, type BetterAuthOptions } from 'better-auth';

/**
 * Self-hosted Better Auth instance for the Worker.
 *
 * Sessions, users and OAuth accounts live in the existing D1 database. The
 * instance is created lazily and cached per isolate, keyed on the values that
 * affect its configuration, so a request never rebuilds the adapter.
 *
 * Auth is optional: when the database or secret is missing the Worker reports
 * auth as unavailable and the app keeps working in local-only mode.
 */

/** Minimal shape Better Auth needs to reach the D1 binding. */
export interface D1BindingLike {
  prepare: (query: string) => unknown;
}

export interface AuthEnv {
  DB?: D1BindingLike;
  /** Canonical site origin, e.g. https://aura-notes-pwa.gazarxperia.workers.dev. */
  APP_ORIGIN?: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export interface AuthConfig {
  auth: ReturnType<typeof betterAuth<any>>;
  /** True when Google OAuth credentials are present. */
  googleEnabled: boolean;
}

/** Better Auth requires a secret of at least 32 characters. */
const MIN_SECRET_LENGTH = 32;

let cached: { key: string; value: AuthConfig } | null = null;

function trim(value: string | undefined): string {
  return (value || '').trim();
}

/**
 * Returns the auth instance for this environment and request origin, or null
 * when auth is not configured.
 *
 * `baseURL` follows the incoming request so `wrangler dev` (localhost) and the
 * deployed Worker both generate matching cookie and OAuth callback URLs.
 */
export function getAuth(env: AuthEnv, requestOrigin: string): AuthConfig | null {
  const secret = trim(env.BETTER_AUTH_SECRET);
  if (!env.DB || secret.length < MIN_SECRET_LENGTH) return null;

  const origin = trim(requestOrigin).replace(/\/+$/, '');
  if (!origin) return null;

  const googleClientId = trim(env.GOOGLE_CLIENT_ID);
  const googleClientSecret = trim(env.GOOGLE_CLIENT_SECRET);
  const googleEnabled = Boolean(googleClientId && googleClientSecret);

  const appOrigin = trim(env.APP_ORIGIN).replace(/\/+$/, '');
  const trustedOrigins = Array.from(new Set([origin, appOrigin].filter(Boolean)));

  const cacheKey = [
    secret,
    origin,
    appOrigin,
    googleEnabled ? googleClientId : '',
    googleEnabled ? googleClientSecret : ''
  ].join('|');

  if (cached && cached.key === cacheKey) return cached.value;

  const options = {
    appName: 'Aura Notes',
    baseURL: origin,
    secret,
    database: env.DB as never,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      // No email provider is configured, so verification cannot be delivered.
      requireEmailVerification: false
    },
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret
          }
        }
      : undefined,
    account: {
      accountLinking: {
        // Without email verification, a password account must never be taken
        // over by a same-email Google sign-in. Linking stays explicit.
        disableImplicitLinking: true
      }
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24
    },
    advanced: {
      cookiePrefix: 'aura',
      ipAddress: {
        // Cloudflare always sets this header and overwrites client values.
        ipAddressHeaders: ['cf-connecting-ip']
      }
    },
    rateLimit: {
      // In-memory limits do not survive across Worker isolates; D1 does.
      enabled: true,
      storage: 'database',
      modelName: 'rateLimit',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 10 },
        '/sign-in/social': { window: 60, max: 10 }
      }
    }
  } satisfies BetterAuthOptions;

  const auth = betterAuth(options);

  const value: AuthConfig = { auth, googleEnabled };
  cached = { key: cacheKey, value };
  return value;
}