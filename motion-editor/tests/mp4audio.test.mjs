import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractAudioADTS } from '../js/mp4audio.js';

// Blob mínimo (Node 22 tem Blob global): a extração lê só o índice e os trechos de áudio
test('extrai só a trilha AAC do MP4 (sem ler o vídeo inteiro) e detecta vídeo sem som', async () => {
  const mk = (f) => new Blob([readFileSync(new URL(`./fixtures/video/${f}`, import.meta.url))]);
  const a = await extractAudioADTS(mk('a_fast.mp4'));
  assert.ok(a && a.length > 1000 && a[0] === 0xff && (a[1] & 0xf0) === 0xf0, 'ADTS válido');
  const b = await extractAudioADTS(mk('a_end.mov'));   // índice (moov) no fim do arquivo
  assert.ok(b && b.length > 1000);
  assert.equal(await extractAudioADTS(mk('a_mute.mp4')), false);
});
