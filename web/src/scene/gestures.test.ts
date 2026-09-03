import { describe, expect, it } from 'vitest';

import { type GestureRoot, captureZoomGestures } from './gestures';
import { MAX_TARGET_DISTANCE, MIN_TARGET_DISTANCE } from './viewer';
import { ZOOM_MAX_PC, ZOOM_MIN_PC } from '../ui/hud';

/** A stand-in for the window, so this can be tested without a DOM. */
function fakeRoot() {
  const listeners = new Map<string, { fn: EventListener; options?: AddEventListenerOptions }>();
  const root: GestureRoot = {
    addEventListener: (type, fn, options) => listeners.set(type, { fn, options }),
    removeEventListener: (type) => listeners.delete(type),
  };
  return {
    root,
    listeners,
    /** Fire an event and report whether the handler refused the default. */
    fire(type: string, event: Record<string, unknown>): boolean {
      let prevented = false;
      const entry = listeners.get(type);
      if (!entry) throw new Error(`nothing listening for ${type}`);
      entry.fn({ ...event, preventDefault: () => (prevented = true) } as unknown as Event);
      return prevented;
    },
  };
}

/**
 * A stand-in for whatever the pointer is over: `ancestor` is the selector the
 * real `closest` would match, or null for an element with no interested
 * ancestor at all — a star label, say.
 */
function at(ancestor: string | null) {
  return { closest: (selectors: string) => (ancestor && selectors.includes(ancestor) ? {} : null) };
}

function recorder() {
  const factors: number[] = [];
  return { factors, zoomBy: (factor: number) => factors.push(factor) };
}

describe('zoom gestures reach the map, not the browser', () => {
  it('refuses a pinch and zooms the map instead', () => {
    // The bug, as reported: a pinch over the middle zoomed the map and a pinch
    // over a panel zoomed the whole interface. A trackpad pinch arrives as a
    // wheel event with ctrlKey set, and unless the default is refused the
    // browser takes it as page zoom.
    const map = recorder();
    const dom = fakeRoot();
    captureZoomGestures(map, dom.root);

    expect(dom.fire('wheel', { ctrlKey: true, deltaY: 100 })).toBe(true);
    expect(map.factors).toHaveLength(1);
  });

  it('listens in the capture phase, or the panels get there first', () => {
    // The whole reason the bug existed: the HUD panels sit over the canvas and
    // line three edges of the window, so at the target phase they have already
    // taken the event. Capture is what makes the fix work anywhere on screen.
    const dom = fakeRoot();
    captureZoomGestures(recorder(), dom.root);
    for (const type of ['wheel', 'gesturestart', 'gesturechange', 'gestureend']) {
      expect(dom.listeners.get(type)?.options?.capture).toBe(true);
    }
  });

  it('is not passive, or preventDefault would be ignored', () => {
    // A passive wheel listener cannot refuse the default, and the browser makes
    // wheel listeners passive by default. Getting this wrong is silent: the
    // handler runs, the map zooms, and the page zooms too.
    const dom = fakeRoot();
    captureZoomGestures(recorder(), dom.root);
    expect(dom.listeners.get('wheel')?.options?.passive).toBe(false);
  });

  it('leaves an ordinary wheel alone so panels still scroll', () => {
    // Without ctrl this is somebody reading the timeline or the polity legend,
    // both of which are taller than the screen. Swallowing it would trade one
    // broken gesture for another.
    const map = recorder();
    const dom = fakeRoot();
    captureZoomGestures(map, dom.root);

    expect(dom.fire('wheel', { ctrlKey: false, deltaY: 100 })).toBe(false);
    expect(map.factors).toEqual([]);
  });

  it('zooms when the wheel turns over a star label, not nothing at all', () => {
    // The bug: map labels are real buttons, because clicking one selects the
    // star. A button takes the wheel event, OrbitControls is on the canvas and
    // never sees it, and the map stops zooming wherever a name is written.
    const map = recorder();
    const dom = fakeRoot();
    captureZoomGestures(map, dom.root);

    expect(dom.fire('wheel', { ctrlKey: false, deltaY: 100, target: at(null) })).toBe(true);
    expect(map.factors).toHaveLength(1);
  });

  it('still leaves the canvas and the panels to themselves', () => {
    // The two places a plain wheel already means something: OrbitControls has
    // the canvas, and a panel taller than the screen scrolls.
    const map = recorder();
    const dom = fakeRoot();
    captureZoomGestures(map, dom.root);

    expect(dom.fire('wheel', { ctrlKey: false, deltaY: 100, target: at('canvas') })).toBe(false);
    expect(dom.fire('wheel', { ctrlKey: false, deltaY: 100, target: at('.panel') })).toBe(false);
    expect(map.factors).toEqual([]);
  });

  it('zooms out on a downward swipe and in on an upward one', () => {
    const map = recorder();
    const dom = fakeRoot();
    captureZoomGestures(map, dom.root);

    dom.fire('wheel', { ctrlKey: true, deltaY: 100 });
    dom.fire('wheel', { ctrlKey: true, deltaY: -100 });
    // Range is a standoff, so a factor above 1 is further away.
    expect(map.factors[0]).toBeGreaterThan(1);
    expect(map.factors[1]).toBeLessThan(1);
    // And the two are reciprocal: a swipe and its opposite return you exactly
    // where you started, which multiplicative zoom gives for free and an
    // additive one would not.
    expect(map.factors[0] * map.factors[1]).toBeCloseTo(1, 10);
  });

  it("handles Safari's own pinch, which is not a wheel at all", () => {
    const map = recorder();
    const dom = fakeRoot();
    captureZoomGestures(map, dom.root);

    expect(dom.fire('gesturestart', { scale: 1 })).toBe(true);
    expect(dom.fire('gesturechange', { scale: 2 })).toBe(true);
    // Spreading the fingers means zoom in, which is a smaller standoff.
    expect(map.factors[0]).toBeLessThan(1);
  });

  it('ignores a gesture that reports no scale', () => {
    const map = recorder();
    const dom = fakeRoot();
    captureZoomGestures(map, dom.root);
    dom.fire('gesturestart', { scale: 1 });
    expect(dom.fire('gesturechange', {})).toBe(true);
    expect(map.factors).toEqual([]);
  });

  it('lets go of everything it took', () => {
    const dom = fakeRoot();
    const release = captureZoomGestures(recorder(), dom.root);
    expect(dom.listeners.size).toBe(4);
    release();
    expect(dom.listeners.size).toBe(0);
  });
});

describe('the zoom slider and the wheel agree about how far the map goes', () => {
  it('spans exactly the range the controls are bounded to', () => {
    // Two places state these limits — the slider's ends want to be readable
    // beside the slider, and the controls' want to be readable beside the
    // controls. This is what stops them drifting into disagreement, which
    // would show up as a slider that runs out before the wheel does.
    expect(ZOOM_MIN_PC).toBe(MIN_TARGET_DISTANCE);
    expect(ZOOM_MAX_PC).toBe(MAX_TARGET_DISTANCE);
  });
});
