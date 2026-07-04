// Storage for the AES-GCM key that protects locally-persisted workspace data.
// The key is generated per-install and marked non-extractable, so even
// reading the app's source can't recover it — unlike a hardcoded passphrase,
// which would let anyone decrypt any install's data. This still can't defend
// against a live devtools session on the same browser profile; that ceiling
// is inherent to any client-only (no server-held secret) design.
const DB_NAME = "beacon-api-keystore";
const STORE_NAME = "keys";
const KEY_ID = "workspace-encryption-key";

let cachedKey: CryptoKey | null = null;

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadStoredKey(): Promise<CryptoKey | null> {
  try {
    const db = await openKeyDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(KEY_ID);
      req.onsuccess = () => resolve((req.result as CryptoKey) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function storeKey(key: CryptoKey): Promise<void> {
  const db = await openKeyDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(key, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const existing = await loadStoredKey();
  if (existing) {
    cachedKey = existing;
    return existing;
  }

  const generated = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false, // non-extractable: raw key material can never be read back out
    ["encrypt", "decrypt"]
  );

  await storeKey(generated);
  cachedKey = generated;
  return generated;
}

export async function encryptData(plaintext: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto?.subtle || !window.indexedDB) {
    return plaintext;
  }
  try {
    const key = await getEncryptionKey();
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(plaintext);

    // Standard IV size for AES-GCM is 12 bytes
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const ciphertextBytes = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      dataBytes
    );

    // Combine IV + ciphertext
    const combined = new Uint8Array(iv.length + ciphertextBytes.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertextBytes), iv.length);

    // Convert to Base64
    return btoa(String.fromCharCode(...combined));
  } catch (err) {
    console.error("Encryption failed:", err);
    return plaintext;
  }
}

export async function decryptData(ciphertextBase64: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto?.subtle || !window.indexedDB || !ciphertextBase64) {
    return ciphertextBase64;
  }
  try {
    const key = await getEncryptionKey();

    // Convert Base64 back to byte array
    const combinedStr = atob(ciphertextBase64);
    const combined = new Uint8Array(combinedStr.length);
    for (let i = 0; i < combinedStr.length; i++) {
      combined[i] = combinedStr.charCodeAt(i);
    }

    if (combined.length < 12) {
      throw new Error("Ciphertext too short (missing IV)");
    }

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const plaintextBytes = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      ciphertext
    );

    return new TextDecoder().decode(plaintextBytes);
  } catch {
    // Expected, already-handled cases, not a bug: (1) unencrypted legacy data
    // from before this module existed — return it as-is if it's valid JSON;
    // (2) ciphertext encrypted under a key we no longer have (e.g. IndexedDB's
    // key store was cleared independently of localStorage, or the pre-encryption
    // hardcoded-passphrase era) — return "null" so callers treat it as absent
    // state and reset to defaults instead of crashing on garbage JSON. Logged at
    // `debug` (not `error`) since dev tooling like the Next.js overlay treats
    // console.error as a crash — this path recovers cleanly on its own.
    try {
      JSON.parse(ciphertextBase64);
      return ciphertextBase64;
    } catch {
      console.debug("beacon: local data couldn't be decrypted with the current key; resetting that slice to defaults.");
      return "null";
    }
  }
}
