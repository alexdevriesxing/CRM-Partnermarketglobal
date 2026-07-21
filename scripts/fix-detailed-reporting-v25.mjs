import { readFile, writeFile } from 'node:fs/promises';

async function update(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  await writeFile(path, after);
}

await update('tests/intelligence.test.mjs', (content) => content
  .replace("commercial intelligence release reports v2.4.0", "commercial intelligence release reports v2.5.0")
  .replace("assert.equal(JSON.parse(pkg).version,'2.4.0')", "assert.equal(JSON.parse(pkg).version,'2.5.0')")
  .replace("assert.equal(JSON.parse(pkg).version, '2.4.0')", "assert.equal(JSON.parse(pkg).version, '2.5.0')"));

await update('scripts/dev-server.mjs', (content) => content
  .replace("const start=new Date(from+'T00:00:00Z'),end=new Date(to+'T23:59:59Z');\n    const days=Math.round((end-start)/864e5)+1;", "const start=new Date(from+'T00:00:00Z'),endDate=new Date(to+'T00:00:00Z'),end=new Date(to+'T23:59:59Z');\n    const days=Math.round((endDate-start)/864e5)+1;"));

console.log('Corrected v2.5 release expectation and inclusive mock report dates.');
