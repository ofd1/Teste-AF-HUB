// Importador de linha do tempo em XML:
//  • FCP7 XML (xmeml) — exportado pelo Premiere Pro, DaVinci Resolve, Final Cut 7, Vegas…
//  • FCPXML — Final Cut Pro X / DaVinci Resolve
// Vira um projeto com as camadas de vídeo/foto/áudio no tempo certo (entrada, saída, ponto do arquivo, velocidade,
// escala/posição/rotação/opacidade básicas e marcadores). Os arquivos de mídia não vêm no XML: entram como espaços
// reservados (os mesmos do .aep) e são conectados depois pelo nome do arquivo.
import { createProject, LAYER_FACTORIES } from './state.js';
import { EFFECT_MAP } from './effects.js';
import { uid } from './util.js';
import { clone } from './anim.js';
const setv = (p, v) => { p.value = clone(v); };

// ---------------------------------------------------------------- XML mínimo (sem DOM, funciona em teste no Node)
export function parseXML(text) {
  const root = { name: '#root', attrs: {}, kids: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const ent = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e.toLowerCase()] ?? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)));
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] != null) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const attrs = {};
      (m[4] || '').replace(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (_, k, __, a, b) => { attrs[k] = ent(a ?? b ?? ''); });
      const el = { name: m[3], attrs, kids: [], text: '', parent: top };
      top.kids.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6]) top.text += ent(m[6]);
  }
  return root;
}
const kid = (el, name) => el?.kids.find((k) => k.name === name);
const kids = (el, name) => (el?.kids || []).filter((k) => k.name === name);
const txt = (el, name) => (name ? kid(el, name) : el)?.text.trim() ?? '';
const num = (v, d = 0) => (v === '' || v == null || Number.isNaN(+v) ? d : +v);
function find(el, name) { if (!el) return null; if (el.name === name) return el; for (const k of el.kids) { const r = find(k, name); if (r) return r; } return null; }
function findAll(el, name, out = []) { if (!el) return out; if (el.name === name) out.push(el); for (const k of el.kids) findAll(k, name, out); return out; }

const AUD_EXT = /\.(mp3|wav|aiff?|m4a|aac|ogg|flac)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|bmp|tiff?|webp|psd|heic|exr)$/i;
const baseName = (p) => decodeURIComponent(String(p || '').replace(/^file:\/\/(localhost)?/i, '')).split(/[\\/]/).pop();

export function isTimelineXML(text) { return /<xmeml[\s>]|<fcpxml[\s>]|<scene[\s>]/i.test(text.slice(0, 4000)); }

/** Converte o XML em { project, media:[nomes], notes:[] }. */
export function xmlToProject(text, fileName = 'Timeline') {
  const doc = parseXML(text);
  if (find(doc, 'fcpxml')) return fromFCPXML(doc, fileName);
  if (find(doc, 'xmeml')) return fromXMEML(doc, fileName);
  if (find(doc, 'scene')) return fromAlightMotion(doc, fileName);
  throw new Error('não é um XML de projeto (Alight Motion / Gold Motion, Premiere/FCP7 xmeml ou FCPXML).');
}

function placeholder(proj, { file, kind, w, h, sourceStart, speed }) {
  const l = LAYER_FACTORIES.solid(proj);
  l.props.width = kind === 'audio' ? 2 : w; l.props.height = kind === 'audio' ? 2 : h; l.props.fill = '#26262e';
  l.props.aeMedia = { file, path: '', kind, width: w, height: h, fps: 0, sourceStart: Math.max(0, sourceStart || 0), speed: speed || 1, fit: 'cover' };
  return l;
}

