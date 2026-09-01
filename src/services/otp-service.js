const crypto = require('node:crypto');
const jsQR = require('jsqr');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ALGORITHMS = new Set(['SHA1', 'SHA256', 'SHA512']);

function normalizeBase32(value) {
  const normalized = String(value || '').toUpperCase().replace(/[\s=-]/g, '');
  if (normalized.length < 8 || !/^[A-Z2-7]+$/.test(normalized)) throw new Error('INVALID_OTP_SECRET');
  return normalized;
}

function decodeBase32(value) {
  const normalized = normalizeBase32(value);
  let bits = 0;
  let accumulator = 0;
  const output = [];
  for (const character of normalized) {
    accumulator = (accumulator << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >>> bits) & 0xff);
    }
  }
  if (!output.length) throw new Error('INVALID_OTP_SECRET');
  return Buffer.from(output);
}

function generateTotp({ secret, algorithm = 'SHA1', digits = 6, period = 30 }, now = Date.now()) {
  const normalizedAlgorithm = String(algorithm).toUpperCase();
  const normalizedDigits = Number(digits);
  const normalizedPeriod = Number(period);
  if (!ALGORITHMS.has(normalizedAlgorithm)) throw new Error('INVALID_OTP_ALGORITHM');
  if (![6, 8].includes(normalizedDigits)) throw new Error('INVALID_OTP_DIGITS');
  if (!Number.isInteger(normalizedPeriod) || normalizedPeriod < 15 || normalizedPeriod > 120) throw new Error('INVALID_OTP_PERIOD');
  const key = decodeBase32(secret);
  const counter = BigInt(Math.floor(Number(now) / 1000 / normalizedPeriod));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  try {
    const digest = crypto.createHmac(normalizedAlgorithm.toLowerCase(), key).update(message).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
    const code = String(binary % (10 ** normalizedDigits)).padStart(normalizedDigits, '0');
    const elapsed = Math.floor(Number(now) / 1000) % normalizedPeriod;
    return { code, remaining: normalizedPeriod - elapsed, period: normalizedPeriod };
  } finally {
    key.fill(0);
    message.fill(0);
  }
}

function parseOtpAuthUri(value) {
  let uri;
  try { uri = new URL(String(value || '').trim()); }
  catch { throw new Error('INVALID_OTP_URI'); }
  if (uri.protocol !== 'otpauth:' || uri.hostname.toLowerCase() !== 'totp') throw new Error('UNSUPPORTED_OTP_URI');
  let label;
  try { label = decodeURIComponent(uri.pathname.replace(/^\//, '')); }
  catch { throw new Error('INVALID_OTP_URI'); }
  const separator = label.indexOf(':');
  const labelIssuer = separator >= 0 ? label.slice(0, separator).trim() : '';
  const account = (separator >= 0 ? label.slice(separator + 1) : label).trim();
  const issuer = String(uri.searchParams.get('issuer') || labelIssuer || '').trim();
  const secret = normalizeBase32(uri.searchParams.get('secret'));
  const algorithm = String(uri.searchParams.get('algorithm') || 'SHA1').toUpperCase();
  const digits = Number(uri.searchParams.get('digits') || 6);
  const period = Number(uri.searchParams.get('period') || 30);
  generateTotp({ secret, algorithm, digits, period }, 0);
  return {
    issuer: issuer.slice(0, 100),
    account: (account || issuer || 'Без названия').slice(0, 180),
    secret,
    algorithm,
    digits,
    period,
  };
}

function decodeQrPayload(nativeImage) {
  if (!nativeImage || nativeImage.isEmpty()) throw new Error('OTP_QR_EMPTY');
  const originalSize = nativeImage.getSize();
  const scale = Math.min(1, 1800 / Math.max(originalSize.width, originalSize.height));
  const image = scale < 1 ? nativeImage.resize({ width: Math.max(1, Math.round(originalSize.width * scale)), height: Math.max(1, Math.round(originalSize.height * scale)), quality: 'best' }) : nativeImage;
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = bitmap[index + 2];
    rgba[index + 1] = bitmap[index + 1];
    rgba[index + 2] = bitmap[index];
    rgba[index + 3] = bitmap[index + 3];
  }
  try {
    const result = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
    if (!result?.data) throw new Error('OTP_QR_NOT_FOUND');
    return String(result.data).trim();
  } finally {
    rgba.fill(0);
    bitmap.fill(0);
  }
}

function decodeOtpQrImage(nativeImage) {
  return parseOtpAuthUri(decodeQrPayload(nativeImage));
}

function isSensitiveOtpPayload(value) {
  return /^otpauth(?:-migration)?\s*:/i.test(String(value || '').trim());
}

module.exports = { decodeBase32, decodeOtpQrImage, decodeQrPayload, generateTotp, isSensitiveOtpPayload, normalizeBase32, parseOtpAuthUri };
