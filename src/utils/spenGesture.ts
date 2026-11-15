/** The tip and side button have independent lifecycles, even when the browser
 * overloads the primary bit for both (Samsung hovering in Chromium). */
export function createSpenGesture({
  holdMs,
  onEraser,
  onDoublePress
}: {
  holdMs: () => number;
  onEraser: (active: boolean) => void;
  onDoublePress: () => void;
}) {
  type Source = 'key' | 'barrel' | 'hover-primary';
  let press: { source: Source; started: number; delay: number; armed: boolean } | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let possibleReleaseAt: number | null = null;
  let lastClick: number | null = null;
  let tipDown = false;
  let lastTipLift = -Infinity;
  let hoverSamples = 0;
  let sawContactBarrel = false;

  const cancelRelease = () => {
    clearTimeout(releaseTimer);
    releaseTimer = undefined;
    possibleReleaseAt = null;
  };
  const finish = (allowClick: boolean) => {
    const now = possibleReleaseAt ?? performance.now();
    cancelRelease();
    clearTimeout(holdTimer);
    if (!press) return;
    const { armed, started, delay } = press;
    press = null;
    sawContactBarrel = false;
    if (armed) onEraser(false);

    if (!allowClick || armed || now - started >= delay) {
      lastClick = null;
    } else if (lastClick !== null && started - lastClick <= 450) {
      lastClick = null;
      onDoublePress();
    } else {
      lastClick = now;
    }
  };

  const scheduleHold = () => {
    clearTimeout(holdTimer);
    if (!press || press.armed) return;
    const remaining = Math.max(0, press.delay - (performance.now() - press.started));
    holdTimer = setTimeout(() => {
      if (!press || possibleReleaseAt !== null) return;
      press.armed = true;
      lastClick = null;
      onEraser(true);
    }, remaining);
  };

  const begin = (source: Source) => {
    const hadPossibleRelease = possibleReleaseAt !== null;
    cancelRelease();
    if (press) {
      if (source === 'key' || (source === 'barrel' && press.source === 'hover-primary')) {
        press.source = source;
      }
      if (hadPossibleRelease) scheduleHold();
      return;
    }
    const delay = holdMs();
    press = { source, started: performance.now(), delay, armed: false };
    scheduleHold();
  };

  const reset = () => {
    finish(false);
    tipDown = false;
    lastTipLift = -Infinity;
    lastClick = null;
    hoverSamples = 0;
  };

  const pointer = (kind: 'down' | 'move' | 'up' | 'cancel', sample: Pick<PointerEvent, 'buttons' | 'button' | 'pressure'>, allowStart = true) => {
    const { buttons, button, pressure } = sample;
    const tipBit = (buttons & 1) !== 0;
    const barrel = (buttons & (2 | 4 | 32)) !== 0;
    const barrelChanged = button === 1 || button === 2 || button === 5;
    const wasDown = tipDown;

    if (kind === 'cancel') {
      // Chromium may cancel the tip stream while the barrel button stays down.
      tipDown = false;
      hoverSamples = 0;
      lastTipLift = performance.now();
      if (possibleReleaseAt !== null) {
        cancelRelease();
        scheduleHold();
      }
      return;
    }

    if (!barrelChanged && kind === 'up') tipDown = false;
    else if (pressure > 0 || (kind === 'down' && button === 0 && !barrel)) tipDown = true;
    else if (kind === 'move' && (!tipBit || button === 0)) tipDown = false;

    if (tipDown || wasDown) hoverSamples = 0;
    if (wasDown && !tipDown) lastTipLift = performance.now();

    // Key events provide explicit edges. Conflicting pointer samples during
    // the same press cannot release it.
    if (press?.source === 'key') return;
    if (barrel && kind !== 'up') {
      if (allowStart || press) {
        begin('barrel');
        if (tipDown) sawContactBarrel = true;
      }
      return;
    }
    if (barrelChanged && !barrel && (kind === 'up' || kind === 'move') && press?.source === 'barrel') {
      finish(true);
      return;
    }

    if (tipDown || wasDown || kind === 'up') {
      // On contact the primary bit does not report the side button. A
      // missing real barrel bit is useful only after it appeared on contact.
      if (tipDown && wasDown && kind === 'move' && sawContactBarrel && press) {
        if (releaseTimer === undefined) {
          possibleReleaseAt = performance.now();
          releaseTimer = setTimeout(() => finish(true), 80);
        }
      } else {
        const hadPossibleRelease = possibleReleaseAt !== null;
        cancelRelease();
        if (hadPossibleRelease) scheduleHold();
      }
      return;
    }

    // Tip lift can briefly leave either a primary or an empty hover sample.
    if (performance.now() - lastTipLift < 100) return;
    if (kind === 'move' && buttons === 1 && pressure === 0) {
      if (press?.source === 'hover-primary') cancelRelease();
      else if (!press && allowStart && ++hoverSamples >= 2) begin('hover-primary');
    } else if (kind === 'move' && buttons === 0) {
      hoverSamples = 0;
      finish(true);
    }
  };

  return {
    get tipDown() { return tipDown; },
    pointer,
    keyDown: () => begin('key'),
    keyUp: () => {
      if (press?.source === 'key') finish(true);
    },
    reset
  };
}