// ---------------------------------------------------------------- FCP7 xmeml (Premiere)
function rateOf(el) {
  const r = kid(el, 'rate');
  if (!r) return null;
  const tb = num(txt(r, 'timebase'), 30), ntsc = /true/i.test(txt(r, 'ntsc'));
  return ntsc ? tb * 1000 / 1001 : tb;
}
function fromXMEML(doc, fileName) {
  const seqs = findAll(doc, 'sequence').filter((s) => kid(s, 'media'));
  if (!seqs.length) throw new Error('nenhuma sequência no XML.');
  const seq = seqs.sort((a, b) => num(txt(b, 'duration')) - num(txt(a, 'duration')))[0];
  const fps = rateOf(seq) || 30;
  const media = kid(seq, 'media');
  const sc = find(kid(kid(kid(media, 'video'), 'format'), 'samplecharacteristics'), 'samplecharacteristics');
  const W = num(txt(sc, 'width'), 1920), H = num(txt(sc, 'height'), 1080);
  const proj = createProject(W, H);
  proj.name = txt(seq, 'name') || fileName;
  proj.fps = Math.round(fps * 1000) / 1000;
  const notes = [], files = new Map();
  // os <file id> completos aparecem uma vez; as outras referências são vazias
  for (const f of findAll(doc, 'file')) {
    const id = f.attrs.id;
    if (!id || files.has(id) && !kid(f, 'name') && !kid(f, 'pathurl')) continue;
    const vs = find(kid(kid(f, 'media'), 'video'), 'samplecharacteristics');
    const prev = files.get(id) || {};
    files.set(id, { name: txt(f, 'name') || baseName(txt(f, 'pathurl')) || prev.name || '', path: txt(f, 'pathurl') || prev.path || '', w: num(txt(vs, 'width'), prev.w || 0), h: num(txt(vs, 'height'), prev.h || 0), rate: rateOf(f) || prev.rate || fps, hasVideo: !!kid(kid(f, 'media'), 'video') || prev.hasVideo, hasAudio: !!kid(kid(f, 'media'), 'audio') || prev.hasAudio });
  }
  let dur = num(txt(seq, 'duration')) / fps;
  const layers = [];
  const doTracks = (kindEl, kind) => {
    const tracks = kids(kindEl, 'track');
    tracks.forEach((tr, ti) => {
      if (/false/i.test(txt(tr, 'enabled'))) return;
      let prevEnd = 0;
      const items = tr.kids.filter((k) => k.name === 'clipitem' || k.name === 'transitionitem' || k.name === 'generatoritem');
      items.forEach((ci, ii) => {
        if (ci.name === 'transitionitem') return;
        let start = num(txt(ci, 'start'), -1), end = num(txt(ci, 'end'), -1);
        // -1 = encostado numa transição: usa as pontas da transição
        if (start < 0) { const tp = items[ii - 1]; start = tp?.name === 'transitionitem' ? num(txt(tp, 'start'), prevEnd) : prevEnd; }
        if (end < 0) { const tn = items[ii + 1]; end = tn?.name === 'transitionitem' ? num(txt(tn, 'end'), start) : start + (num(txt(ci, 'out')) - num(txt(ci, 'in'))); }
        prevEnd = end;
        if (end <= start) return;
        const inP = start / fps, outP = end / fps;
        if (ci.name === 'generatoritem') return;
        const fEl = kid(ci, 'file');
        const f = files.get(fEl?.attrs.id) || { name: txt(ci, 'name'), w: 0, h: 0, rate: fps };
        const name = f.name || txt(ci, 'name') || 'mídia';
        // em clipes ligados (vídeo+áudio do mesmo arquivo), o áudio vira o som do próprio vídeo
        if (kind === 'audio' && f.hasVideo && !AUD_EXT.test(name)) return;
        let speed = 1, reverse = false, scale = null, rot = 0, center = null, opacity = null;
        for (const fx of findAll(ci, 'effect')) {
          const id = txt(fx, 'effectid').toLowerCase();
          const par = (pid) => kids(fx, 'parameter').find((p) => txt(p, 'parameterid').toLowerCase() === pid);
          if (id === 'timeremap') { const sp = par('speed'); if (sp) speed = num(txt(sp, 'value'), 100) / 100; reverse = /true/i.test(txt(par('reverse'), 'value')); }
          if (id === 'basic') {
            const s = par('scale'); if (s) scale = num(txt(s, 'value'), 100);
            const r = par('rotation'); if (r) rot = num(txt(r, 'value'), 0);
            const c = par('center'); if (c) { const v = kid(c, 'value'); center = [num(txt(v, 'horiz')), num(txt(v, 'vert'))]; }
          }
          if (id === 'opacity') { const o = par('opacity'); if (o) opacity = num(txt(o, 'value'), 100); }
        }
        if (speed < 0) { reverse = true; speed = -speed; }
        const srcRate = f.rate || fps;
        const kindM = AUD_EXT.test(name) || kind === 'audio' ? 'audio' : IMG_EXT.test(name) ? 'image' : 'video';
        const mw = f.w || W, mh = f.h || H;
        const l = placeholder(proj, { file: name, kind: kindM, w: mw, h: mh, sourceStart: num(txt(ci, 'in')) / srcRate, speed });
        l.name = `⚠ ${txt(ci, 'name') || name}`;
        l.inPoint = +inP.toFixed(4); l.outPoint = +outP.toFixed(4);
        l.track = { kind, index: ti };
        if (kindM !== 'audio') {
          // sem "basic motion" o Premiere encaixa a mídia no quadro: escala para caber
          const fitK = scale != null ? scale : Math.min(W / mw, H / mh) * 100;
          setv(l.transform.scale, [fitK, fitK]);
          if (center) setv(l.transform.position, [W / 2 + center[0] * W / 2, H / 2 + center[1] * H / 2]);
          if (rot) setv(l.transform.rotation, rot);
          if (opacity != null) setv(l.transform.opacity, opacity);
          if (!/false/i.test(txt(ci, 'enabled'))) l.visible = true; else l.visible = false;
        }
        if (reverse) l.props.aeMedia.reverse = true;
        dur = Math.max(dur, outP);
        layers.push(l);
      });
    });
  };
  doTracks(kid(media, 'video'), 'video');
  doTracks(kid(media, 'audio'), 'audio');
  // trilha 1 = embaixo no Premiere; no MotionFrame a primeira camada fica em cima
  layers.sort((a, b) => (a.track.kind === b.track.kind ? b.track.index - a.track.index || a.inPoint - b.inPoint : a.track.kind === 'video' ? -1 : 1));
  layers.forEach((l) => delete l.track);
  proj.layers = layers;
  proj.duration = Math.max(1, +dur.toFixed(3));
  proj.markers = kids(seq, 'marker').map((mk) => +(num(txt(mk, 'in'), -1) / fps).toFixed(4)).filter((t) => t >= 0);
  if (layers.some((l) => l.props.aeMedia.reverse)) notes.push('Clipes em reverse: aplique o preset Reverse depois de conectar a mídia.');
  return { project: proj, media: [...new Set(layers.map((l) => l.props.aeMedia.file))], notes };
}

