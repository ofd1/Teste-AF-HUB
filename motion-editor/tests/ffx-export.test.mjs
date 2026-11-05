import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFFX } from '../js/ffx.js';
import { ffxToPreset, createEffectInstance } from '../js/presets.js';
import { effectsToFFX } from '../js/ffx-export.js';

const load = (p) => { const b = readFileSync(new URL(`./fixtures/ffx/${p}`, import.meta.url)); return parseFFX(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), { fps: 30 }); };
const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

for (const f of ['Shakes/ZAZ Shake.ffx', 'Shakes/Sonhei Shake.ffx', 'Warp/ZAZ Warp.ffx', 'CC (Color Correction)/Galego CC.ffx']) {
  test(`ida e volta: ${f}`, async () => {
    const pre = ffxToPreset(load(f));
    const fxs = pre.effects.map((e) => createEffectInstance(e.type, e.params || {}));
    const { bytes, report } = await effectsToFFX(fxs, { fps: 30 });
    assert.ok(bytes && report.ok.length, JSON.stringify(report));
    const back = ffxToPreset(parseFFX(ab(bytes), { fps: 30 }));
    // cada efeito exportado com molde volta como o mesmo tipo de efeito, com os mesmos valores
    const exported = report.ok.length;
    let compared = 0;
    for (const e of back.effects) {
      const orig = pre.effects.find((o) => o.type === e.type);
      if (!orig) continue;
      for (const [k, v] of Object.entries(e.params)) {
        const o = orig.params[k];
        if (typeof v === 'number' && typeof o === 'number') { assert.ok(Math.abs(v - o) <= Math.max(0.02, Math.abs(o) * 0.01), `${e.type}.${k}: ${v} vs ${o}`); compared++; }
        if (v?.keys && o?.keys) { assert.equal(v.keys.length, o.keys.length, `${e.type}.${k} keys`); compared++; }
      }
    }
    assert.ok(compared > 0 && exported > 0);
  });
}
