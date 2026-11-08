# Elegant Stylus & Keyboard PWA Notes App - Specification & Architecture

## 1. Executive Summary & Vision
A modern, minimalist, and aesthetically refined Progressive Web App (PWA) note-taking application designed for fluid multi-modal thinking. The app bridges the tactile expressiveness of handwriting with Samsung Galaxy Tab S Pen and Apple iPad Apple Pencil with the structure and speed of keyboard-driven multi-color rich text editing.

## 2. Core User Experience & Principles
1. **Elegant Aesthetic**: Inspired by the clean, serene beauty of Apple Notes, Craft, and Notion. Generous whitespace, refined typography, subtle glassmorphism, smooth animations, and dark/light color themes.
2. **First-Class Stylus Experience**:
   - High-refresh rate (120Hz) coalesced pointer event capture for near-zero latency.
   - Pressure sensitivity for natural fountain pen and ballpoint stroke variation.
   - Intelligent palm rejection so resting hands on the screen never interrupts writing.
   - Hardware button support (Samsung S Pen barrel button and Apple Pencil double-tap/eraser tip).
3. **Seamless Scribble-to-Text**:
   - Convert handwritten scribbles and notes into clean digital text.
   - Runs client-side (offline) with OCR preprocessing and optional AI transcription enhancement.
   - Direct integration: converts selected ink strokes and inserts clean text directly into note cursor position.
4. **Multi-Color Rich Text Engine**:
   - Keyboard typing with dynamic formatting (Headings, bold, italic, code, blockquotes, checklists).
   - Rich color palette for both font color and text highlighting.
5. **Local-First & Offline Resilience**:
   - All notes and vector ink strokes saved instantly to IndexedDB with zero cloud dependency required.
   - Fully installable PWA on iOS, iPadOS, Android, macOS, and Windows.
6. **Automated Cloudflare Pages Deployment**:
   - GitHub Actions workflow deploying to Cloudflare Pages on push to `main`.
   - Ready-to-go `wrangler.toml` configuration.

## 3. Architecture & Technical Decisions
- **Framework**: React 19 + TypeScript + Vite.
- **Styling**: Tailwind CSS with custom glassmorphism and theme variables.
- **Canvas / Ink Engine**:
  - High-DPI scaling (`window.devicePixelRatio`).
  - PointerEvents API: `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, utilizing `e.getCoalescedEvents()` for 120Hz capture.
  - Catmull-Rom spline stroke smoothing with pressure-derived stroke width.
  - Separate stroke layers allowing eraser, undo, and redo.
- **Handwriting Recognition**:
  - Tesseract.js Web Worker for client-side offline OCR.
  - Image preprocessing pipeline: dynamic bounding box cropping, padding, grayscale conversion, and Otsu-style thresholding.
  - Optional Gemini API integration for natural language note conversion.
- **Deployment**:
  - Cloudflare Pages static output directory: `dist/`.
  - GitHub Actions automated CI/CD pipeline.
