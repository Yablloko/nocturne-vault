const test = require('node:test');
const assert = require('node:assert/strict');
const { parseByteRange } = require('../src/services/media-range');

test('разбирает диапазоны, необходимые Chromium для видео и аудио', () => {
  assert.equal(parseByteRange(null, 1000), null);
  assert.deepEqual(parseByteRange('bytes=0-499', 1000), { start: 0, end: 499 });
  assert.deepEqual(parseByteRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-200', 1000), { start: 800, end: 999 });
  assert.deepEqual(parseByteRange('bytes=900-1200', 1000), { start: 900, end: 999 });
});

test('отклоняет некорректные и составные диапазоны', () => {
  assert.deepEqual(parseByteRange('bytes=1000-', 1000), { invalid: true });
  assert.deepEqual(parseByteRange('bytes=500-100', 1000), { invalid: true });
  assert.deepEqual(parseByteRange('bytes=0-1,5-6', 1000), { invalid: true });
  assert.deepEqual(parseByteRange('items=0-5', 1000), { invalid: true });
});
