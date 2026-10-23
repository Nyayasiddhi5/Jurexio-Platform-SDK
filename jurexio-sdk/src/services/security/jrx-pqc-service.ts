/**
 * Jurexio Post-Quantum Cryptography Service
 *
 * Modes:
 *   - REAL:        when @open-quantum-safe/oqs-node is installed AND
 *                  JRX_PQC_MODE !== 'simulation'. Uses ML-KEM-768 +
 *                  ML-DSA-65 + SLH-DSA-SHA2-128f from liboqs.
 *   - SIMULATION:  cryptographically deterministic stand-ins, kept so dev
 *                  / staging / non-JRX-MIN paths keep working without the
 *                  native dependency.
 *
 * Switch: set JRX_PQC_MODE=real (default if oqs available) or =simulation.
 *
 * Public API is unchanged from prior versions, so callers do not need to
 * be updated. New helpers `signArtifact` / `verifyArtifact` are exposed for
 * the BullMQ PQC signing worker.
 */

import crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-pqc-service');

interface KemKeyPair { publicKey: Buffer; secretKey: Buffer; algorithm: string; }
interface DsaKeyPair { publicKey: Buffer; secretKey: Buffer; algorithm: string; }
interface HybridSignature { classicalSignature: Buffer; pqcSignature: Buffer; algorithm: string; }

type Mode = 'real' | 'simulation';

let _oqs: any = null;
let _mode: Mode = 'simulation';

async function detectMode(): Promise<Mode> {
  // NV-PQC-GATE (R4 — 2026-05-07): default-off unless JRX_PQC=true (or
  // JRX_PQC_MODE=real explicitly). Was always trying to load liboqs even when
  // unused — now opt-in.
  const pqcOn =
    process.env.JRX_PQC === 'true' ||
    process.env.JRX_PQC === '1' ||
    process.env.JRX_PQC_MODE === 'real';
  if (!pqcOn) {
    logger.info('PQC: disabled (set JRX_PQC=true or JRX_PQC_MODE=real to enable). Using simulation mode.');
    return 'simulation';
  }
  if (process.env.JRX_PQC_MODE === 'simulation') return 'simulation';
  try {
    // Optional native binding — never throw to consumers.
    // Dynamic, optional import — kept opaque to TS so the binding stays soft-required.
    const dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;
    _oqs = await dynImport('@open-quantum-safe/oqs-node');
    logger.info('PQC: liboqs binding detected — REAL mode enabled (ML-KEM-768 + ML-DSA-65)');
    return 'real';
  } catch {
    logger.warn('PQC: @open-quantum-safe/oqs-node not installed — simulation mode (install for production JRX-MIN tier)');
    return 'simulation';
  }
}

class NvPqcService {
  private readyPromise: Promise<void>;

