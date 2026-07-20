import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const PACKAGE_DIR = resolve(ROOT, '.v2-package');
const EXPECTED_SHA = '230b6b705afdb069b471f48e6f8054d11ebb5cfa708ba322ec9ccfe3f53e97d7';

if (!existsSync(PACKAGE_DIR)) {
  console.log('CRM V2 source is already materialized.');
  process.exit(0);
}

const parts = readdirSync(PACKAGE_DIR)
  .filter((name) => name.startsWith('part-'))
  .sort();

if (!parts.length) throw new Error('CRM V2 source package is incomplete.');

const encoded = parts.map((name) => readFileSync(resolve(PACKAGE_DIR, name), 'utf8').trim()).join('');
const archive = Buffer.from(encoded, 'base64');
const actualSha = createHash('sha256').update(archive).digest('hex');
if (actualSha !== EXPECTED_SHA) throw new Error(`CRM V2 package checksum mismatch: ${actualSha}`);

const tar = gunzipSync(archive);
let offset = 0;
while (offset + 512 <= tar.length) {
  const header = tar.subarray(offset, offset + 512);
  if (header.every((byte) => byte === 0)) break;

  const readString = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '').trim();
  const name = readString(0, 100);
  const prefix = readString(345, 155);
  const relative = prefix ? `${prefix}/${name}` : name;
  const size = Number.parseInt(readString(124, 12) || '0', 8) || 0;
  const type = String.fromCharCode(header[156] || 48);
  const target = resolve(ROOT, relative);

  if (!(target === ROOT || target.startsWith(`${ROOT}${sep}`))) throw new Error(`Unsafe package path: ${relative}`);
  if (type === '5') mkdirSync(target, { recursive: true });
  else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, tar.subarray(offset + 512, offset + 512 + size));
  }

  offset += 512 + Math.ceil(size / 512) * 512;
}

console.log(`Materialized CRM V2 from ${parts.length} checksum-verified source segments.`);
