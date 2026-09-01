const test = require('node:test');
const assert = require('node:assert/strict');
const { zipSync, strToU8 } = require('fflate');
const { extractOfficeText, extractRtfText } = require('../src/services/document-preview-service');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('извлекает текст DOCX в памяти без выполнения XML-сущностей', () => {
  const archive = Buffer.from(zipSync({
    'word/document.xml': strToU8('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY secret SYSTEM "file:///C:/secret.txt">]><w:document><w:p><w:r><w:t>Первый &amp; второй</w:t></w:r></w:p><w:p><w:r><w:t>&secret;</w:t></w:r></w:p></w:document>'),
    'word/media/ignored.png': new Uint8Array(1024),
  }));
  const text = extractOfficeText(archive, DOCX);
  assert.match(text, /Первый & второй/);
  assert.match(text, /&secret;/);
  assert.equal(text.includes('file:///'), false);
});

test('читает строки XLSX и подставляет shared strings', () => {
  const archive = Buffer.from(zipSync({
    'xl/sharedStrings.xml': strToU8('<sst><si><t>Логин</t></si><si><t>alice@example.com</t></si></sst>'),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c><v>42</v></c></row></sheetData></worksheet>'),
  }));
  const text = extractOfficeText(archive, XLSX);
  assert.match(text, /Логин\talice@example.com/);
  assert.match(text, /42/);
});

test('отклоняет ZIP-бомбу по заявленному размеру до извлечения', () => {
  const archive = Buffer.from(zipSync({ 'word/document.xml': new Uint8Array(9 * 1024 * 1024) }, { level: 9 }));
  assert.throws(() => extractOfficeText(archive, DOCX), /DOCUMENT_ARCHIVE_UNSAFE/);
});

test('преобразует RTF только в текст и ограничивает управляющие слова', () => {
  const text = extractRtfText(Buffer.from('{\\rtf1\\ansi Secret\\par Second\\tab line}', 'latin1'));
  assert.match(text, /Secret\nSecond\tline/);
  assert.equal(text.includes('\\rtf'), false);
});
