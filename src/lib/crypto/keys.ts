

// src/lib/crypto/keys.ts
// Key management for end-to-end encrypted chat (crypto_box).
// - Generates an X25519 keypair (libsodium crypto_box_keypair)
// - Stores *secret* key only in the browser (localStorage)
// - Publishes public key to `profiles.public_key` in Supabase

import sodium from "libsodium-wrappers";

export const KEY_VERSION = 1 as const;

// Keep this stable; changing it will regenerate keys for all users on that device.
const LS_KEY = `cmusic:crypto:keypair:v${KEY_VERSION}`;

export type StoredKeypairV1 = {
  version: typeof KEY_VERSION;
  publicKey: string; // base64 (urlsafe, no padding)
  secretKey: string; // base64 (urlsafe, no padding)
  createdAt: string; // ISO
};

export type Keypair = {
  version: typeof KEY_VERSION;
  publicKeyB64: string;
  secretKeyB64: string;
  publicKeyU8: Uint8Array;
  secretKeyU8: Uint8Array;
};

function b64Encode(u8: Uint8Array): string {
  // URL-safe Base64, no padding (easy to store / send)
  return sodium.to_base64(u8, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function b64Decode(b64: string): Uint8Array {
  return sodium.from_base64(b64, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function readStored(): StoredKeypairV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredKeypairV1;
    if (parsed?.version !== KEY_VERSION) return null;
    if (!parsed.publicKey || !parsed.secretKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(kp: StoredKeypairV1) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY, JSON.stringify(kp));
}

/**
 * Get existing keypair from localStorage or create a new one.
 * IMPORTANT: secret key never leaves the client.
 */
export async function getOrCreateKeypair(): Promise<Keypair> {
  await sodium.ready;

  const stored = readStored();
  if (stored) {
    const publicKeyU8 = b64Decode(stored.publicKey);
    const secretKeyU8 = b64Decode(stored.secretKey);
    return {
      version: KEY_VERSION,
      publicKeyB64: stored.publicKey,
      secretKeyB64: stored.secretKey,
      publicKeyU8,
      secretKeyU8,
    };
  }

  const kp = sodium.crypto_box_keypair();
  const publicKeyB64 = b64Encode(kp.publicKey);
  const secretKeyB64 = b64Encode(kp.privateKey);

  writeStored({
    version: KEY_VERSION,
    publicKey: publicKeyB64,
    secretKey: secretKeyB64,
    createdAt: new Date().toISOString(),
  });

  return {
    version: KEY_VERSION,
    publicKeyB64,
    secretKeyB64,
    publicKeyU8: kp.publicKey,
    secretKeyU8: kp.privateKey,
  };
}

/**
 * Convenience: returns public key (b64) if exists (or creates it).
 */
export async function getMyPublicKeyB64(): Promise<string> {
  const kp = await getOrCreateKeypair();
  return kp.publicKeyB64;
}

/**
 * Publish your public key to Supabase `profiles`.
 *
 * Pass your already-created Supabase client:
 *   await publishMyPublicKey(supabase, user.id)
 */
export async function publishMyPublicKey(
  supabase: any,
  userId: string
): Promise<{ ok: true } | { ok: false; error: any }> {
  const kp = await getOrCreateKeypair();

  const { error } = await supabase
    .from("profiles")
    .update({
      public_key: kp.publicKeyB64,
      public_key_version: KEY_VERSION,
    })
    .eq("id", userId);

  if (error) return { ok: false, error };
  return { ok: true };
}

/**
 * Debug helper: wipe local keypair (forces regeneration next time).
 */
export function resetLocalKeypair() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LS_KEY);
}

/**
 * Utility to decode a user's public key from DB (b64 -> Uint8Array)
 */
export async function decodePublicKeyB64(b64: string): Promise<Uint8Array> {
  await sodium.ready;
  return b64Decode(b64);
}

/**
 * Utility to decode my secret key from storage (b64 -> Uint8Array)
 */
export async function getMySecretKeyU8(): Promise<Uint8Array> {
  const kp = await getOrCreateKeypair();
  return kp.secretKeyU8;
}