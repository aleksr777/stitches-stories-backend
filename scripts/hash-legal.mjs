import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const canonical = (value) =>
  Array.isArray(value)
    ? '[' + value.map(canonical).join(',') + ']'
    : value !== null && typeof value === 'object'
      ? '{' +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
          .join(',') +
        '}'
      : JSON.stringify(value);
const path = new URL('../src/legal/documents.json', import.meta.url);
const docs = JSON.parse(readFileSync(path, 'utf8'));
for (const doc of Object.values(docs)) {
  const { sha256, ...unsigned } = doc;
  doc.sha256 = createHash('sha256').update(canonical(unsigned)).digest('hex');
}
writeFileSync(path, JSON.stringify(docs, null, 2) + '\n');
console.log(
  'Хеши пересчитаны. Для изменённого документа обязательно укажите новую version; ранее сохранённые версии неизменяемы.',
);
