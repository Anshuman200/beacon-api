const PASSPHRASE = "api-seeder-secure-encryption-key-2026";
const SALT = "api-seeder-salt-string";

let cachedKey: CryptoKey | null = null;

async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(PASSPHRASE),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  cachedKey = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(SALT),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  return cachedKey;
}

export async function encryptData(plaintext: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle) {
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
  if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle || !ciphertextBase64) {
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
  } catch (err) {
    console.error("Decryption failed:", err);
    // If decryption fails, it might be unencrypted legacy data. Return the raw string directly
    return ciphertextBase64;
  }
}
