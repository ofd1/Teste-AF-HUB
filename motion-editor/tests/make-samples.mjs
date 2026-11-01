// Gera os arquivos .ffx de exemplo em samples/ e no pacote FREE (presets/free/Exemplos AE/).
import { writeFileSync, mkdirSync } from 'node:fs';
import { blurGlowFFX, animationFFX, pseudoControlsFFX, pluginsFFX } from './fixtures.mjs';

const samples = new URL('../samples/', import.meta.url);
const free = new URL('../presets/free/Exemplos AE/', import.meta.url);
mkdirSync(samples, { recursive: true });
mkdirSync(free, { recursive: true });
const files = {
  'blur-glow-sombra.ffx': blurGlowFFX(),
  'animacao-pop-tint.ffx': animationFFX(),
  'pseudo-controles.ffx': pseudoControlsFFX(),
  'plugins-de-edit.ffx': pluginsFFX(),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(new URL(name, samples), data);
  writeFileSync(new URL(name, free), data);
}
console.log('samples gerados');