// ---------------------------------------------------------------- FCPXML (Final Cut / DaVinci)
function fcpTime(s) {
  if (!s) return 0;
  const m = String(s).match(/^(-?\d+)(?:\/(\d+))?s$/);
  return m ? +m[1] / (+m[2] || 1) : num(s);
}
function fromFCPXML(doc, fileName) {
  const res = find(doc, 'resources');
  const formats = new Map(), assets = new Map();
  for (const f of kids(res, 'format')) formats.set(f.attrs.id, { w: num(f.attrs.width, 1920), h: num(f.attrs.height, 1080), fd: fcpTime(f.attrs.frameDuration) });
  for (const a of kids(res, 'asset')) {
    const src = a.attrs.src || kid(a, 'media-rep')?.attrs.src || '';
    const fm = formats.get(a.attrs.format);
    assets.set(a.attrs.id, { name: baseName(src) || a.attrs.name || 'mídia', start: fcpTime(a.attrs.start), w: fm?.w || 0, h: fm?.h || 0, hasVideo: a.attrs.hasVideo === '1', hasAudio: a.attrs.hasAudio === '1' });
  }
  const seq = find(doc, 'sequence');
  if (!seq) throw new Error('nenhuma sequência no FCPXML.');
  const fm = formats.get(seq.attrs.format) || { w: 1920, h: 1080, fd: 1 / 30 };
  const W = fm.w, H = fm.h;
  const proj = createProject(W, H);
  proj.name = find(doc, 'project')?.attrs.name || fileName;
  proj.fps = fm.fd ? Math.round(1000 / fm.fd) / 1000 : 30;
  const layers = [], notes = [];
  let dur = fcpTime(seq.attrs.duration);
  const CLIPS = new Set(['asset-clip', 'clip', 'video', 'audio', 'ref-clip', 'sync-clip', 'mc-clip', 'title', 'gap']);
  // tempo da timeline = deslocamento do pai + (offset do filho − start do pai)
  const walk = (el, base, parentStart, lane) => {
    for (const c of el.kids) {
      if (!CLIPS.has(c.name)) { if (c.name === 'spine') walk(c, base, parentStart, lane); continue; }
      const offset = fcpTime(c.attrs.offset), start = fcpTime(c.attrs.start), d = fcpTime(c.attrs.duration);
      const t0 = base + offset - parentStart;
      const myLane = c.attrs.lane != null ? num(c.attrs.lane) : lane;
      const ref = c.attrs.ref || kid(c, 'video')?.attrs.ref || kid(c, 'audio')?.attrs.ref;
      const a = assets.get(ref);
      if (a && c.name !== 'gap' && c.name !== 'title' && d > 0) {
        const isAud = c.name === 'audio' || (!a.hasVideo && a.hasAudio) || AUD_EXT.test(a.name);
        const kindM = isAud ? 'audio' : IMG_EXT.test(a.name) ? 'image' : 'video';
        let speed = 1;
        const tm = kid(c, 'timeMap');
        if (tm) { const pts = kids(tm, 'timept'); if (pts.length >= 2) { const p0 = pts[0], p1 = pts[pts.length - 1]; const dt = fcpTime(p1.attrs.time) - fcpTime(p0.attrs.time), dv = fcpTime(p1.attrs.value) - fcpTime(p0.attrs.value); if (dt > 0 && dv) speed = Math.abs(dv / dt); } }
        const l = placeholder(proj, { file: a.name, kind: kindM, w: a.w || W, h: a.h || H, sourceStart: start - a.start, speed });
        l.name = `⚠ ${c.attrs.name || a.name}`;
        l.inPoint = +Math.max(0, t0).toFixed(4); l.outPoint = +(t0 + d).toFixed(4);
        if (kindM !== 'audio') {
          const mw = a.w || W, mh = a.h || H;
          let k = Math.min(W / mw, H / mh) * 100;
          const at = kid(c, 'adjust-transform');
          if (at) {
            const sc = (at.attrs.scale || '1 1').split(/\s+/).map(Number);
            k *= sc[0] || 1;
            const pos = (at.attrs.position || '0 0').split(/\s+/).map(Number); // em % da altura, y para cima
            setv(l.transform.position, [W / 2 + (pos[0] || 0) / 100 * H, H / 2 - (pos[1] || 0) / 100 * H]);
            if (at.attrs.rotation) setv(l.transform.rotation, -num(at.attrs.rotation));
          }
          setv(l.transform.scale, [k, k]);
        }
        l.lane = myLane;
        if (c.attrs.enabled === '0') l.visible = false;
        layers.push(l);
        dur = Math.max(dur, t0 + d);
      }
      // clipes conectados e conteúdos de sync-clip ficam dentro do clipe
      walk(c, t0, start, myLane);
    }
  };
  walk(seq, 0, 0, 0);
  layers.sort((a, b) => b.lane - a.lane || a.inPoint - b.inPoint);
  layers.forEach((l) => delete l.lane);
  proj.layers = layers;
  proj.duration = Math.max(1, +dur.toFixed(3));
  proj.markers = findAll(seq, 'marker').map((mk) => +fcpTime(mk.attrs.start).toFixed(4));
  return { project: proj, media: [...new Set(layers.map((l) => l.props.aeMedia.file))], notes };
}

