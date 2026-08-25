const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTotp, normalizeBase32, parseOtpAuthUri } = require('../src/services/otp-service');

const encodeBase32 = (buffer) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
};

test('совпадает с тестовыми векторами RFC 6238 для SHA1, SHA256 и SHA512', () => {
  const vectors = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];
  const keys = {
    SHA1: encodeBase32(Buffer.from('12345678901234567890')),
    SHA256: encodeBase32(Buffer.from('12345678901234567890123456789012')),
    SHA512: encodeBase32(Buffer.from('1234567890123456789012345678901234567890123456789012345678901234')),
  };
  for (const [seconds, sha1, sha256, sha512] of vectors) {
    assert.equal(generateTotp({ secret: keys.SHA1, algorithm: 'SHA1', digits: 8, period: 30 }, seconds * 1000).code, sha1);
    assert.equal(generateTotp({ secret: keys.SHA256, algorithm: 'SHA256', digits: 8, period: 30 }, seconds * 1000).code, sha256);
    assert.equal(generateTotp({ secret: keys.SHA512, algorithm: 'SHA512', digits: 8, period: 30 }, seconds * 1000).code, sha512);
  }
});

test('разбирает стандартный otpauth URI и нормализует секрет', () => {
  const parsed = parseOtpAuthUri('otpauth://totp/Example%20Co:alice%40example.com?secret=jbsw-y3dp%20ehpk3pxp&issuer=Example%20Co&algorithm=SHA256&digits=8&period=60');
  assert.deepEqual(parsed, { issuer: 'Example Co', account: 'alice@example.com', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA256', digits: 8, period: 60 });
  assert.equal(normalizeBase32('jbsw y3dp-ehpk3pxp==='), 'JBSWY3DPEHPK3PXP');
});

test('отклоняет HOTP, migration URI и повреждённые параметры', () => {
  assert.throws(() => parseOtpAuthUri('otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP&counter=1'), /UNSUPPORTED_OTP_URI/);
  assert.throws(() => parseOtpAuthUri('otpauth-migration://offline?data=x'), /UNSUPPORTED_OTP_URI/);
  assert.throws(() => parseOtpAuthUri('otpauth://totp/Test?secret=not0secret'), /INVALID_OTP_SECRET/);
  assert.throws(() => parseOtpAuthUri('otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&digits=7'), /INVALID_OTP_DIGITS/);
});
