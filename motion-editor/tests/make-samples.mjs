// Gera os arquivos .ffx sintéticos de exemplo em samples/.
import { writeFileSync, mkdirSync } from 'node:fs';
import { blurGlowFFX, animationFFX, pseudoControlsFFX, pluginsFFX } from './fixtures.mjs';

const samples = new URL('../samples/', import.meta.url);
const free = null; // pacote FREE agora contém os presets reais (presets/free/)
mkdirSync(samples, { recursive: true });

const files = {
  'blur-glow-sombra.ffx': blurGlowFFX(),
  'animacao-pop-tint.ffx': animationFFX(),
  'pseudo-controles.ffx': pseudoControlsFFX(),
  'plugins-de-edit.ffx': pluginsFFX(),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(new URL(name, samples), data);

}
console.log('samples gerados');
