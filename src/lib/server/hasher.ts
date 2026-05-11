import { createHash } from 'node:crypto';

/**
 * Reproduces the password hash format used by com.crazedcoders.globalspa
 * (Hasher.apply). Algorithm:
 *   1. Decode the base64-encoded salt to bytes
 *   2. UTF-16-LE-encode the raw password
 *   3. SHA-1 of concatenated (salt-bytes || password-bytes)
 *   4. Standard base64 encode the digest (28 chars including trailing `=`)
 *
 * NOTE: the APK calls `.substring(0, length - 1)` on the base64 output, but that
 * is purely to strip the trailing `\n` that Android's `Base64.encode(b, 0)` adds
 * in DEFAULT mode — NOT to drop a meaningful base64 character. Node's
 * `toString('base64')` does not add a newline, so we keep the full string.
 */
export function hashPassword(password: string, saltBase64: string): string {
  const saltBytes = Buffer.from(saltBase64, 'base64');
  const pwdBytes = Buffer.from(password, 'utf16le');
  const combined = Buffer.concat([saltBytes, pwdBytes]);
  const digest = createHash('sha1').update(combined).digest();
  return digest.toString('base64');
}
