import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTED_PREFIX = "enc:v1:";

function getEncryptionSecret() {
  return process.env.TACHYON_TOKEN_ENCRYPTION_KEY?.trim()
    || process.env.ANILIST_CLIENT_SECRET?.trim()
    || null;
}

function getEncryptionKey() {
  const secret = getEncryptionSecret();
  if (!secret) {
    return null;
  }

  return createHash("sha256").update(secret).digest();
}

export function hasTokenEncryptionKey() {
  return Boolean(getEncryptionKey());
}

export function isEncryptedSecret(value: string) {
  return value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptStoredSecret(value: string) {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error("Token encryption key is not configured");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptStoredSecret(value: string) {
  if (!isEncryptedSecret(value)) {
    return value;
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error("Token encryption key is not configured");
  }

  const encoded = value.slice(ENCRYPTED_PREFIX.length);
  const [ivPart, ciphertextPart, tagPart] = encoded.split(".");
  if (!ivPart || !ciphertextPart || !tagPart) {
    throw new Error("Encrypted secret has an invalid format");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}