// ---------------------------------------------------------------- Alight Motion / Gold Motion / Alemon (XML ou .amproj)
// Formato conferido em projetos reais (.amproj = ZIP com o XML + mídias):
//  <scene width height totalTime(ms) fps bgcolor="#AARRGGBB"> com <media uri="amproj:arquivo" type="image/jpeg|video/mp4"/>
//  camadas <shape s=".rect|.circle|.poly|.star|…" fillType="color|media|gradient|none|intrinsic" fillImage="amproj:…">,
//  <text font="googlefonts?name=Roboto&weight=400" size align><content>…</content>, <embedScene> (grupo com <scene> dentro),
//  <nullobj>, atributos startTime/endTime (ms), blending="multiply…", parent="id".
//  <transform><location value="x,y,z"/><scale value="sx,sy" (0–1)/><rotation/><opacity (0–1)/><pivot/> e animação
//  <prop><kf t="0–1 da duração da camada" v="…" e="cubicBezier x1 y1 x2 y2|step|bounce|elastic|cyclic …"/></prop>.
//  Efeitos: <effect id="com.alightcreative.effects.…"><property name type value/> (ou com <kf>).
const amNum = (s) => String(s ?? '').split(',').map(Number).filter((x) => Number.isFinite(x));
function amColor(s) {
  const m = String(s || '').match(/#?([0-9a-f]{6,8})/i);
  if (!m) return null;
  const a = m[1].length === 8 ? parseInt(m[1].slice(0, 2), 16) / 255 : 1;
  const h = m[1].length === 8 ? m[1].slice(2) : m[1];
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, a];
}
const hexOf = (c) => '#' + c.slice(0, 3).map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
/** Easing do keyframe do Alight Motion → curva do MotionFrame (vale do keyframe até o próximo). */
function amEase(e) {
  const s = String(e || '').trim();
  if (!s) return { ease: 'linear' };
  const [kind, ...n] = s.replace(/^reverse\s+/, '').split(/\s+/);
  const v = n.map(Number);
  switch (kind) {
    case 'cubicBezier': return v.length >= 4 ? { ease: 'curve', curve: v.slice(0, 4) } : { ease: 'easeInOut' };
    case 'step': return { ease: 'hold' };
    case 'bounce': return { ease: 'bounce' };
    case 'elastic': case 'elasticStep': return { ease: 'elastic' };
    default: return { ease: 'linear' }; // cyclic e outros: aproximado
  }
}
/** Propriedade animável: valor fixo (atributo value) ou keyframes <kf> (t de 0 a 1 na duração da camada). */
function amAnim(el, conv, t0, dur) {
  if (!el) return null;
  const kfs = kids(el, 'kf');
  if (kfs.length) {
    const norm01 = kfs.every((k) => num(k.attrs.t) <= 1.0001);
    const keys = kfs.map((k) => ({ t: +(t0 + (norm01 ? num(k.attrs.t) * dur : num(k.attrs.t) / 1000)).toFixed(4), v: conv(amNum(k.attrs.v), k.attrs.v), ...amEase(k.attrs.e) }))
      .sort((a, b) => a.t - b.t);
    return { keys };
  }
  const v = el.attrs.value ?? txt(el);
  return v === '' || v == null ? null : { value: conv(amNum(v), v) };
}
const setAP = (prop, v) => { if (!v) return; if (v.keys) { prop.keys = v.keys; prop.value = clone(v.keys[0].v); } else prop.value = v.value; };
const AM_BLEND = { multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color-dodge', 'color-burn': 'color-burn',
  'hard-light': 'hard-light', 'soft-light': 'soft-light', diff: 'difference', difference: 'difference', exclude: 'exclusion', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation',
  color: 'color', luminosity: 'luminosity', add: 'lighter', lighter: 'lighter', 'darker-color': 'darken', 'lighter-color': 'lighten', divide: 'color-dodge', subtract: 'difference' };

