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
| Sync storage | Workers KV binding `AURA_SYNC_KV` |

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

### Step 3: Build and deploy

```bash
npm run deploy
```

`npm run deploy` runs the typecheck and Vite build, then deploys the Worker with `wrangler` (pinned to v4, matching CI), so the published assets and the Worker code are always in sync.

Wrangler prints the deployed URL and a Version ID, for example:

```
https://aura-notes-pwa.gazarxperia.workers.dev
```

The app is live at that URL immediately; installed PWAs pick up the new service worker on their next launch (`vite-plugin-pwa` is configured with `registerType: 'autoUpdate'`).

### Cross-Device Sync

Sync is anonymous and key-based, with no accounts or sign-in:

1. Open the app, choose **Enable Cross-Device Sync**, and copy the generated vault key (8–128 characters of letters, numbers, dashes, or underscores).
2. Open `https://aura-notes-pwa.gazarxperia.workers.dev/?sync=YOUR_VAULT_KEY` on the second device — the key is adopted automatically and the query param is stripped from the URL.
3. Both devices now merge notes into the same vault, last-write-wins per note, with deletions tracked as tombstones.

Because the vault key is the only credential, treat it like a password: anyone holding it can read and write that vault.

### Push the Source to GitHub (deploys through CI)

`main` deploys itself. Every push to `main` runs `.github/workflows/deploy.yml`, which:

1. checks the Cloudflare secrets are present and fails fast with an actionable message when they are not,
2. installs dependencies, runs `npm test` and `npm run build`,
3. deploys the Worker with `cloudflare/wrangler-action` (`command: deploy`), reading `wrangler.jsonc`.

The workflow can also be run by hand from **Actions → Deploy Cloudflare Worker → Run workflow**. It is gated on tests and the production build, so a failing check publishes nothing.

Two repository secrets are required (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token from the **Edit Cloudflare Workers** template (Cloudflare → My Profile → API Tokens) |
| `CLOUDFLARE_ACCOUNT_ID` | The account id printed by `npx wrangler whoami` |

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
