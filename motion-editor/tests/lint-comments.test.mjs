import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Um comentário // no meio da linha "engole" o código depois dele (já desligou metade do BCC Lens Blur).
// Procura linhas de código em que, depois de um //, ainda aparece algo como "u_xxx:" ou "chave: valor,".
test('nenhum comentário // engole parâmetros na mesma linha', () => {
  const dir = new URL('../js/fx/', import.meta.url);
  const bad = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    readFileSync(new URL(f, dir), 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*')) return;
      const k = line.search(/(^|[^:'"`\\])\/\/(?![^'"`]*['"`]\s*[,)])/);
      if (k < 0) return;
      const after = line.slice(k);
      if (/\bu_\w+\s*:/.test(after)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
