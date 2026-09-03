/**
 * Picking out one polity by putting the others away.
 *
 * The map colours objects by polity, which answers "what holds this" one object
 * at a time. It does not answer the other direction — "where is this polity" —
 * because a colour among forty colours is not findable by eye. The Sagittarius
 * Sphere and the Solar Dominion are two blues, forty parsecs apart on screen and
 * four degrees apart in hue, and no legend fixes that.
 *
 * The answer is subtraction, not addition. Adding a mark around the polity's
 * holdings marks them **twice** — they already carry its colour — and the eye
 * has to learn a new symbol to read something the map was already saying. Taking
 * the other thirty-nine down instead leaves the one wanted set drawn exactly as
 * it always was, in its own colour, in its own place, and lets everything else
 * stay on screen as context rather than being hidden.
 *
 * So this is a *gain*, not a filter: an unfocused object is dimmed, never
 * dropped. A polity's holdings mean nothing without the sphere around them, and
 * a map that empties when you ask it a question has answered a different one.
 *
 * Shaped like layers/epoch.ts, and for the same reason: three layers draw polity
 * colour — the settled rings, the clusters and the H II regions — and a dimming
 * that behaved differently in each would read as three separate effects.
 */

/** What an object outside the chosen polity is multiplied by. */
export const UNFOCUSED_DIM = 0.14;

/**
 * Per-object membership and the dimming factor.
 *
 * `aFocus` is 1 for a member and 0 for everything else, and is only meaningful
 * while `uFocusDim` is below 1 — with no polity chosen the uniform sits at 1 and
 * the attribute is ignored, so nothing has to be rewritten to clear a selection.
 */
export const FOCUS_PARS = /* glsl */ `
  attribute float aFocus;

  uniform float uFocusDim;

  float focusGain() {
    return mix(uFocusDim, 1.0, aFocus);
  }
`;

export interface FocusUniforms {
  uFocusDim: { value: number };
}

export function focusUniforms(): FocusUniforms {
  return { uFocusDim: { value: 1.0 } };
}
