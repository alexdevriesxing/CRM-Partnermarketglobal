import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/email.js';
let content = await readFile(path, 'utf8');
const redundant = `  const q = text(url.searchParams.get('q'));
  if (q) {
    const match = \`%\${q.toLowerCase()}%\`;
    conditions.push(\`(lower(m.subject) LIKE ? OR lower(m.from_email) LIKE ? OR lower(COALESCE(o.name,'')) LIKE ? OR lower(COALESCE(c.first_name,'')||' '||COALESCE(c.last_name,'')) LIKE ?)\`);
    bindings.push(match, match, match, match);
  }
`;
const occurrences = content.split(redundant).length - 1;
if (occurrences > 1) throw new Error(`Unexpected duplicate correction count: ${occurrences}`);
if (occurrences === 1) content = content.replace(redundant, '');
await writeFile(path, content);
console.log(occurrences ? 'Removed redundant Email Center search injection.' : 'No redundant Email Center search injection found.');
