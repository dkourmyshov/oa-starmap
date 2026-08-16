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

describe('shader sources', () => {
  it('finds the layers at all', () => {
    // A glob that silently matched nothing would make every check below pass.
    expect(layers.length).toBeGreaterThan(4);
    expect(layers.some(({ source }) => source.includes('${DOF_PARS}'))).toBe(true);
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

  it('gives every shader that calls the depth-of-field helpers their source', () => {
    const problems: string[] = [];
    for (const { name, source } of layers) {
      // dof.ts is where the helpers are written, not a shader that calls them.
      if (name === 'dof.ts') continue;
      for (const [index, glsl] of shadersIn(source).entries()) {
        const calls = /\bdof(BlurPx|Gain)\s*\(/.test(glsl);
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
});