// efeitos do Alight Motion (ids reais) → efeito do MotionFrame com conversão dos parâmetros
const P = (el) => { const o = {}; for (const pr of kids(el, 'property')) o[pr.attrs.name] = pr; return o; };
const AM_EXACT = {
  gaussianblur: ['blur', { strength: ['radius', (v) => v * 100] }],
  boxblur: ['blur', { strength: ['radius', (v) => v * 100] }],
  motionblur: ['motionBlur', {}],
  directionalblur: ['dirBlur', { strength: ['length', (v) => v * 100], angle: ['angle'] }],
  zoomblur: ['radialBlur', { strength: ['amount', (v) => v * 100] }],
  radialblur: ['radialBlur', { strength: ['amount', (v) => v * 100] }],
  exposure: ['exposure', { exposure: ['exposure'], offset: ['offset'], gamma: ['gamma'] }],
  rgbsep: ['rgbSplit', { strength: ['amount', (v) => v * 40], angle: ['angle'] }],
  chromaticaberration: ['rgbSplit', { strength: ['amount', (v) => v * 40] }],
  wavewarp2: ['waveWarp', { m1: ['height'], a1d: ['direction'] }],
  wavewarp: ['waveWarp', {}],
  pixelate2: ['mosaic', {}],
  pixelate: ['mosaic', {}],
  mirror: ['mirror', {}],
  threshold: ['threshold', { threshold: ['level', (v) => v * 255] }],
  wipe2: ['linearWipe', { start: ['completion', (v) => v * 100], angle: ['angle'], feather: ['feather', (v) => v * 100] }],
  chromakey: ['colorKey', { keyColor: ['key'], threshold: ['tolerance', (v) => v * 100] }],
  replacecolor: ['changeToColor', { oldcolor: ['from'], newcolor: ['to'] }],
  solidcolor: ['fill', { color: ['color'] }],
  rays: ['lightRays', { intensity: ['intensity'], threshold: ['threshold', (v) => v * 100] }],
  glow: ['glow', {}], neonglow: ['glow', {}], vignette: ['vignette', {}], sharpen: ['sharpen', {}],
  huesaturation: ['hueSat', {}], brightnesscontrast: ['brightnessContrast', {}], colortune: ['colorGrade', {}], tint: ['tint', {}],
  invertcolor: ['invert', {}], invert: ['invert', {}], noise: ['noise', {}], filmgrain: ['noise', {}], posterize: ['posterize', {}],
  twirl: ['twirl', {}], swirl: ['twirl', {}], bulge: ['bulge', {}], fisheye: ['fishEye', {}], stroke: ['outline', {}], border: ['outline', {}],
  dropshadow: ['dropShadow', {}], longshadow: ['dropShadow', {}], glitch: ['glitch', {}], vhs: ['vhs', {}], halftone: ['halftone', {}],
  kaleidoscope: ['kaleida', {}], polar: ['polar', {}], tile: ['motionTile', {}], displacement: ['turbulentDisplace', {}], turbulence: ['turbulentDisplace', {}],
  palettemap: ['tint', {}], grid2: ['motionTile', {}], lift: ['brightnessContrast', {}],
  shake: ['shake', {}], randomdisplace: ['shake', { mag: ['amount'], scatter: ['frequency', (v) => Math.max(2, v * 20)] }],
  jitter: ['shake', {}], flicker: ['flicker', {}], strobe: ['strobe', {}], lensflare: ['lensFlare', {}], lightleak: ['lightLeak', {}],
};
// sem equivalente direto, mas viram animação na própria camada
const AM_TO_KEYS = new Set(['fade', 'spin', 'swing2', 'oscillate3', 'textspacing', 'textprogress']);
const AM_FALLBACK = [
  [/shake|wiggle|jitter|random/, 'shake'], [/motion.?blur/, 'motionBlur'], [/zoom.?blur|radial.?blur/, 'radialBlur'], [/dir(ectional)?.?blur/, 'dirBlur'],
  [/gaussian|blur/, 'blur'], [/glow/, 'glow'], [/chromatic|rgb|split/, 'rgbSplit'], [/vignette/, 'vignette'], [/sharpen/, 'sharpen'],
  [/hue|saturation/, 'hueSat'], [/contrast|brightness/, 'brightnessContrast'], [/exposure/, 'exposure'], [/color.?(tune|correct|grade|adjust)/, 'colorGrade'],
  [/tint|colorize|duotone/, 'tint'], [/invert/, 'invert'], [/mirror/, 'mirror'], [/mosaic|pixel/, 'mosaic'], [/noise|grain/, 'noise'], [/wave/, 'waveWarp'],
  [/twirl|swirl/, 'twirl'], [/fish.?eye|bulge|lens/, 'bulge'], [/stroke|border|outline/, 'outline'], [/shadow/, 'dropShadow'], [/glitch/, 'glitch'],
  [/flicker|strobe/, 'flicker'], [/posterize/, 'posterize'], [/vhs|retro/, 'vhs'], [/tile|repeat/, 'motionTile'], [/displace|turbulen/, 'turbulentDisplace'],
];
function amEffect(type, map, fxEl, t0, dur) {
  const def = EFFECT_MAP[type];
  const fx = { id: uid('fx'), type, enabled: fxEl.attrs.enabled !== 'false', params: {} };
  for (const pd of def.params) fx.params[pd.key] = { value: Array.isArray(pd.default) ? pd.default.slice() : pd.default, keys: [] };
  const props = P(fxEl);
  const set = (key, pr, f = (x) => x) => {
    const pd = def.params.find((d) => d.key === key); if (!pd) return;
    const conv = (v, raw) => {
      if (pd.kind === 'color') return amColor(raw) || pd.default;
      if (pd.kind === 'bool') return /true|1/.test(String(raw));
      if (pd.kind === 'point') return [v[0] ?? 0.5, v[1] ?? 0.5];
      return f(v[0] ?? 0);
    };
    const a = amAnim(pr, conv, t0, dur);
    if (a) fx.params[key] = a.keys ? { value: clone(a.keys[0].v), keys: a.keys } : { value: a.value, keys: [] };
  };
  for (const [amKey, [ourKey, f]] of Object.entries(map)) if (props[amKey]) set(ourKey, props[amKey], f);
  // sem tabela: casa pelo nome do parâmetro
  if (!Object.keys(map).length) {
    // nomes comuns do AM/mods → parâmetro equivalente (força do desfoque 0–1 vira raio em px etc.)
    const ALIAS = { strength: [['radius', 100], ['amount', 100], ['length', 100], ['intensity', 1]], magnitude: [['amount', 100]], amount: [['amount', 100]],
      intensity: [['intensity', 1], ['amount', 100]], frequency: [['frequency', 1]], speed: [['speed', 1]], angle: [['angle', 1]], color: [['color', 1]], size: [['size', 1], ['radius', 1]] };
    for (const [n, pr] of Object.entries(props)) {
      const pd = def.params.find((d) => d.key.toLowerCase() === n.toLowerCase());
      if (pd && !ALIAS[n]) { set(pd.key, pr); continue; }
      const al = (ALIAS[n] || []).find(([k]) => def.params.some((d) => d.key === k));
      if (al) set(al[0], pr, (v) => (Math.abs(v) <= 1.0001 ? v * al[1] : v));
    }
  }
  return fx;
}
/** Efeitos do AM que viram keyframes na camada (Fade, Spin, Swing, Oscillate, espaçamento/progresso de texto). */
function amEffectToKeys(id, fxEl, l, st, en, fps) {
  const pr = P(fxEl), val = (n, d = 0) => num(pr[n]?.attrs.value, d), D = en - st;
  const tr = l.transform;
  if (id === 'fade') {
    const fi = Math.min(D / 2, val('inTime')), fo = Math.min(D / 2, val('outTime'));
    const ks = [];
    if (fi > 0) ks.push({ t: st, v: 0, ease: 'linear' }, { t: st + fi, v: 100, ease: 'linear' });
    if (fo > 0) ks.push({ t: en - fo, v: 100, ease: 'linear' }, { t: en, v: 0, ease: 'linear' });
    if (ks.length) { tr.opacity.keys = ks; tr.opacity.value = ks[0].v; }
  } else if (id === 'spin') {
    const r0 = tr.rotation.value || 0, rpm = val('rpm');
    tr.rotation.keys = [{ t: st, v: r0, ease: 'linear' }, { t: en, v: r0 + rpm * 6 * D, ease: 'linear' }];
  } else if (id === 'swing2' || id === 'oscillate3') {
    const f = Math.max(0.05, val('freq', 1)), ks = [], n = Math.min(400, Math.ceil(D * fps));
    const a1 = val('a1', -15), a2 = val('a2', 15), mag = val('mag', 20), ang = (val('angle', 0) * Math.PI) / 180, dir = val('direction', 0);
    const base = tr.position.value.slice(), r0 = tr.rotation.value || 0;
    for (let i = 0; i <= n; i++) {
      const t = st + (i / n) * D, s = Math.sin((t - st) * f * Math.PI * 2 + (val('phase') * Math.PI) / 180);
      if (id === 'swing2') ks.push({ t: +t.toFixed(4), v: r0 + a1 + (a2 - a1) * (s * 0.5 + 0.5), ease: 'linear' });
      else ks.push({ t: +t.toFixed(4), v: dir === 2 ? r0 + s * mag : [base[0] + Math.cos(ang) * s * mag * (dir === 1 ? 0 : 1), base[1] + Math.sin(ang) * s * mag], ease: 'linear' });
    }
    const target = id === 'swing2' || (id === 'oscillate3' && dir === 2) ? tr.rotation : tr.position;
    target.keys = ks; target.value = clone(ks[0].v);
  } else if (id === 'textspacing' && l.type === 'text') {
    l.props.letterSpacing = val('letterspacing') * (l.props.fontSize || 40);
    if (pr.linespacing) l.props.lineHeight = Math.max(0.5, 1.15 + val('linespacing'));
  } else if (id === 'textprogress' && l.type === 'text') {
    const a = amAnim(pr.end, (v) => (v[0] ?? 1) * 100, st, D);
    l.props.animators = [...(l.props.animators || []), { props: { opacity: { value: 0, keys: [] } }, selectors: [{ type: 'range', based: 1, shape: 1, smooth: 0, start: a ? (a.keys ? { value: a.keys[0].v, keys: a.keys } : { value: a.value, keys: [] }) : { value: 100, keys: [] }, end: { value: 100, keys: [] } }] }];
  }
}

