/**
 * Stop the browser zooming the page when the reader means to zoom the map.
 *
 * The bug this exists for, as a user described it: "depending on where the
 * mouse is placed near the centre, you zoom in to the 3d map, or I zoom into
 * the whole screen and the interface."
 *
 * That is exactly what the layout does. OrbitControls is attached to the canvas
 * and calls preventDefault on the wheel events it receives, so a pinch over the
 * middle of the screen zooms the map. But the HUD panels sit on top of the
 * canvas with `pointer-events: auto`, and they line three edges of the window —
 * so over any of them the event never reaches the canvas at all. The browser
 * gets it instead, and a pinch means page zoom. The reader has done one gesture
 * and got two different behaviours depending on a pixel.
 *
 * A trackpad pinch arrives as a `wheel` event with `ctrlKey` set — that is how
 * every browser has reported it for a decade, and it is indistinguishable from
 * a genuine control-scroll, which is fine because both mean "zoom" and neither
 * should ever zoom the document over a map. Safari also sends its own
 * `gesture*` events, which need refusing separately or it will zoom anyway.
 *
 * Listening on the window in the capture phase, so the panels never get first
 * refusal, and with `passive: false`, without which preventDefault is ignored
 * and the whole thing silently does nothing.
 */

/** How much of a wheel delta becomes zoom. Matched to OrbitControls' feel. */
const WHEEL_SENSITIVITY = 0.008;

/** Safari's gesture scale is absolute; this converts a change in it to a factor. */
const GESTURE_SENSITIVITY = 0.6;

/**
 * Where an ordinary wheel already means something, and must be left alone.
 *
 * Over the canvas OrbitControls has it, and turning it here as well would zoom
 * twice a notch. Over a panel it is that panel scrolling, which is what the
 * reader wants and what the timeline and the legend are built to do.
 *
 * Everything else on screen is an overlay lying *over the map*: a star's own
 * name, which is a real button because clicking it selects the star, and which
 * therefore swallowed the wheel. The reported symptom was exact — the scroll
 * wheel stopped working whenever the pointer was over a clickable star. From
 * the reader's side there is no overlay there at all, only the map, so the
 * wheel has to do what it does over the map.
 */
const WHEEL_BELONGS_TO = 'canvas, .panel';

/**
 * Whether the pointer is over the map rather than over something with its own
 * use for a wheel.
 *
 * Duck-typed rather than tested against `Element`, so the handler can be
 * exercised without a DOM. An event with no target at all — which is what a
 * bare synthetic event looks like — counts as not ours, leaving the ordinary
 * wheel untouched, which is the safe way round.
 */
function overTheMap(target: EventTarget | null): boolean {
  const node = target as { closest?: (selectors: string) => unknown } | null;
  if (typeof node?.closest !== 'function') return false;
  return node.closest(WHEEL_BELONGS_TO) === null;
}

export interface ZoomTarget {
  zoomBy(factor: number): void;
}

/**
 * Just enough of a Window to attach to.
 *
 * Structural rather than `Window` so the behaviour can be tested without a DOM:
 * this file is a bug fix, and a bug fix nothing exercises is a bug fix nobody
 * will notice regressing.
 */
export interface GestureRoot {
  addEventListener(
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ): void;
}

/**
 * Route every zoom gesture to the map, wherever the pointer is.
 *
 * Returns a function that removes the listeners again.
 */
export function captureZoomGestures(
  target: ZoomTarget,
  root: GestureRoot = window,
): () => void {
  const onWheel = (event: WheelEvent): void => {
    // A pinch is always zoom, wherever it lands. A plain wheel is zoom only
    // where nothing else has a use for it — see WHEEL_BELONGS_TO.
    if (!event.ctrlKey && !overTheMap(event.target)) return;
    event.preventDefault();
    // Down-swipe zooms out, matching the wheel and every map ever made.
    target.zoomBy(Math.exp(event.deltaY * WHEEL_SENSITIVITY));
  };

  // Safari's pinch. `scale` is cumulative from the start of the gesture, so
  // only the change since the last event is a zoom step.
  let lastScale = 1;
  const onGestureStart = (event: Event): void => {
    event.preventDefault();
    lastScale = 1;
  };
  const onGestureChange = (event: Event): void => {
    event.preventDefault();
    const scale = (event as Event & { scale?: number }).scale;
    if (!scale || scale <= 0) return;
    target.zoomBy((lastScale / scale) ** GESTURE_SENSITIVITY);
    lastScale = scale;
  };
  const onGestureEnd = (event: Event): void => event.preventDefault();

  const options = { passive: false, capture: true } as const;
  root.addEventListener('wheel', onWheel as EventListener, options);
  root.addEventListener('gesturestart', onGestureStart, options);
  root.addEventListener('gesturechange', onGestureChange, options);
  root.addEventListener('gestureend', onGestureEnd, options);

  return () => {
    root.removeEventListener('wheel', onWheel as EventListener, options);
    root.removeEventListener('gesturestart', onGestureStart, options);
    root.removeEventListener('gesturechange', onGestureChange, options);
    root.removeEventListener('gestureend', onGestureEnd, options);
  };
}
