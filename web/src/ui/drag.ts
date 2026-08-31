/**
 * Letting a panel be moved out of the way.
 *
 * The panels are laid out by a grid that gives each one a share of the screen,
 * which is the right default and a poor last word: the share that fits a
 * desktop is half the height of a laptop, and a reader who wants the map under
 * the panel has no way to ask for it.
 *
 * Dragging takes a panel out of the grid and pins it where it was left. Only
 * the first drag does that — after it the panel is positioned absolutely and
 * every later drag just moves it — so the grid keeps arranging everything the
 * reader has not touched.
 */

/** Keep a dragged panel from being left where it cannot be grabbed again. */
const EDGE_MARGIN = 24;

/**
 * Make `panel` draggable by `handle`.
 *
 * Buttons, sliders and selects inside the handle keep working: a drag starts
 * only on the handle's own surface, so a title bar with a switch in it is both
 * a switch and a grip.
 */
export function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  let dragging = false;

  handle.style.cursor = 'move';
  handle.style.touchAction = 'none';

  handle.addEventListener('pointerdown', (event) => {
    // Anything interactive inside the bar is itself, not a grip.
    if ((event.target as HTMLElement).closest('button, input, select, a')) return;

    const box = panel.getBoundingClientRect();
    // Out of the grid, at exactly the place the grid had put it: measuring
    // first and pinning to that leaves the panel visually where it was, so the
    // drag starts from under the pointer rather than jumping to a corner.
    panel.style.position = 'fixed';
    panel.style.margin = '0';
    panel.style.left = `${box.left}px`;
    panel.style.top = `${box.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.maxWidth = `${box.width}px`;

    startX = event.clientX;
    startY = event.clientY;
    originX = box.left;
    originY = box.top;
    dragging = true;
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const width = panel.offsetWidth;
    // Clamped so a panel can always be grabbed again. Dropped past the bottom
    // of the window its title bar goes with it, and there is no way back.
    const x = Math.min(
      Math.max(originX + event.clientX - startX, EDGE_MARGIN - width),
      window.innerWidth - EDGE_MARGIN,
    );
    const y = Math.min(
      Math.max(originY + event.clientY - startY, 0),
      window.innerHeight - EDGE_MARGIN,
    );
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  });

  const end = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
