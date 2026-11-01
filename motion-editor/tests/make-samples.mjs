// Gera os arquivos .ffx de exemplo em samples/
import { writeFileSync, mkdirSync } from 'node:fs';
import { blurGlowFFX, animationFFX, pseudoControlsFFX } from './fixtures.mjs';
const dir = new URL('../samples/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('blur-glow-sombra.ffx', dir), blurGlowFFX());
writeFileSync(new URL('animacao-pop-tint.ffx', dir), animationFFX());
writeFileSync(new URL('pseudo-controles.ffx', dir), pseudoControlsFFX());
console.log('samples gerados');
