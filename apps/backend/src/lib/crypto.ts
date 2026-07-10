import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

import { config } from "./config";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey() {
  const source = Bun.env.DASHWISE_SECRET_KEY || Bun.env.SSH_CREDENTIALS_SECRET || config.PB_ADMIN_PASSWORD;
  if (!source) {
    throw new Error("Missing encryption key for SSH credentials");
  }
  return createHash("sha256").update(source).digest();
}

export function encryptSecret(value: unknown): string {
  const plainText = typeof value === "string" ? value : JSON.stringify(value ?? {});
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret<T = unknown>(encryptedValue?: string | null): T | null {
  if (!encryptedValue) return null;
  const [version, iv, tag, encrypted] = encryptedValue.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Unsupported encrypted secret format");
  }

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");

  try {
    return JSON.parse(decrypted) as T;
  } catch {
    return decrypted as T;
  }
}
