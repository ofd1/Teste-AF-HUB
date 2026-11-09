import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { probeMp4, needsProxy } from '../js/proxy.js';

test('lê o índice do MP4/MOV (codec, tamanho, amostras, áudio) sem carregar o vídeo', async () => {
  const f = new Blob([readFileSync(new URL('./fixtures/video/a_end.mov', import.meta.url))]);
  const info = await probeMp4(f);
  assert.match(info.video.codec, /^avc1\.[0-9a-f]{6}$/);
  assert.equal(info.video.width, 640); assert.equal(info.video.height, 360);
  assert.equal(info.video.table.n, 450); // 15 s × 30 fps
  assert.ok(info.audio && info.audio.channels === 2 && info.audio.sampleRate === 44100);
  assert.equal(needsProxy({ size: 1.6e9 }, 2160, 3840), true);
  assert.equal(needsProxy({ size: 40e6 }, 1080, 1920), false);
});
