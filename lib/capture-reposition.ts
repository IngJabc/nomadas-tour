interface RepositionStyles {
  position: string;
  left: string;
  top: string;
  zIndex: string;
  pointerEvents: string;
  opacity: string;
}

function saveStyles(el: HTMLElement): RepositionStyles {
  return {
    position: el.style.position,
    left: el.style.left,
    top: el.style.top,
    zIndex: el.style.zIndex,
    pointerEvents: el.style.pointerEvents,
    opacity: el.style.opacity,
  };
}

function restoreStyles(el: HTMLElement, prev: RepositionStyles): void {
  Object.assign(el.style, prev);
}

/**
 * Temporarily repositions an element for off-screen capture,
 * executes the callback, then restores original styles.
 *
 * Agnostic — knows nothing about tickets, reservations, or specific pages.
 * Ready for reuse with BusLayout or any future capture scenario.
 */
export async function withReposition<T>(
  el: HTMLElement,
  fn: () => Promise<T>
): Promise<T> {
  const prev = saveStyles(el);

  el.style.position = 'fixed';
  el.style.left = '0';
  el.style.top = '0';
  el.style.zIndex = '-1';
  el.style.pointerEvents = 'none';
  el.style.opacity = '1';

  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r))
  );

  try {
    return await fn();
  } finally {
    restoreStyles(el, prev);
  }
}
