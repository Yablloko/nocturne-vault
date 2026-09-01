const { unzipSync, strFromU8 } = require('fflate');

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_EXTRACTED_BYTES = 20 * 1024 * 1024;
const MAX_PREVIEW_CHARS = 2_000_000;

const MODERN_OFFICE_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
]);

function decodeXmlEntities(value) {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|amp|lt|gt|quot|apos);/gi, (match, decimal, hexadecimal) => {
    if (decimal || hexadecimal) {
      const point = Number.parseInt(decimal || hexadecimal, hexadecimal ? 16 : 10);
      return Number.isSafeInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    }
    return ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[match.toLowerCase()] || '';
  });
}

function xmlText(xml, paragraphPattern = /<\/(?:w:p|a:p|text:p|table:table-row)>/gi) {
  return decodeXmlEntities(String(xml || '')
    .replace(paragraphPattern, '\n')
    .replace(/<(?:w:tab|text:tab)\b[^>]*\/?\s*>/gi, '\t')
    .replace(/<[^>]+>/g, ''))
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_PREVIEW_CHARS);
}

function allowedArchiveEntry(mime, name) {
  if (mime.includes('wordprocessingml')) return name === 'word/document.xml';
  if (mime.includes('spreadsheetml')) return name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/i.test(name);
  if (mime.includes('presentationml')) return /^ppt\/slides\/slide\d+\.xml$/i.test(name);
  if (mime.includes('opendocument')) return name === 'content.xml';
  return false;
}

function unzipSelected(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_ARCHIVE_BYTES) throw new Error('DOCUMENT_PREVIEW_TOO_LARGE');
  let total = 0;
  let count = 0;
  try {
    return unzipSync(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), {
      filter(file) {
        count += 1;
        if (count > 10_000) throw new Error('DOCUMENT_ARCHIVE_UNSAFE');
        if (!allowedArchiveEntry(mime, file.name)) return false;
        const size = Number(file.originalSize);
        if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ENTRY_BYTES) throw new Error('DOCUMENT_ARCHIVE_UNSAFE');
        total += size;
        if (total > MAX_TOTAL_EXTRACTED_BYTES) throw new Error('DOCUMENT_ARCHIVE_UNSAFE');
        return true;
      },
    });
  } catch (error) {
    if (/DOCUMENT_/.test(error.message)) throw error;
    throw new Error('DOCUMENT_PREVIEW_INVALID');
  }
}

function textFromEntry(entries, name) {
  const bytes = entries[name];
  return bytes ? strFromU8(bytes) : '';
}

function extractXmlTagText(value, tag = 't') {
  const output = [];
  const expression = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'gi');
  for (const match of value.matchAll(expression)) output.push(xmlText(match[1], /$^/));
  return output.join('');
}

function extractSpreadsheet(entries) {
  const sharedXml = textFromEntry(entries, 'xl/sharedStrings.xml');
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) => extractXmlTagText(match[1]));
  const sheetNames = Object.keys(entries).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const sheets = [];
  for (const [sheetIndex, name] of sheetNames.entries()) {
    const xml = textFromEntry(entries, name);
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
      const cells = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
        const attributes = cellMatch[1];
        const body = cellMatch[2];
        const inline = extractXmlTagText(body);
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(body)?.[1] || '';
        const value = /\bt=["']s["']/i.test(attributes) ? shared[Number(raw)] || '' : inline || xmlText(raw, /$^/);
        cells.push(value);
      }
      rows.push(cells.join('\t'));
      if (rows.join('\n').length > MAX_PREVIEW_CHARS) break;
    }
    sheets.push(`Лист ${sheetIndex + 1}\n${rows.join('\n')}`);
  }
  return sheets.join('\n\n').slice(0, MAX_PREVIEW_CHARS);
}

function extractOfficeText(buffer, mime) {
  if (!MODERN_OFFICE_MIMES.has(mime)) throw new Error('DOCUMENT_PREVIEW_UNSUPPORTED');
  const entries = unzipSelected(buffer, mime);
  if (mime.includes('wordprocessingml')) return xmlText(textFromEntry(entries, 'word/document.xml'));
  if (mime.includes('spreadsheetml')) return extractSpreadsheet(entries);
  if (mime.includes('presentationml')) {
    return Object.keys(entries)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name, index) => `Слайд ${index + 1}\n${xmlText(textFromEntry(entries, name))}`)
      .join('\n\n')
      .slice(0, MAX_PREVIEW_CHARS);
  }
  return xmlText(textFromEntry(entries, 'content.xml'));
}

function extractRtfText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_ENTRY_BYTES) throw new Error('DOCUMENT_PREVIEW_TOO_LARGE');
  return buffer.toString('latin1')
    .replace(/\\'[0-9a-f]{2}/gi, (match) => String.fromCharCode(Number.parseInt(match.slice(2), 16)))
    .replace(/\\(?:par|line)\b/gi, '\n')
    .replace(/\\tab\b/gi, '\t')
    .replace(/\\[a-z]+-?\d*\s?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\\([{}\\])/g, '$1')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\t +/g, '\t')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_PREVIEW_CHARS);
}

module.exports = { extractOfficeText, extractRtfText, MODERN_OFFICE_MIMES, MAX_ARCHIVE_BYTES };
