# ✨ Aura Notes - Stylus & Scribble PWA Studio

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Cloudflare%20Edge-success?style=for-the-badge&logo=cloudflare)](https://aura-notes-pwa.gazarxperia.workers.dev)

> **Live Application URL:** [https://aura-notes-pwa.gazarxperia.workers.dev](https://aura-notes-pwa.gazarxperia.workers.dev)

An elegant, minimalist note-taking Progressive Web App (PWA) designed for **Samsung Galaxy Tab (S Pen)**, **iPad (Apple Pencil)**, and desktop keyboards. It bridges natural, low-latency, pressure-sensitive handwriting with multi-color rich text editing and intelligent **Scribble-to-Text** handwriting recognition.

---

## 🌟 Key Features

### 🖋️ 1. First-Class Stylus & Pen Support (S Pen & Apple Pencil)
- **120Hz Coalesced Event Loop:** Captures every intermediate micro-point with `getCoalescedEvents()` for buttery smooth, zero-latency drawing on 120Hz iPad ProMotion and Galaxy Tab AMOLED screens.
- **Pressure Sensitivity:** Real dynamic stroke thickness based on `e.pressure`.
- **Fountain Pen & Ballpoint:** Calligraphic Bézier spline smoothing with custom velocity and pressure curves.
- **Highlighter:** Semi-transparent watercolor multiply blending.
- **Intelligent Palm Rejection:** Rest your hand comfortably on the screen while writing; touch gestures are ignored while the stylus is active.
- **Hardware Button & Eraser Tip Detection:** Click your Samsung S Pen barrel button or flip your Apple Pencil to instantly switch to the eraser.

### 🪄 2. Scribble to Text (Handwriting Recognition)
- **Offline Client-Side OCR:** Powered by an on-device Tesseract.js worker with stroke boundary normalization and contrast thresholding.
- **One-Tap Conversion:** Draw handwriting on the canvas and tap **Scribble to Text** to convert ink into clean typed text and insert it directly into your note!
- **Optional Gemini AI Enhancement:** Provide an optional Gemini API key in the modal for intelligent transcription of complex handwriting, equations, and formatted markdown tables.
- **Native OS Scribble:** In keyboard mode, iPadOS Apple Pencil Scribble and Samsung S Pen Handwriting-to-Text work natively inside note text fields.

### ⌨️ 3. Multi-Color Rich Text Keyboard Editor
- **Vibrant Color Palette:** Curated modern color swatches for text colors and background highlights, plus a custom hex color picker.
- **Formatting Tools:** Bold, italic, underline, strikethrough, Headings (H1, H2), bullet lists, numbered lists, blockquotes, and dividers.
- **Clean Typography:** Elegant, serene aesthetic with generous line spacing and clean dark/light themes.

### 📱 4. Installable Progressive Web App (PWA)
- **100% Offline Resilience:** Operates with local-first IndexedDB storage; notes and strokes are preserved without cloud reliance.
- **Home Screen Installation:** Install as a standalone native-feeling application on iPadOS, Android, Windows, and macOS.

---

## 🚀 Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Start local development server
npm run dev

# 3. Run unit tests
npm test

# 4. Build production PWA
npm run build
```

`npm run dev` serves the app on `http://localhost:5173` and includes a dev middleware that emulates the Worker's `/api/sync/vault/:key` endpoint, so cross-device sync can be exercised locally without a Cloudflare account.

---

## 🌐 Deploy to Cloudflare Workers

Production is a **Cloudflare Worker** (`src/worker.ts`), not a static Pages project. The Worker serves the Vite build as static assets **and** handles the sync API, with vault data stored in a Workers KV namespace.

| Piece | Where it lives |
| --- | --- |
| Worker entry | `src/worker.ts` |
| Worker config | `wrangler.jsonc` (mirrored by `wrangler.toml`) |
| Static assets | `dist/` (built by `npm run build`), served through the `ASSETS` binding with SPA fallback |
| Anonymous vault storage | Workers KV binding `AURA_SYNC_KV` |
| Account records + Better Auth tables | D1 binding `DB` (database `aura-notes`) |
| Signed-in note payloads | R2 binding `NOTES_BUCKET` (bucket `aura-notes-storage`) |

### Step 1: Sign in with Wrangler

```bash
npx wrangler login
```

### Step 2: Create the sync KV namespace (first deployment only)

```bash
npx wrangler kv namespace create AURA_SYNC_KV
```

Copy the returned namespace `id` into `kv_namespaces` in `wrangler.jsonc` (and the identical entry in `wrangler.toml`). Both config files are kept in sync — update both if you change either.

If no `AURA_SYNC_KV` binding is present, the Worker still runs but falls back to an in-memory store: sync appears to work and then silently loses data whenever the isolate is recycled. Always bind KV in production.

### Step 3: Create the D1 database and R2 bucket (first deployment only)

```bash
npx wrangler d1 create aura-notes
npx wrangler r2 bucket create aura-notes-storage
```

Copy the D1 `database_id` into `d1_databases` (`binding: "DB"`) and the bucket name into `r2_buckets` (`binding: "NOTES_BUCKET"`) in **both** `wrangler.jsonc` and `wrangler.toml`.

Then apply the account and auth schema:

```bash
npx wrangler d1 execute aura-notes --remote --file migrations/0001_accounts.sql
npx wrangler d1 execute aura-notes --remote --file migrations/0002_better_auth.sql
```

Both migrations are idempotent (`CREATE TABLE IF NOT EXISTS`), so they are safe to re-run. Without the `DB` / `NOTES_BUCKET` bindings the app still runs for signed-out visitors, but `/api/notes` returns `503 storage_not_configured`.

### Step 4: Configure sign-in (Better Auth)

Auth runs inside the Worker and stores users and sessions in D1. `BETTER_AUTH_SECRET` is required; the two Google secrets enable the "Continue with Google" button:

| Secret | Value |
| --- | --- |
| `BETTER_AUTH_SECRET` | Random string, at least 32 characters (`openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID` | Google OAuth **Web application** client ID (optional) |
| `GOOGLE_CLIENT_SECRET` | Matching Google OAuth client secret (optional) |

```bash
npx wrangler secret put BETTER_AUTH_SECRET
# Optional, enables Google sign-in:
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

In **Google Cloud Console → APIs & Services → Credentials**, create an OAuth client of type **Web application** and add these authorized redirect URIs:

```
https://aura-notes-pwa.gazarxperia.workers.dev/api/auth/callback/google
http://localhost:8787/api/auth/callback/google
```

Email/password sign-in works without Google credentials; the Google button hides itself when the two Google secrets are absent. Without `BETTER_AUTH_SECRET` (or the `DB` binding) the Worker reports auth as unavailable and the app stays local-only.

For local testing, create `.dev.vars` (git-ignored) with the same values and run `npm run dev:worker`. Plain `npm run dev` serves Vite without the Worker, so `/api/auth/*` and `/api/notes` do not exist there.

### Step 5: Build and deploy

```bash
npm run deploy
```

`npm run deploy` runs the typecheck and Vite build, then deploys the Worker with `wrangler` (pinned to v4, matching CI), so the published assets and the Worker code are always in sync.

Wrangler prints the deployed URL and a Version ID, for example:

```
https://aura-notes-pwa.gazarxperia.workers.dev
```

The app is live at that URL immediately; installed PWAs pick up the new service worker on their next launch (`vite-plugin-pwa` is configured with `registerType: 'autoUpdate'`).

### Accounts (Better Auth, per-user sync)

Signing in is **optional**. The app is fully usable offline and signed out; notes then live in this browser's local storage, and the anonymous vault key (below) still works.

Accounts are self-hosted with **Better Auth** inside the Worker. Email/password and Google sign-in are supported; there is no email provider, so there is no email verification and no self-service password reset (change the password from the account panel while signed in).

While signed in, notes sync to that account's own Cloudflare storage:

| Piece | Where it lives |
| --- | --- |
| Identity | Better Auth inside the Worker; `aura.session_token` HttpOnly cookie |
| Users, sessions, linked OAuth accounts, rate limits | D1 `user`, `session`, `account`, `verification`, `rateLimit` |
| Note metadata (title, tags, pin, timestamps, tombstones) | D1 `notes`, keyed by Better Auth `user.id` |
| Full note payload (rich text + ink strokes) | R2 `users/<user id>/notes/<note id>.json` |

Behaviour and guarantees:

1. **Each account starts empty.** Notes already on the device are *not* uploaded on first sign-in; they stay in the signed-out local namespace. The account gets its own local IndexedDB namespace too, so switching accounts never mixes notes.
2. Sync is last-write-wins per note with tombstones for deletions, and runs on load, after edits, when the tab becomes visible, and from **Sync Now**.
3. Offline edits stay in IndexedDB and upload when the connection returns.
4. `/api/notes` is auth-required: every request returns `401` when signed out, and writes must be same-origin (`403` otherwise). The Worker keys all rows on the session's `user.id`; no user id is accepted from the request.
5. Signing out reloads the app back into the device's signed-out notes.
6. Accounts created with the previous Freebuff integration are **not** migrated. Their D1 rows, R2 objects, and local namespaces are left untouched but are no longer reachable.
7. Password accounts are not auto-linked to a same-email Google sign-in (`disableImplicitLinking`), because email addresses are unverified.

Client code: `src/services/authService.ts` (sign-in/out), `src/services/accountSyncService.ts` (sync), `src/services/storage.ts` (`setStorageNamespace`), and `src/App.tsx` (bootstrap + sync triggers). Server code: `src/auth.ts` (Better Auth config) and `handleNotesApi` in `src/worker.ts`.

### Cross-Device Sync

Vault-key sync needs no account. It is anonymous and key-based:

1. Open the app, choose **Enable Cross-Device Sync**, and copy the generated vault key (8–128 characters of letters, numbers, dashes, or underscores).
2. Open `https://aura-notes-pwa.gazarxperia.workers.dev/?sync=YOUR_VAULT_KEY` on the second device — the key is adopted automatically and the query param is stripped from the URL.
3. Both devices now merge notes into the same vault, last-write-wins per note, with deletions tracked as tombstones.

Because the vault key is the only credential, treat it like a password: anyone holding it can read and write that vault.

While signed in, account sync replaces vault-key sync (the vault key is kept in settings and resumes after signing out).

### Push the Source to GitHub (deploys through GitHub Actions)

`main` deploys itself. Every push to `main` runs **`.github/workflows/deploy.yml`**, which checks the repository out on GitHub's runner, installs dependencies with `npm ci`, runs `npm test` and `npm run build` (so a failing test publishes nothing), then deploys with `cloudflare/wrangler-action`. `npx wrangler deploy` reads `wrangler.jsonc`, so the Worker name, `assets` directory, bindings, and `run_worker_first` setting all come from the repository — no build variables are needed. Node is pinned to 22 in the workflow. Run logs live under the repository's **Actions** tab.

Two repository secrets are required (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token from the **Edit Cloudflare Workers** template (Cloudflare → My Profile → API Tokens) |
| `CLOUDFLARE_ACCOUNT_ID` | The account id printed by `npx wrangler whoami` |

The workflow can also be started by hand (Actions → Deploy Cloudflare Worker → Run workflow). Cloudflare's **Workers Builds** Git integration is intentionally *not* connected: when it was linked to the wrong repository it produced stale deployments, so all deploys go through this single pipeline.

Pushes that add or edit files under `.github/workflows/` additionally need a GitHub credential with the `workflow` scope; ordinary source pushes do not.

A first push of a fresh clone looks like:

```bash
git remote add origin https://github.com/<YOUR_USERNAME>/Aura-Notes.git
git branch -M main
git push -u origin main
```

For a one-off release without CI, `npm run deploy` performs the same build and deploy from your machine.

`docs/deploy-cloudflare.yml` is a legacy Cloudflare **Pages** sample (`pages deploy dist`) kept for history only; it does not match this Worker setup and must not be moved into `.github/workflows/`.

---

## 📲 Installing on Your Tablet

### On iPad (Apple Pencil):
1. Open the deployed Cloudflare URL in **Safari**.
2. Tap the **Share** button (box with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**.
4. Launch Aura Notes from your home screen for full-screen stylus inking!

### On Samsung Galaxy Tab (S Pen):
1. Open the deployed Cloudflare URL in **Google Chrome** or **Samsung Internet**.
2. Tap the **Install** icon in the address bar, or tap the **Menu (⋮)** and select **Install App** / **Add to home screen**.
3. Enjoy full 120Hz latency-free S Pen writing!
