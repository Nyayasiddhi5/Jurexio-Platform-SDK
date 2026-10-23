import { randomBytes, randomInt } from 'crypto';

/** Cryptographically secure random float in [0, 1) — drop-in replacement for Math.random() */
export function secureRandom(): number {
  return randomBytes(4).readUInt32BE(0) / 0x100000000;
}

/** Secure random integer in [min, max] inclusive */
export function secureRandomInt(min: number, max: number): number {
  return randomInt(min, max + 1);
}

/** Secure random float in [min, max] */
export function secureRandomFloat(min: number, max: number): number {
  return min + secureRandom() * (max - min);
}

/** Secure random array element selection */
export function secureRandomChoice<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length)];
}

/** Secure random boolean with optional probability */
export function secureRandomBool(probability = 0.5): boolean {
  return secureRandom() < probability;
}

/** Secure random hex string of `byteLength` bytes (result is 2× as long) */
export function secureRandomHex(byteLength: number): string {
  return randomBytes(byteLength).toString('hex');
}

/** Secure random base64 string from `byteLength` bytes */
export function secureRandomBase64(byteLength: number): string {
  return randomBytes(byteLength).toString('base64');
}

/** Alias: secureRandomBetween — same as secureRandomFloat */
export const secureRandomBetween = secureRandomFloat;

/** Alias: secureRandomElement — same as secureRandomChoice */
export const secureRandomElement = secureRandomChoice;
