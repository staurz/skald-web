import { createHash } from 'node:crypto';

/**
 * Reproduces the password hash format used by com.crazedcoders.globalspa
 * (Hasher.apply in v5.0.41). Algorithm:
 *   1. Decode the base64-encoded salt to bytes
 *   2. UTF-16-LE-encode the raw password
 *   3. SHA-1 of concatenated (salt-bytes || password-bytes)
 *   4. Base64-encode the digest
 *   5. Drop the final character
 */
export function hashPassword(password: string, saltBase64: string): string {
  const saltBytes = Buffer.from(saltBase64, 'base64');
  const pwdBytes = Buffer.from(password, 'utf16le');
  const combined = Buffer.concat([saltBytes, pwdBytes]);
  const digest = createHash('sha1').update(combined).digest();
  const b64 = digest.toString('base64');
  return b64.slice(0, -1);
}
