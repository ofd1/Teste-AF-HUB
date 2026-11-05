// Importador de linha do tempo em XML:
//  • FCP7 XML (xmeml) — exportado pelo Premiere Pro, DaVinci Resolve, Final Cut 7, Vegas…
//  • FCPXML — Final Cut Pro X / DaVinci Resolve
// Vira um projeto com as camadas de vídeo/foto/áudio no tempo certo (entrada, saída, ponto do arquivo, velocidade,
// escala/posição/rotação/opacidade básicas e marcadores). Os arquivos de mídia não vêm no XML: entram como espaços
// reservados (os mesmos do .aep) e são conectados depois pelo nome do arquivo.
import { createProject, LAYER_FACTORIES } from './state.js';
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

export function isTimelineXML(text) { return /<xmeml[\s>]|<fcpxml[\s>]/i.test(text.slice(0, 4000)); }

/** Converte o XML em { project, media:[nomes], notes:[] }. */
export function xmlToProject(text, fileName = 'Timeline') {
  const doc = parseXML(text);
  if (find(doc, 'fcpxml')) return fromFCPXML(doc, fileName);
  if (find(doc, 'xmeml')) return fromXMEML(doc, fileName);
  throw new Error('não é um XML de linha do tempo (Premiere/FCP7 xmeml ou FCPXML).');
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
