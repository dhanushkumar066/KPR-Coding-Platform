import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Image storage for problem statements — diagrams of linked lists, trees,
 * graphs and the like.
 *
 * Filenames are generated, never taken from the upload, so a crafted
 * `originalname` cannot escape the directory or overwrite anything.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_ROOT = path.resolve(__dirname, '../../uploads');
const IMAGE_DIR = path.join(UPLOAD_ROOT, 'questions');

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/**
 * SVG is deliberately excluded: it is a document format that can carry script,
 * and these files are served back to every student taking the test.
 */
const ALLOWED = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** Magic-number check, so the declared mime type alone is never trusted. */
function sniff(buffer) {
  if (buffer.length < 12) return null;
  const b = buffer;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export async function saveQuestionImage(file) {
  if (!file) throw new Error('No file uploaded');
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`That image is larger than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`);
  }

  const detected = sniff(file.buffer);
  if (!detected || !ALLOWED[detected]) {
    throw new Error('Upload a PNG, JPEG, GIF or WebP image');
  }

  await fs.mkdir(IMAGE_DIR, { recursive: true });
  const name = `${Date.now().toString(36)}-${crypto.randomUUID()}.${ALLOWED[detected]}`;
  await fs.writeFile(path.join(IMAGE_DIR, name), file.buffer);

  return {
    url: `/uploads/questions/${name}`,
    contentType: detected,
    bytes: file.size,
  };
}
