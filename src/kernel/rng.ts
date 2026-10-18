/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * The RNG state lives *inside* MachineState, so a machine created with the same
 * seed and driven with the same clicks always produces an identical event log.
 * That is the property the determinism test in machine.test.ts guards.
 */

export interface Rng {
  state: number;
  value: number;
}

/** Advance the generator once. Returns the new state and a value in [0, 1). */
export function nextRandom(state: number): Rng {
  let a = (state + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: a, value };
}

/** Inclusive integer in [min, max]. */
export function randomInt(state: number, min: number, max: number): Rng & { int: number } {
  const { state: s, value } = nextRandom(state);
  return { state: s, value, int: min + Math.floor(value * (max - min + 1)) };
}
