import crypto from "crypto";

/**
 * Field-level encryption for per-repository secrets.
 *
 * Uses the same wire format as the engine's credential store
 * (`agent/src/agent/credentials/store.py`): `v2:` followed by base64 of
 * `nonce(12) || ciphertext || tag`, with the key derived from
 * `CREDENTIAL_STORE_KEY` (a 32-byte base64 key is used directly, anything else
 * is SHA-256 hashed). Keeping one format means a secret saved in the dashboard
 * is decryptable by the engine at run time without a second key.
 *
 * Secrets are write-only: the value is encrypted here and never returned by any
 * GET endpoint.
 */

const PREFIX = "v2:";
const NONCE_BYTES = 12;

function encryptionKey(): Buffer {
  const configured = process.env.CREDENTIAL_STORE_KEY;
  if (!configured) {
    throw new Error(
      "CREDENTIAL_STORE_KEY is not configured. Set it to the same value the engine uses before storing secrets."
    );
  }
  const configuredBytes = Buffer.from(configured, "utf8");
  try {
    const decoded = Buffer.from(configured, "base64url");
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to hashing.
  }
  return crypto.createHash("sha256").update(configuredBytes).digest();
}

export function encryptSecret(plaintext: string): string {
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([nonce, encrypted, tag]).toString("base64");
}

export function decryptSecret(payload: string): string {
  if (!payload.startsWith(PREFIX)) {
    throw new Error("Unsupported secret encoding; expected a v2: payload.");
  }
  const raw = Buffer.from(payload.slice(PREFIX.length), "base64");
  const nonce = raw.subarray(0, NONCE_BYTES);
  const tag = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(NONCE_BYTES, raw.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** True when secrets can be written at all, so the UI can explain itself. */
export function secretsConfigured(): boolean {
  return Boolean(process.env.CREDENTIAL_STORE_KEY);
}
