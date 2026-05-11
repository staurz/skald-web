import { describe, it, expect } from 'vitest';
import { hashPassword } from '../src/lib/server/hasher';

describe('hashPassword', () => {
  it('matches the expected algorithm shape (SHA-1 over base64-decoded salt + UTF-16-LE password, base64 with trailing char dropped)', () => {
    // Salt = base64('saltsalt') = 'c2FsdHNhbHQ='. Decoded: 8 bytes 'saltsalt'.
    // Password 'a' as UTF-16-LE = bytes [0x61, 0x00].
    // SHA-1(saltsalt || [0x61,0x00]) base64 with last char dropped:
    const result = hashPassword('a', 'c2FsdHNhbHQ=');
    expect(result).toBe('aNLe4t1WDvM6yQwwPf539C6soQ4');
  });

  it('handles empty password', () => {
    // SHA-1(saltsalt) base64 with last char dropped:
    const result = hashPassword('', 'c2FsdHNhbHQ=');
    expect(result).toBe('LCq6zkvYuxn2cRPaFG27jMz4SRU');
  });
});
