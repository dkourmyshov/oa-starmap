import { describe, expect, it } from 'vitest';

/**
 * Static checks over the hand-written GLSL.
 *
 * None of these shaders compiles until a browser runs them, and there is no
 * browser in this suite — so a varying used in a fragment shader and declared
 * only in the vertex one is a blank layer discovered by eye, if at all. That
 * exact mistake shipped once: the add-on star field read vBlur and vScale
 * without declaring them, which takes the whole layer out.
 *
 * These are the errors a compiler would catch, read off the source instead.
 * Loaded through Vite's raw imports rather than the filesystem, so the check
 * needs no node typings in a browser project.
 */

const LAYER_SOURCES = import.meta.glob('./*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MAIN = Object.values(
  import.meta.glob('../main.ts', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

const layers = Object.entries(LAYER_SOURCES)
  .filter(([path]) => !path.endsWith('.test.ts'))
  .map(([path, source]) => ({ name: path.replace('./', ''), source }));

function shadersIn(source: string): string[] {
  return [...source.matchAll(/\/\* glsl \*\/ `([\s\S]*?)`/g)].map((m) => m[1]);
}

/** Names the shaders pass from vertex to fragment. */
const VARYINGS = ['vBlur', 'vScale', 'vDim', 'vSharp', 'vGain', 'vFade', 'vSize'];

/** Varyings that are not floats, checked the same way against their own type. */
const TYPED_VARYINGS: [string, string][] = [['vCorner', 'vec2'], ['vUv', 'vec2']];

describe('shader sources', () => {
  it('finds the layers at all', () => {
    // A glob that silently matched nothing would make every check below pass.
    expect(layers.length).toBeGreaterThan(4);
    expect(layers.some(({ source }) => source.includes('${DOF_PARS}'))).toBe(true);
    // Seven layers draw something a year can hide and so take the epoch helper.
    // A filter below that matched none of them would pass while checking
    // nothing, so the count is pinned. A filter
    // below that matched none of them would pass while checking nothing.
    expect(layers.filter(({ source }) => source.includes('${EPOCH_PARS}')).length).toBe(7);
  });

  it('declares every varying each shader actually uses', () => {
    const problems: string[] = [];
    for (const { name, source } of layers) {
      for (const [index, glsl] of shadersIn(source).entries()) {
        for (const varying of VARYINGS) {
          const used = new RegExp(`\\b${varying}\\b`).test(glsl);
          const declared = new RegExp(`varying\\s+float\\s+${varying}\\s*;`).test(glsl);
          if (used && !declared) problems.push(`${name} shader ${index}: ${varying}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('declares every non-float varying too', () => {
    // vCorner carries the quad corner that replaced gl_PointCoord. It is a
    // vec2, so the float sweep above cannot see it, and a fragment shader that
    // used it undeclared would take the whole extent layer out.
    const problems: string[] = [];
    for (const { name, source } of layers) {
      for (const [index, glsl] of shadersIn(source).entries()) {
        for (const [varying, type] of TYPED_VARYINGS) {
          const used = new RegExp(`\\b${varying}\\b`).test(glsl);
          const declared = new RegExp(`varying\\s+${type}\\s+${varying}\\s*;`).test(glsl);
          if (used && !declared) problems.push(`${name} shader ${index}: ${varying}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('gives every shader that projects an extent the corner maths', () => {
    const problems: string[] = [];
    for (const { name, source } of layers) {
      if (name === 'extent.ts') continue;
      for (const [index, glsl] of shadersIn(source).entries()) {
        const calls = /\bextent(Pixels|Corner)\s*\(/.test(glsl);
        if (calls && !glsl.includes('${EXTENT_PARS}')) problems.push(`${name} shader ${index}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('never sizes an extent as a point sprite', () => {
    // The bug this replaced: gl_PointSize is capped by the driver, so past
    // about a thousand pixels the sprite stopped growing while the shader went
    // on scaling the ring down inside it — zooming in made nearby clusters
    // shrink. A layer that projects a physical radius must draw a quad.
    const problems: string[] = [];
    for (const { name, source } of layers) {
      for (const [index, glsl] of shadersIn(source).entries()) {
        if (!glsl.includes('${EXTENT_PARS}')) continue;
        if (/\bgl_PointSize\b/.test(glsl)) problems.push(`${name} shader ${index}: gl_PointSize`);
        if (/\bgl_PointCoord\b/.test(glsl)) problems.push(`${name} shader ${index}: gl_PointCoord`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('gives every shader that calls the depth-of-field helpers their source', () => {
    const problems: string[] = [];
    for (const { name, source } of layers) {
      // dof.ts is where the helpers are written, not a shader that calls them.
      if (name === 'dof.ts') continue;
      for (const [index, glsl] of shadersIn(source).entries()) {
        const calls = /\bdof(Decades|BlurPx|Gain|Dim)\s*\(/.test(glsl);
        // The helpers arrive by interpolating DOF_PARS into the shader string.
        if (calls && !glsl.includes('${DOF_PARS}')) problems.push(`${name} shader ${index}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('exposes the uniforms wherever a layer takes the depth-of-field source', () => {
    // A layer that spreads DOF_PARS into its shader but never exposes the
    // uniforms would compile, draw, and quietly stay sharp for ever.
    const problems: string[] = [];
    for (const { name, source } of layers) {
      if (name === 'dof.ts' || !source.includes('${DOF_PARS}')) continue;
      if (!source.includes('dofUniforms()')) problems.push(`${name}: no uniforms`);
      if (!/get dof\(\)/.test(source)) problems.push(`${name}: no accessor`);
      // The flat depth axis rides on the same uniforms. A layer that took the
      // helpers and computed its own defocus would compile and stay sharp in
      // the plan view while every other layer softened around it.
      for (const glsl of shadersIn(source)) {
        if (glsl.includes('${DOF_PARS}') && !/\bdofDecades\s*\(/.test(glsl)) {
          problems.push(`${name}: computes defocus without dofDecades`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('registers every such layer with the shared settings in main', () => {
    const missing = layers
      .filter(({ name, source }) => name !== 'dof.ts' && source.includes('${DOF_PARS}'))
      .map(({ name }) => name.replace('.ts', ''))
      .filter((layer) => !new RegExp(`dof\\.register\\([^)]*${layer}`).test(MAIN));
    expect(missing).toEqual([]);
  });
  it('gives every shader that calls the epoch helper its source', () => {
    // Same failure as the depth-of-field helpers, one file along: a layer that
    // called epochGain without spreading EPOCH_PARS would not compile, and a
    // layer that spread them and never set the uniforms would draw every year
    // at once while claiming to show one.
    const problems: string[] = [];
    for (const { name, source } of layers) {
      if (name === 'epoch.ts') continue;
      for (const [index, glsl] of shadersIn(source).entries()) {
        const calls = /\bepochGain\s*\(/.test(glsl);
        if (calls && !glsl.includes('${EPOCH_PARS}')) problems.push(`${name} shader ${index}`);
      }
      if (source.includes('${EPOCH_PARS}') && !source.includes('epochUniforms()')) {
        problems.push(`${name}: no uniforms`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('drops a place outside the year rather than fading it', () => {
    // A colony that has not been founded is absent, not faint. Every layer
    // taking the epoch helper must collapse its geometry when the gain is zero;
    // multiplying it into an alpha instead would leave a ghost on the map three
    // centuries before anyone reached the system.
    const problems: string[] = [];
    for (const { name, source } of layers) {
      if (name === 'epoch.ts') continue;
      for (const [index, glsl] of shadersIn(source).entries()) {
        if (!glsl.includes('${EPOCH_PARS}')) continue;
        if (!/epoch\s*<=\s*0\.0/.test(glsl)) problems.push(`${name} shader ${index}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('tells every epoch layer about a chosen period', () => {
    // The emphasis is set per layer, so a layer added later that took the
    // shader and not the call would stay at full brightness while the rest of
    // the map dimmed around the period's own places.
    //
    // The plane guidelines are the one exemption, and deliberately: they are a
    // depth cue rather than a subject. Dimming the thread under every system a
    // period does not mention would take the reader's only way of judging z for
    // exactly the places the period is not about, which trades something useful
    // for nothing.
    const EXEMPT = new Set(['epoch.ts', 'dropLines.ts']);
    const missing = layers
      .filter(({ name, source }) => !EXEMPT.has(name) && source.includes('${EPOCH_PARS}'))
      .map(({ name }) => name.replace('.ts', ''))
      .filter((layer) => !new RegExp(`${layer}\\?\\.setNamedPlaces`).test(MAIN));
    expect(missing).toEqual([]);
  });
  it('lets every epoch layer hide the places with no date', () => {
    // "No date recorded" is a third state, not a kind of absence, so it reaches
    // the shader as a gain. A layer that took the switch only into its picker
    // would let the reader hide the undated places and go on drawing them.
    const problems: string[] = [];
    for (const { name, source } of layers) {
      if (name === 'epoch.ts' || !source.includes('${EPOCH_PARS}')) continue;
      if (!source.includes('uUndatedGain.value')) problems.push(name);
    }
    expect(problems).toEqual([]);
  });
});
