import { decryptSecret, encryptSecret } from "./token-crypto.js";

/** Prefix for AES-256-GCM ciphertext stored in `SenderAccount.smtpPass`. */
export const SMTP_PASS_ENCRYPTED_PREFIX = "enc1:";

export function isEncryptedSmtpPass(stored: string): boolean {
  return stored.startsWith(SMTP_PASS_ENCRYPTED_PREFIX);
}

export function encryptSmtpPassForStorage(
  plaintext: string,
  encryptionKey: string,
): string {
  if (!encryptionKey || encryptionKey.trim().length < 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be at least 32 characters");
  }
  return `${SMTP_PASS_ENCRYPTED_PREFIX}${encryptSecret(plaintext, encryptionKey)}`;
}

export function decryptSmtpPassFromStorage(
  stored: string,
  encryptionKey: string,
): string {
  if (!encryptionKey || encryptionKey.trim().length < 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be at least 32 characters");
  }
  if (!isEncryptedSmtpPass(stored)) {
    return stored;
  }
  const payload = stored.slice(SMTP_PASS_ENCRYPTED_PREFIX.length);
  return decryptSecret(payload, encryptionKey);
}
