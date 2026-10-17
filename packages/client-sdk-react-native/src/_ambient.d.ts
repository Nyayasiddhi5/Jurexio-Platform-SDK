/**
 * Ambient declarations for the React Native runtime.
 *
 * `require()` is provided by the Metro / Hermes runtime — it's not the Node.js
 * `require` — so we declare it ourselves rather than pulling in `@types/node`
 * (which would also drag in Buffer, process, etc that aren't available in RN).
 *
 * This file deliberately has no `import` / `export` statements so its
 * declarations are picked up as ambient globals.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (mod: string) => any;
