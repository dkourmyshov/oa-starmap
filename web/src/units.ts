/**
 * Distance units, made impossible to confuse.
 *
 * Orion's Arm works in light years; astronomy works in parsecs. Mixing them is a
 * correctness bug, so `Parsecs` and `LightYears` are branded types: they are both
 * `number` at runtime with zero overhead, but the compiler refuses to substitute
 * one for the other. Converting requires calling `pcToLy` / `lyToPc` explicitly.
 *
 * Everything stored on disk and everything in the 3D scene is in parsecs.
 * Everything shown to a person defaults to light years.
 */

declare const parsecBrand: unique symbol;
declare const lightYearBrand: unique symbol;

export type Parsecs = number & { readonly [parsecBrand]: true };
export type LightYears = number & { readonly [lightYearBrand]: true };

/** Must match `units.pc_to_ly` in the pipeline manifest. Asserted by a test. */
export const PC_TO_LY = 3.261563777;

/** Tag a raw number as parsecs. Use only where the unit is genuinely known. */
export const pc = (value: number): Parsecs => value as Parsecs;

/** Tag a raw number as light years. Use only where the unit is genuinely known. */
export const ly = (value: number): LightYears => value as LightYears;

export const pcToLy = (distance: Parsecs): LightYears => ly((distance as number) * PC_TO_LY);
export const lyToPc = (distance: LightYears): Parsecs => pc((distance as number) / PC_TO_LY);

export type DistanceUnit = 'ly' | 'pc';

/** The user-facing default is light years, matching Orion's Arm convention. */
export const DEFAULT_UNIT: DistanceUnit = 'ly';

export const inUnit = (distance: Parsecs, unit: DistanceUnit): number =>
  unit === 'ly' ? (pcToLy(distance) as number) : (distance as number);

/**
 * Render a distance for display. Always carries its unit — there is deliberately
 * no way to format a bare distance number, because an unlabelled figure is the
 * thing that gets misread as the other unit.
 */
export function formatDistance(distance: Parsecs, unit: DistanceUnit): string {
  const value = inUnit(distance, unit);

  if (!Number.isFinite(value)) return `unknown ${unit}`;

  const magnitude = Math.abs(value);
  let text: string;
  if (magnitude === 0) text = '0';
  else if (magnitude < 0.01) text = value.toExponential(2);
  else if (magnitude < 10) text = value.toFixed(2);
  else if (magnitude < 1000) text = value.toFixed(1);
  else text = Math.round(value).toLocaleString('en-US');

  return `${text} ${unit}`;
}
