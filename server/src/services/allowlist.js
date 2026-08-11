import Papa from 'papaparse';
import ExcelJS from 'exceljs';

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Pulls every well-formed email out of arbitrary text, de-duplicated. */
export function extractEmails(text) {
  const found = String(text || '').match(EMAIL_RE) || [];
  return dedupe(found);
}

function dedupe(emails) {
  const seen = new Set();
  const out = [];
  for (const raw of emails) {
    const email = String(raw).trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

async function fromCsv(buffer) {
  const text = buffer.toString('utf8');
  const parsed = Papa.parse(text, { skipEmptyLines: true });
  // Scan every cell rather than assuming a header — teachers paste all sorts of
  // exports, with or without a header row and in any column order.
  const cells = (parsed.data || []).flat();
  return extractEmails(cells.join('\n'));
}

async function fromExcel(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const cells = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (v == null) return;
        if (typeof v === 'object') {
          // Hyperlinked emails arrive as { text, hyperlink } or rich text.
          if (v.text) cells.push(v.text);
          if (v.hyperlink) cells.push(String(v.hyperlink).replace(/^mailto:/i, ''));
          if (Array.isArray(v.richText)) cells.push(v.richText.map((r) => r.text).join(''));
          if (v.result != null) cells.push(String(v.result));
        } else {
          cells.push(String(v));
        }
      });
    });
  });
  return extractEmails(cells.join('\n'));
}

/**
 * Parses an uploaded allowlist file.
 * @returns {Promise<{emails: string[], source: string}>}
 */
export async function parseAllowlistFile(file) {
  const name = (file.originalname || '').toLowerCase();

  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    return { emails: await fromExcel(file.buffer), source: 'excel' };
  }
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
    return { emails: await fromCsv(file.buffer), source: 'csv' };
  }
  if (name.endsWith('.xls')) {
    throw new Error('Legacy .xls files are not supported — save as .xlsx or .csv and retry');
  }
  throw new Error('Upload a .csv, .txt or .xlsx file');
}
