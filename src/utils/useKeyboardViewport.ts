import { useEffect, useState } from 'react';

export function useKeyboardViewport() {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const root = document.getElementById('root');
    const viewport = window.visualViewport;
    if (!root || !viewport) return;
    let width = window.innerWidth;
    let fullHeight = Math.max(window.innerHeight, viewport.height);
    let open = false;
    let frame = 0;

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
      const next = Math.abs(viewport.scale - 1) < 0.05 && (open || acceptsText) && fullHeight - viewport.height > 100;
      if (next) {
        root.style.setProperty('--app-height', `${viewport.height}px`);
        root.style.setProperty('--app-top', `${viewport.offsetTop}px`);
        root.dataset.keyboardOpen = 'true';
      } else if (open) {
        delete root.dataset.keyboardOpen;
        root.style.removeProperty('--app-height');
        root.style.removeProperty('--app-top');
      }
      if (open !== next) {
        open = next;
        setKeyboardOpen(next);
      }
      if (!next || !(focused instanceof HTMLElement) || !focused.isContentEditable) return;
      const desk = focused.closest<HTMLElement>('.note-desk');
      if (!desk) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (document.activeElement !== focused || !selection?.rangeCount || !focused.contains(selection.anchorNode)) return;
        const caret = selection.getRangeAt(0).getBoundingClientRect();
        const bounds = desk.getBoundingClientRect();
        if (caret.bottom > bounds.bottom - 12) desk.scrollTop += caret.bottom - bounds.bottom + 12;
        else if (caret.height && caret.top < bounds.top + 12) desk.scrollTop -= bounds.top + 12 - caret.top;
      });
    };

    window.addEventListener('resize', update);
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    document.addEventListener('focusin', update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      document.removeEventListener('focusin', update);
      delete root.dataset.keyboardOpen;
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--app-top');
    };
  }, []);

  return keyboardOpen;
}
