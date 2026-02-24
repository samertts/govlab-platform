import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.NATIONAL_ID_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("NATIONAL_ID_ENCRYPTION_KEY environment variable is required");
  }
  return Buffer.from(key, "hex");
}

export function encryptNationalId(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decryptNationalId(ciphertext: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encryptedData] = ciphertext.split(":");

  if (!ivHex || !authTagHex || !encryptedData) {
    throw new Error("Invalid encrypted national ID format");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function hashNationalId(nationalId: string): string {
  return createHash("sha256").update(nationalId).digest("hex");
}
