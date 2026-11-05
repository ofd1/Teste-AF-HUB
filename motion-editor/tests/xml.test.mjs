import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { xmlToProject } from '../js/xml-import.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/xml/${n}`, import.meta.url), 'utf8');

test('Premiere / FCP7 xmeml: clipes, transição, velocidade e trilhas', () => {
  const { project: p, media } = xmlToProject(fx('premiere.xml'));
  assert.equal(p.width, 1080); assert.equal(p.height, 1920); assert.equal(p.fps, 30);
  assert.deepEqual(media.sort(), ['A.mp4', 'B.mov', 'logo.png', 'song.mp3']);
  const by = Object.fromEntries(p.layers.map((l) => [l.props.aeMedia.file, l]));
  assert.equal(p.layers[0].props.aeMedia.file, 'logo.png'); // trilha V2 fica em cima
  assert.equal(by['A.mp4'].inPoint, 0); assert.equal(by['A.mp4'].outPoint, 3.3333);
  assert.equal(by['A.mp4'].props.aeMedia.sourceStart, 1);
  assert.equal(by['B.mov'].inPoint, 2.6667); assert.equal(by['B.mov'].props.aeMedia.speed, 0.5);
  assert.deepEqual(by['B.mov'].transform.scale.value, [120, 120]);
  assert.equal(by['song.mp3'].props.aeMedia.kind, 'audio');
  assert.deepEqual(p.markers, [2]);
});

test('FCPXML: clipe conectado, gap e transformação', () => {
  const { project: p } = xmlToProject(fx('finalcut.fcpxml'));
  assert.equal(p.width, 1920); assert.equal(p.fps, 29.97);
  const names = p.layers.map((l) => l.name);
  assert.deepEqual(names, ['⚠ clip1', '⚠ clip1b', '⚠ music']);
  assert.equal(p.layers[1].inPoint, 6); assert.equal(p.layers[1].props.aeMedia.sourceStart, 10);
  assert.equal(p.layers[2].inPoint, 0); assert.equal(p.layers[2].outPoint, 5);
  assert.deepEqual(p.layers[0].transform.scale.value, [150, 150]);
});
