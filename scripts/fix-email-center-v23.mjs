import { readFile, writeFile } from 'node:fs/promises';

const emailPath = 'src/email.js';
let emailContent = await readFile(emailPath, 'utf8');
const redundant = `  const q = text(url.searchParams.get('q'));
  if (q) {
    const match = \`%\${q.toLowerCase()}%\`;
    conditions.push(\`(lower(m.subject) LIKE ? OR lower(m.from_email) LIKE ? OR lower(COALESCE(o.name,'')) LIKE ? OR lower(COALESCE(c.first_name,'')||' '||COALESCE(c.last_name,'')) LIKE ?)\`);
    bindings.push(match, match, match, match);
  }
`;
const occurrences = emailContent.split(redundant).length - 1;
if (occurrences > 1) throw new Error(`Unexpected duplicate correction count: ${occurrences}`);
if (occurrences === 1) emailContent = emailContent.replace(redundant, '');
await writeFile(emailPath, emailContent);

const mockTestPath = 'tests/mock-server.test.mjs';
let mockTest = await readFile(mockTestPath, 'utf8');
if (mockTest.includes("assert.equal(health.version,'2.0.0')")) {
  mockTest = mockTest.replace("assert.equal(health.version,'2.0.0')", "assert.equal(health.version,'2.3.0')");
} else if (!mockTest.includes("assert.equal(health.version,'2.3.0')")) {
  throw new Error('Unable to update mock health version assertion');
}
await writeFile(mockTestPath, mockTest);
console.log(`${occurrences ? 'Removed redundant Email Center search injection. ' : ''}Updated mock health assertion to v2.3.0.`);
