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

---

## 🌐 Deploy to GitHub & Cloudflare Pages

### Step 1: Create a New GitHub Repository
1. Go to [github.com/new](https://github.com/new).
2. Name your repository (e.g. `aura-notes-pwa`).
3. Leave "Initialize this repository with a README" unchecked (we already have everything).
4. Run the following commands in your project terminal:
   ```bash
   git remote add origin https://github.com/<YOUR_USERNAME>/aura-notes-pwa.git
   git branch -M main
   git push -u origin main
   ```

### Step 2: Automated Deployment on Cloudflare Pages

You can choose either of two simple methods:

#### Method A: Direct Cloudflare Pages Git Integration (Recommended - 1 Click!)
1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. In the left navigation, go to **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
3. Select your newly created `aura-notes-pwa` GitHub repository.
4. Set the build configuration:
   - **Framework preset:** `Vite`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
5. Click **Save and Deploy**. Cloudflare Pages will automatically build and deploy your PWA to a fast global edge network on every git push!

#### Method B: GitHub Actions Workflow
The repository includes a ready-to-use GitHub Actions workflow in `.github/workflows/deploy-cloudflare.yml`. To use it:
1. Go to your GitHub repository **Settings** > **Secrets and variables** > **Actions**.
2. Add the following repository secrets:
   - `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token (with Pages edit permissions).
   - `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID (found on your Cloudflare dashboard URL).
3. Every commit pushed to `main` will automatically build, test, and deploy to Cloudflare Pages.

---

## 📲 Installing on Your Tablet

### On iPad (Apple Pencil):
1. Open the deployed Cloudflare URL in **Safari**.
2. Tap the **Share** button (box with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**.
4. Launch Aura Notes from your home screen for full-screen stylus inking!

### On Samsung Galaxy Tab (S Pen):
1. Open the deployed Cloudflare URL in **Google Chrome** or **Samsung Internet**.
2. Tap the **Install** icon in the address bar, or tap the **Menu (⋮)** and select **Install App** / **Add to Home screen**.
3. Enjoy full 120Hz latency-free S Pen writing!
