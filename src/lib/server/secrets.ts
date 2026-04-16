import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTED_PREFIX = "enc:v1:";

let fallbackWarned = false;

// The proper key is a dedicated, high-entropy secret:
//   openssl rand -base64 32
// set as TACHYON_TOKEN_ENCRYPTION_KEY.
//
// Historically this function fell back to ANILIST_CLIENT_SECRET when no
// dedicated key was set. That's a real risk: OAuth client secrets are
// low-entropy, are transmitted to anilist.co with every token refresh,
// and appear in docs / scripts / .env.example. Anyone who obtains one
// can decrypt every stored token. We keep the fallback at runtime so
// existing installs aren't locked out of their encrypted refresh
// tokens, but emit a one-time loud warning on first use so operators
// rotate to a real key and re-connect AniList.
function getEncryptionSecret() {
  const explicit = process.env.TACHYON_TOKEN_ENCRYPTION_KEY?.trim();
  if (explicit) return explicit;
  const fallback = process.env.ANILIST_CLIENT_SECRET?.trim();
  if (fallback) {
    if (!fallbackWarned) {
      fallbackWarned = true;
      console.warn(
        "[tachyon/secrets] TACHYON_TOKEN_ENCRYPTION_KEY is not set; "
        + "falling back to ANILIST_CLIENT_SECRET for token encryption. "
        + "This is insecure — the OAuth client secret is low-entropy "
        + "and shared with the OAuth server. Generate a dedicated key "
        + "(openssl rand -base64 32), set TACHYON_TOKEN_ENCRYPTION_KEY, "
        + "then reconnect AniList.",
      );
    }
    return fallback;
  }
  return null;
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
