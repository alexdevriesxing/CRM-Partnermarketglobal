import { readFile, writeFile } from 'node:fs/promises';

const path = 'tests/email-center.test.mjs';
let content = await readFile(path, 'utf8');
content = content
  .replace("test('release and mock server identify v2.3.0'", "test('release and mock server identify v2.4.0'")
  .replace("assert.equal(JSON.parse(pkg).version, '2.3.0')", "assert.equal(JSON.parse(pkg).version, '2.4.0')")
  .replace(/version:'2\\\.3\\\.0'/g, "version:'2\\.4\\.0'");
await writeFile(path, content);
console.log('Updated prior release regression to v2.4.0.');
