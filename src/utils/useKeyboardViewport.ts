import { useEffect, useState } from 'react';

export function useKeyboardViewport() {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const root = document.getElementById('root');
    const viewport = window.visualViewport;
    if (!root || !viewport) return;
    const touchWebKit = navigator.maxTouchPoints > 0 && window.CSS?.supports('-webkit-touch-callout', 'none');
    const standaloneWebKit = touchWebKit && window.matchMedia('(display-mode: standalone)').matches;
    let width = window.innerWidth;
    let fullHeight = Math.max(window.innerHeight, viewport.height);
    let open = false;
    let viewportFrame = 0;
    let layoutFrame = 0;

    const update = () => {
      const focused = document.activeElement;
      const acceptsText = !!focused?.matches(
        '[contenteditable="true"], textarea, input:not([type]), input:is([type="text"], [type="email"], [type="search"], [type="password"], [type="number"], [type="tel"], [type="url"])',
      );
      if (width !== window.innerWidth) {
        width = window.innerWidth;
        fullHeight = Math.max(window.innerHeight, viewport.height);
      }
      if (!acceptsText && !open) fullHeight = Math.max(window.innerHeight, viewport.height);
      else fullHeight = Math.max(fullHeight, window.innerHeight, viewport.height);
      const unzoomed = Math.abs(viewport.scale - 1) < 0.05;
      const next = unzoomed && (open || acceptsText) && fullHeight - viewport.height > 100;
      if (standaloneWebKit) {
        let reservedBottom = 0;
        if (!next && unzoomed && width < 640 && screen.height > screen.width &&
          Math.abs(viewport.offsetTop) < 1 && Math.abs(window.innerHeight - viewport.height) < 2) {
          const missingHeight = screen.height - viewport.height;
          // Some portrait Home Screen apps lose exactly the status bar height
          // below the viewport but still report the full bottom safe area.
          // https://bugs.webkit.org/show_bug.cgi?id=313800
          if (missingHeight >= 44 && Math.abs(missingHeight - parseFloat(getComputedStyle(root).paddingTop)) < 2) {
            reservedBottom = missingHeight;
          }
        }
        if (reservedBottom) root.style.setProperty('--phone-toolbar-reserved-bottom', `${reservedBottom}px`);
        else root.style.removeProperty('--phone-toolbar-reserved-bottom');
      }
      // A standalone WebKit view can report different CSS and visual viewport
      // heights even with the keyboard closed. Use the measured drawable height.
      if (next || (standaloneWebKit && unzoomed)) {
        root.style.setProperty('--app-height', `${viewport.height}px`);
      } else if (open) {
        root.style.removeProperty('--app-height');
      }
      if (next) {
        root.style.setProperty('--app-top', `${viewport.offsetTop}px`);
        root.style.setProperty('--app-bottom', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
        root.dataset.keyboardOpen = 'true';
      } else if (open) {
        delete root.dataset.keyboardOpen;
        root.style.removeProperty('--app-top');
        root.style.removeProperty('--app-bottom');
        if (touchWebKit) {
          cancelAnimationFrame(layoutFrame);
          layoutFrame = requestAnimationFrame(() => {
            // iPadOS can leave the document shifted after the keyboard closes.
            if (!open && document.scrollingElement) document.scrollingElement.scrollTop = 0;
          });
        }
      }
      if (open !== next) {
        open = next;
        setKeyboardOpen(next);
      }
      if (next) revealCaret();
    };

    const revealCaret = () => {
      const focused = document.activeElement;
      if (!open || !(focused instanceof HTMLElement) || !focused.isContentEditable) return;
      const desk = focused.closest<HTMLElement>('.note-desk');
      if (!desk) return;
      cancelAnimationFrame(layoutFrame);
      layoutFrame = requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (document.activeElement !== focused || !selection?.rangeCount || !focused.contains(selection.anchorNode)) return;
        const caret = selection.getRangeAt(0).getBoundingClientRect();
        if (!caret.height) return;
        const bounds = desk.getBoundingClientRect();
        if (caret.bottom > bounds.bottom - 12) desk.scrollTop += caret.bottom - bounds.bottom + 12;
        else if (caret.top < bounds.top + 12) desk.scrollTop -= bounds.top + 12 - caret.top;
      });
    };

    // WebKit can dispatch the resize event before the new dimensions are readable.
    const onViewportChange = touchWebKit ? () => {
      cancelAnimationFrame(viewportFrame);
      viewportFrame = requestAnimationFrame(update);
    } : update;
    window.addEventListener('resize', onViewportChange);
    viewport.addEventListener('resize', onViewportChange);
    viewport.addEventListener('scroll', onViewportChange);
    document.addEventListener('focusin', onViewportChange);
    document.addEventListener('input', revealCaret);
    document.addEventListener('selectionchange', revealCaret);
    update();
    return () => {
      cancelAnimationFrame(viewportFrame);
      cancelAnimationFrame(layoutFrame);
      window.removeEventListener('resize', onViewportChange);
      viewport.removeEventListener('resize', onViewportChange);
      viewport.removeEventListener('scroll', onViewportChange);
      document.removeEventListener('focusin', onViewportChange);
      document.removeEventListener('input', revealCaret);
      document.removeEventListener('selectionchange', revealCaret);
      delete root.dataset.keyboardOpen;
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--app-top');
      root.style.removeProperty('--app-bottom');
      root.style.removeProperty('--phone-toolbar-reserved-bottom');
    };
  }, []);

  return keyboardOpen;
}