function fromAlightMotion(doc, fileName) {
  const scene = find(doc, 'scene');
  const W = num(scene.attrs.width, 1080), H = num(scene.attrs.height, 1920);
  const proj = createProject(W, H);
  proj.name = scene.attrs.title || fileName;
  proj.fps = num(scene.attrs.fps, 30) || 30;
  const bg = amColor(scene.attrs.bgcolor); if (bg && bg[3] > 0) proj.background = hexOf(bg);
  const notes = [], media = new Set(), unsupported = new Set();
  // tabela de mídias do projeto (uri → arquivo, tipo, tamanho)
  const mediaInfo = new Map();
  for (const m of findAll(scene, 'media')) mediaInfo.set(m.attrs.uri, { file: m.attrs.filename || baseName(String(m.attrs.uri).replace(/^amproj:/, '')), type: m.attrs.type || '', w: num(m.attrs.width, 0), h: num(m.attrs.height, 0) });
  let dur = num(scene.attrs.totalTime, 0) / 1000;
  const idMap = new Map(), parents = [];
  const LAYER_TAGS = new Set(['shape', 'video', 'image', 'text', 'audio', 'embedScene', 'drawing', 'nullobj', 'nullObj', 'camera']);
  const build = (el, offset, sceneEl) => {
    const out = [];
    const sw = num(sceneEl.attrs.width, W), sh = num(sceneEl.attrs.height, H);
    for (const c of el.kids) {
      if (!LAYER_TAGS.has(c.name)) continue;
      const st = num(c.attrs.startTime, 0) / 1000 + offset, en = num(c.attrs.endTime, num(sceneEl.attrs.totalTime, 10000)) / 1000 + offset;
      if (en <= st) continue;
      const D = en - st;
      const size = amNum(kids(c, 'property').find((p) => p.attrs.name === 'size')?.attrs.value);
      const fill = amColor(kid(c, 'fillColor')?.attrs.value || c.attrs.fillColor);
      let l;
      const s = String(c.attrs.s || '').toLowerCase();
      if (c.name === 'text') {
        l = LAYER_FACTORIES.text(proj);
        l.props.text = txt(c, 'content') || c.attrs.label || 'Texto';
        l.props.fontSize = num(c.attrs.size, l.props.fontSize);
        const fm = /name=([^&]+)/.exec(String(c.attrs.font || '')), fw = /weight=(\d+)/.exec(String(c.attrs.font || ''));
        if (fm) l.props.fontFamily = `"${decodeURIComponent(fm[1].replace(/\+/g, ' '))}", sans-serif`;
        else if (c.attrs.font) l.props.fontFamily = `"${String(c.attrs.font).split('/').pop().replace(/\.(ttf|otf)$/i, '')}", sans-serif`;
        if (fw) l.props.fontWeight = +fw[1];
        if (c.attrs.align) l.props.align = c.attrs.align;
        if (fill) l.props.color = hexOf(fill);
      } else if (c.name === 'embedScene') {
        const inner = kid(c, 'scene') || c;
        l = LAYER_FACTORIES.group(proj, build(inner, st, inner));
      } else if (c.attrs.fillType === 'media' || c.name === 'video' || c.name === 'image' || c.name === 'audio') {
        const uri = c.attrs.fillImage || c.attrs.src || c.attrs.media || '';
        const mi = mediaInfo.get(uri) || { file: baseName(String(uri).replace(/^amproj:/, '')) || c.attrs.label, type: '' };
        const kind = c.name === 'audio' || /^audio/.test(mi.type) ? 'audio' : /^video/.test(mi.type) || c.name === 'video' ? 'video' : 'image';
        const w = size[0] || mi.w || sw, h = size[1] || mi.h || sh;
        l = placeholder(proj, { file: mi.file, kind, w, h, sourceStart: num(c.attrs.inTime ?? c.attrs.mediaStartTime, 0) / 1000, speed: num(c.attrs.speed, 1) || 1 });
        l.props.aeMedia.fit = 'fill';
        media.add(mi.file);
        l.name = `⚠ ${c.attrs.label || mi.file}`;
      } else if (c.name === 'nullobj' || c.name === 'nullObj' || c.name === 'camera') {
        l = LAYER_FACTORIES.null(proj);
      } else {
        // formas: .rect .roundrect .quad .circle .poly .star .triangle .plus .arrow .pie
        const w = size[0] || 100, h = size[1] || size[0] || 100;
        const col = fill ? fill.slice(0, 3) : [1, 1, 1];
        if (s === '.circle') { l = LAYER_FACTORIES.ellipse(proj); }
        else if (s === '.rect' || s === '.roundrect' || s === '.quad' || !s) { l = LAYER_FACTORIES.rect(proj); l.props.radius = s === '.roundrect' ? Math.min(w, h) * 0.15 : 0; }
        else {
          const pts = s === '.triangle' ? 3 : s === '.star' ? 5 : s === '.plus' ? 4 : 6;
          const item = { t: 'star', points: { value: pts, keys: [] }, outer: { value: Math.min(w, h) / 2, keys: [] }, inner: { value: Math.min(w, h) * (s === '.plus' ? 0.18 : 0.2), keys: [] }, kind: s === '.star' || s === '.plus' ? 1 : 2, rotation: { value: 0, keys: [] }, position: { value: [0, 0], keys: [] } };
          l = LAYER_FACTORIES.shape(proj, [{ t: 'group', items: [item, { t: 'fill', color: { value: col, keys: [] }, opacity: { value: (fill?.[3] ?? 1) * 100, keys: [] } }], tr: { position: { value: [0, 0], keys: [] }, scale: { value: [100, 100], keys: [] }, rotation: { value: 0, keys: [] }, opacity: { value: 100, keys: [] }, anchor: { value: [0, 0], keys: [] } } }]);
          if (!['.triangle', '.star', '.poly', '.plus'].includes(s)) notes.push(`Forma “${s}” aproximada.`);
        }
        if (l.type !== 'shape') {
          l.props.width = w; l.props.height = h;
          if (c.attrs.fillType === 'none') { l.props.fill = 'rgba(0,0,0,0)'; } else if (fill) l.props.fill = hexOf(fill);
          const gr = kid(c, 'gradient'); if (gr) { const g0 = amColor(gr.attrs.startColor); if (g0) l.props.fill = hexOf(g0); notes.push('Degradê das formas virou a 1ª cor.'); }
          const bd = kid(c, 'border'); if (bd) { l.props.strokeWidth = num(bd.attrs.size ?? bd.attrs.width, 4); const bc = amColor(bd.attrs.color); if (bc) l.props.strokeColor = hexOf(bc); }
        }
      }
      l.name = l.name && !/^(Texto|Grupo|Retângulo|Elipse|Formas|Null)$/.test(l.name) ? l.name : (c.attrs.label || l.name);
      l.inPoint = +st.toFixed(4); l.outPoint = +en.toFixed(4);
      if (c.attrs.blending && AM_BLEND[c.attrs.blending]) l.blend = AM_BLEND[c.attrs.blending];
      if (c.attrs.hidden === 'true') l.visible = false;
      const tr = kid(c, 'transform');
      if (tr) {
        setAP(l.transform.position, amAnim(kid(tr, 'location'), (v) => [v[0] ?? sw / 2, v[1] ?? sh / 2], st, D));
        setAP(l.transform.scale, amAnim(kid(tr, 'scale'), (v) => [(v[0] ?? 1) * 100, (v[1] ?? v[0] ?? 1) * 100], st, D));
        setAP(l.transform.rotation, amAnim(kid(tr, 'rotation'), (v) => v[0] || 0, st, D));
        setAP(l.transform.opacity, amAnim(kid(tr, 'opacity'), (v) => (v[0] ?? 1) * 100, st, D));
        setAP(l.transform.anchor, amAnim(kid(tr, 'pivot'), (v) => [v[0] || 0, v[1] || 0], st, D));
      }
      if (fill && fill[3] < 0.999 && !kid(tr || { kids: [] }, 'opacity') && l.type !== 'shape') l.transform.opacity.value = Math.round(fill[3] * 100);
      for (const fxEl of kids(c, 'effect')) {
        const full = String(fxEl.attrs.id || '');
        const id = full.toLowerCase().replace(/^.*?effects\./, '').replace(/^.*alightcreative\./, ''); // mods (Gold Motion, Alemon…) usam outros prefixos
        if (AM_TO_KEYS.has(id)) { amEffectToKeys(id, fxEl, l, st, en, proj.fps); continue; }
        const ex = AM_EXACT[id] || AM_EXACT[id.replace(/\d+$/, '')];
        if (ex && EFFECT_MAP[ex[0]]) { l.effects.push(amEffect(ex[0], ex[1], fxEl, st, D)); continue; }
        const hit = AM_FALLBACK.find(([re]) => re.test(id));
        if (hit && EFFECT_MAP[hit[1]]) { l.effects.push(amEffect(hit[1], {}, fxEl, st, D)); continue; }
        unsupported.add(id);
      }
      if (c.attrs.id) idMap.set(c.attrs.id, l.id);
      if (c.attrs.parent) parents.push([l, c.attrs.parent]);
      out.push(l);
      dur = Math.max(dur, en);
    }
    // no Alight Motion a camada de cima vem por último no XML; no MotionFrame a primeira da lista fica em cima
    return out.reverse();
  };
  proj.layers = build(scene, 0, scene);
  for (const [l, pid] of parents) if (idMap.has(pid)) l.parent = idMap.get(pid);
  proj.duration = Math.max(1, +dur.toFixed(3));
  if (unsupported.size) notes.push(`Efeitos do Alight Motion sem equivalente (ficaram de fora): ${[...unsupported].slice(0, 10).join(', ')}.`);
  return { project: proj, media: [...media], notes: [...new Set(notes)], amEffects: true };
}