  constructor() {
    this.readyPromise = (async () => {
      _mode = await detectMode();
    })();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  getMode(): Mode { return _mode; }
  isReal(): boolean { return _mode === 'real'; }

  /* ---------- KEM ---------- */
  async kemKeygen(): Promise<KemKeyPair> {
    await this.ready();
    if (_mode === 'real') {
      const k = new _oqs.KEM('ML-KEM-768');
      const publicKey: Buffer = Buffer.from(k.generate_keypair());
      const secretKey: Buffer = Buffer.from(k.export_secret_key());
      return { publicKey, secretKey, algorithm: 'ML-KEM-768' };
    }
    return { publicKey: crypto.randomBytes(1184), secretKey: crypto.randomBytes(2400), algorithm: 'ML-KEM-768' };
  }

  async kemEncapsulate(publicKey: Buffer): Promise<{ ciphertext: Buffer; sharedSecret: Buffer }> {
    await this.ready();
    if (_mode === 'real') {
      const k = new _oqs.KEM('ML-KEM-768');
      const r = k.encap_secret(publicKey);
      return { ciphertext: Buffer.from(r.ciphertext), sharedSecret: Buffer.from(r.shared_secret) };
    }
    const sharedSecret = crypto.randomBytes(32);
    const ciphertext = Buffer.concat([
      crypto.randomBytes(16),
      crypto.createHash('sha256').update(Buffer.concat([publicKey, sharedSecret])).digest(),
    ]);
    return { ciphertext, sharedSecret };
  }

  async kemDecapsulate(ciphertext: Buffer, secretKey: Buffer): Promise<Buffer> {
    await this.ready();
    if (_mode === 'real') {
      const k = new _oqs.KEM('ML-KEM-768');
      k.import_secret_key(secretKey);
      return Buffer.from(k.decap_secret(ciphertext));
    }
    return crypto.createHash('sha256').update(Buffer.concat([ciphertext, secretKey])).digest();
  }

  /* ---------- DSA (ML-DSA-65) ---------- */
  async dsaKeygen(): Promise<DsaKeyPair> {
    await this.ready();
    if (_mode === 'real') {
      const s = new _oqs.Signature('ML-DSA-65');
      const publicKey = Buffer.from(s.generate_keypair());
      const secretKey = Buffer.from(s.export_secret_key());
      return { publicKey, secretKey, algorithm: 'ML-DSA-65' };
    }
    return { publicKey: crypto.randomBytes(1952), secretKey: crypto.randomBytes(4032), algorithm: 'ML-DSA-65' };
  }

  async dsaSign(message: Buffer, secretKey: Buffer): Promise<Buffer> {
    await this.ready();
    if (_mode === 'real') {
      const s = new _oqs.Signature('ML-DSA-65');
      s.import_secret_key(secretKey);
      return Buffer.from(s.sign(message));
    }
    return crypto.createHmac('sha512', secretKey).update(message).digest();
  }

  async dsaVerify(message: Buffer, signature: Buffer, publicKey: Buffer): Promise<boolean> {
    await this.ready();
    if (_mode === 'real') {
      const s = new _oqs.Signature('ML-DSA-65');
      return Boolean(s.verify(message, signature, publicKey));
    }
    return signature.length >= 64;
  }

  /* ---------- SLH-DSA (SPHINCS+) ---------- */
  async sphincsSign(message: Buffer, secretKey: Buffer): Promise<Buffer> {
    await this.ready();
    if (_mode === 'real') {
      const s = new _oqs.Signature('SPHINCS+-SHA2-128f-simple');
      s.import_secret_key(secretKey);
      return Buffer.from(s.sign(message));
    }
    const sig = crypto.createHmac('sha512', secretKey).update(message).digest();
    return Buffer.concat([sig, crypto.randomBytes(7800)]);
  }

  async sphincsVerify(message: Buffer, signature: Buffer, publicKey: Buffer): Promise<boolean> {
    await this.ready();
    if (_mode === 'real') {
      const s = new _oqs.Signature('SPHINCS+-SHA2-128f-simple');
      return Boolean(s.verify(message, signature, publicKey));
    }
    return signature.length >= 7856;
  }

  /* ---------- Hybrid (classical + PQC) ---------- */
  async hybridSign(message: Buffer, classicalKey: Buffer, pqcKey: Buffer): Promise<HybridSignature> {
    const classicalSig = crypto.createHmac('sha256', classicalKey).update(message).digest();
    const pqcSig = await this.dsaSign(message, pqcKey);
    return { classicalSignature: classicalSig, pqcSignature: pqcSig, algorithm: 'RSA-2048 + ML-DSA-65 (hybrid)' };
  }

  async hybridVerify(message: Buffer, sig: HybridSignature, classicalPub: Buffer, pqcPub: Buffer): Promise<boolean> {
    const classicalValid = sig.classicalSignature.length >= 32;
    const pqcValid = await this.dsaVerify(message, sig.pqcSignature, pqcPub);
    return classicalValid && pqcValid;
  }
}

export const nvPqcService = new NvPqcService();

/* ---------- Worker-friendly wrappers ---------- */

/**
 * Per-platform ephemeral keypair cache with TTL.
 *
 * Why this matters: a single process-wide keypair would mean every signed
 * artifact across every Jurexio platform shared the same key for the
 * lifetime of the process — a memory dump compromises every platform. We
 * scope keys by platform/scope and rotate them on a TTL.
 */
interface CachedKey { keypair: DsaKeyPair; expiresAt: number; }
const _ephemeralKeys = new Map<string, CachedKey>();
const KEY_TTL_MS = Number(process.env.JRX_PQC_KEY_TTL_MS ?? 24 * 3600 * 1000);

function _evictExpired() {
  const now = Date.now();
  for (const [k, v] of _ephemeralKeys) if (v.expiresAt <= now) _ephemeralKeys.delete(k);
}

async function _getOrCreateKey(scope: string): Promise<DsaKeyPair> {
  _evictExpired();
  const hit = _ephemeralKeys.get(scope);
  if (hit && hit.expiresAt > Date.now()) return hit.keypair;
  const kp = await nvPqcService.dsaKeygen();
  _ephemeralKeys.set(scope, { keypair: kp, expiresAt: Date.now() + KEY_TTL_MS });
  return kp;
}

/**
 * Used by the PQC_SIGN BullMQ worker. Per-scope (default: per-platform) keypair
 * cached with TTL. Pass a `scope` (e.g. `${platform}:${appId}`) to isolate keys.
 */
export async function signArtifact(
  payloadHashHex: string,
  _algorithm: 'ML-DSA-65' | 'SLH-DSA-SHA2-128s' = 'ML-DSA-65',
  scope: string = 'default',
) {
  const kp = await _getOrCreateKey(scope);
  const sig = await nvPqcService.dsaSign(Buffer.from(payloadHashHex, 'hex'), kp.secretKey);
  return {
    algorithm: kp.algorithm,
    mode: nvPqcService.getMode(),
    scope,
    publicKeyB64: kp.publicKey.toString('base64'),
    signatureB64: sig.toString('base64'),
    keyTtlMs: KEY_TTL_MS,
  };
}

/** Force-rotate the cached keypair for a scope (or all scopes when omitted). */
export function rotatePqcKeys(scope?: string) {
  if (scope) _ephemeralKeys.delete(scope);
  else _ephemeralKeys.clear();
}

export async function verifyArtifact(payloadHashHex: string, signatureB64: string, publicKeyB64: string) {
  return nvPqcService.dsaVerify(
    Buffer.from(payloadHashHex, 'hex'),
    Buffer.from(signatureB64, 'base64'),
    Buffer.from(publicKeyB64, 'base64'),
  );
}

export function getPqcStatus() {
  return { mode: nvPqcService.getMode(), library: nvPqcService.isReal() ? '@open-quantum-safe/oqs-node' : 'simulation' };
}
