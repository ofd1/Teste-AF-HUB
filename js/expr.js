// Expressões do After Effects (subconjunto seguro e comum em edits): wiggle(), loopOut()/loopIn(), time, value,
// linear()/ease(), clamp(), Math.*, random(), contas com vetores ([x, y] + [a, b]) e variáveis (var a = …;).
// NÃO usa eval: o texto é lido por um analisador próprio e só chama as funções desta lista.

const FUNCS = new Set(['wiggle', 'loopOut', 'loopIn', 'loopOutDuration', 'loopInDuration', 'linear', 'ease', 'easeIn', 'easeOut', 'clamp', 'random', 'gaussRandom', 'noise', 'degreesToRadians', 'radiansToDegrees', 'length', 'add', 'sub', 'mul', 'div', 'valueAtTime', 'framesToTime', 'timeToFrames']);
const MATH = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'abs', 'floor', 'ceil', 'round', 'min', 'max', 'pow', 'sqrt', 'exp', 'log', 'sign', 'PI', 'E']);

// ---------------------------------------------------------------- analisador
function tokenize(src) {
  const out = [];
  const re = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_$][\w$]*)|(===|!==|==|!=|<=|>=|&&|\|\||[-+*/%(),;[\]=<>?:!.{}])/gy;
  let m;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    m = re.exec(src);
    if (!m || re.lastIndex === at) throw new Error(`símbolo inesperado em ${at}`);
    if (m[1]) out.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2]) out.push({ t: 'str', v: m[2].slice(1, -1) });
    else if (m[3]) out.push({ t: 'id', v: m[3] });
    else if (m[4]) out.push({ t: 'op', v: m[4] });
  }
  out.push({ t: 'eof' });
  return out;
}

function parse(src) {
  const tk = tokenize(src);
  let i = 0;
  const peek = () => tk[i], next = () => tk[i++];
  const isOp = (v) => tk[i].t === 'op' && tk[i].v === v;
  const expect = (v) => { if (!isOp(v)) throw new Error(`esperava "${v}"`); i++; };
  const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
  function primary() {
    const t = next();
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'op' && t.v === '(') { const e = expr(); expect(')'); return e; }
    if (t.t === 'op' && t.v === '[') {
      const items = [];
      if (!isOp(']')) { do items.push(expr()); while (isOp(',') && next()); }
      expect(']');
      return { k: 'arr', items };
    }
    if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '!')) return { k: 'un', op: t.v, a: unary() };
    if (t.t === 'id') {
      let name = t.v;
      if (name === 'Math' && isOp('.')) { next(); const f = next(); if (f.t !== 'id' || !MATH.has(f.v)) throw new Error('Math.' + f.v + ' não suportado'); name = `Math.${f.v}`; }
      else if (name === 'thisComp' || name === 'thisLayer') {
        // thisComp.frameDuration / thisLayer.index etc.: só leituras simples
        if (isOp('.')) { next(); const f = next(); name = `${name}.${f.v}`; }
      }
      if (isOp('(')) {
        next();
        const args = [];
        if (!isOp(')')) { do args.push(expr()); while (isOp(',') && next()); }
        expect(')');
        return { k: 'call', name, args };
      }
      return { k: 'id', name };
    }
    throw new Error('expressão incompleta');
  }
  function postfix() {
    let e = primary();
    for (;;) {
      if (isOp('[')) { next(); const ix = expr(); expect(']'); e = { k: 'idx', a: e, ix }; }
      else if (isOp('.') && tk[i + 1]?.t === 'id' && tk[i + 1].v === 'length') { i += 2; e = { k: 'len', a: e }; }
      else return e;
    }
  }
  function unary() {
    if (peek().t === 'op' && ['-', '+', '!'].includes(peek().v)) { const op = next().v; return { k: 'un', op, a: unary() }; }
    return postfix();
  }
  function binary(minP) {
    let a = unary();
    for (;;) {
      const t = peek();
      const p = t.t === 'op' ? PREC[t.v] : undefined;
      if (!p || p < minP) return a;
      next();
      a = { k: 'bin', op: t.v, a, b: binary(p + 1) };
    }
  }
  function expr() {
    const c = binary(1);
    if (isOp('?')) { next(); const a = expr(); expect(':'); const b = expr(); return { k: 'cond', c, a, b }; }
    return c;
  }
  const stmts = [];
  while (peek().t !== 'eof') {
    if (isOp(';')) { next(); continue; }
    if (peek().t === 'id' && (peek().v === 'var' || peek().v === 'let' || peek().v === 'const')) next();
    if (peek().t === 'id' && tk[i + 1]?.t === 'op' && tk[i + 1].v === '=') { const name = next().v; next(); stmts.push({ k: 'set', name, e: expr() }); }
    else stmts.push({ k: 'expr', e: expr() });
  }
  if (!stmts.length) throw new Error('vazia');
  return stmts;
}

// ---------------------------------------------------------------- avaliação
const vec = (f) => (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) {
    const A = Array.isArray(a) ? a : null, B = Array.isArray(b) ? b : null;
    const n = Math.max(A?.length || 0, B?.length || 0);
    return Array.from({ length: n }, (_, i) => f(A ? A[i] ?? 0 : a, B ? B[i] ?? 0 : b));
  }
  return f(a, b);
};
const OPS = {
  '+': vec((a, b) => a + b), '-': vec((a, b) => a - b), '*': vec((a, b) => a * b), '/': vec((a, b) => a / b), '%': vec((a, b) => a % b),
  '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b,
  '==': (a, b) => a == b, '!=': (a, b) => a != b, '===': (a, b) => a === b, '!==': (a, b) => a !== b, // eslint-disable-line eqeqeq
};

function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function noise1(x, seed) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); const g = (k) => hash(k * 1.731 + seed * 17.13) * 2 - 1; return g(i) * (1 - u) + g(i + 1) * u; }

function interp(t, t0, t1, v0, v1, shape) {
  let f = t1 === t0 ? (t >= t1 ? 1 : 0) : Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
  if (shape === 'ease') f = f * f * (3 - 2 * f); else if (shape === 'easeIn') f = f * f; else if (shape === 'easeOut') f = 1 - (1 - f) * (1 - f);
  return vec((a, b) => a + (b - a) * f)(v0, v1);
}

function evaluate(stmts, env) {
  const vars = Object.create(null);
  const ev = (n) => {
    switch (n.k) {
      case 'num': case 'str': return n.v;
      case 'arr': return n.items.map(ev);
      case 'un': { const a = ev(n.a); return n.op === '-' ? (Array.isArray(a) ? a.map((x) => -x) : -a) : n.op === '!' ? !a : a; }
      case 'bin': {
        if (n.op === '&&') return ev(n.a) && ev(n.b);
        if (n.op === '||') return ev(n.a) || ev(n.b);
        return OPS[n.op](ev(n.a), ev(n.b));
      }
      case 'cond': return ev(n.c) ? ev(n.a) : ev(n.b);
      case 'idx': { const a = ev(n.a), ix = ev(n.ix); return Array.isArray(a) ? a[ix | 0] : undefined; }
      case 'len': { const a = ev(n.a); return Array.isArray(a) ? a.length : String(a).length; }
      case 'id': {
        if (n.name in vars) return vars[n.name];
        switch (n.name) {
          case 'time': return env.t;
          case 'value': return env.value;
          case 'index': return env.index ?? 1;
          case 'true': return true;
          case 'false': return false;
          case 'Math.PI': return Math.PI;
          case 'Math.E': return Math.E;
          case 'thisComp.frameDuration': return 1 / (env.fps || 30);
          case 'thisComp.width': return env.W || 1080;
          case 'thisComp.height': return env.H || 1920;
          case 'thisLayer.index': return env.index ?? 1;
          default: throw new Error(`"${n.name}" não é suportado`);
        }
      }
      case 'call': return call(n.name, n.args.map(ev));
      default: throw new Error('nó desconhecido');
    }
  };
  const call = (name, a) => {
    if (name.startsWith('Math.')) return Math[name.slice(5)](...a);
    if (!FUNCS.has(name)) throw new Error(`${name}() não é suportado`);
    switch (name) {
      case 'wiggle': {
        // wiggle(freq, amp, octaves = 1, amp_mult = 0.5, t = time): cada dimensão tem seu próprio ruído
        const [freq = 1, amp = 0, oct = 1, mult = 0.5, tt = env.t] = a;
        const w = (d) => { let v = 0, am = 1, fr = 1, norm = 0; for (let o = 0; o < Math.max(1, oct | 0); o++) { v += noise1(tt * freq * fr + o * 13.1, env.seed + d * 7.7 + o) * am; norm += am; am *= mult; fr *= 2; } return (v / norm) * amp * 1.4; };
        const base = env.value;
        return Array.isArray(base) ? base.map((x, d) => x + w(d)) : base + w(0);
      }
      case 'loopOut': case 'loopIn': case 'loopOutDuration': case 'loopInDuration': return loop(name.startsWith('loopIn') ? 'in' : 'out', a[0] || 'cycle', a[1] || 0, env, name.endsWith('Duration'));
      case 'valueAtTime': return env.at(a[0]);
      case 'linear': case 'ease': case 'easeIn': case 'easeOut':
        return a.length >= 5 ? interp(a[0], a[1], a[2], a[3], a[4], name) : interp(a[0], 0, 1, a[1], a[2], name);
      case 'clamp': {
        const lo = (i) => (Array.isArray(a[1]) ? a[1][i] : a[1]), hi = (i) => (Array.isArray(a[2]) ? a[2][i] : a[2]);
        return Array.isArray(a[0]) ? a[0].map((x, i) => Math.max(lo(i), Math.min(hi(i), x))) : Math.max(a[1], Math.min(a[2], a[0]));
      }
      case 'random': case 'gaussRandom': {
        // random() fixo por quadro e por propriedade (o AE também repete o mesmo valor no mesmo quadro)
        const r = hash(Math.floor(env.t * (env.fps || 30)) * 0.731 + env.seed + (env.rc = (env.rc || 0) + 1) * 3.3);
        if (!a.length) return r;
        if (a.length === 1) return Array.isArray(a[0]) ? a[0].map((x, i) => x * hash(r * 91 + i)) : a[0] * r;
        return vec((lo, hi) => lo + (hi - lo) * r)(a[0], a[1]);
      }
      case 'noise': return noise1(Array.isArray(a[0]) ? a[0][0] : a[0], 3.7);
      case 'degreesToRadians': return (a[0] * Math.PI) / 180;
      case 'radiansToDegrees': return (a[0] * 180) / Math.PI;
      case 'length': return a.length > 1 ? Math.hypot(...vec((x, y) => x - y)(a[0], a[1])) : Math.hypot(...[].concat(a[0]));
      case 'add': return OPS['+'](a[0], a[1]);
      case 'sub': return OPS['-'](a[0], a[1]);
      case 'mul': return OPS['*'](a[0], a[1]);
      case 'div': return OPS['/'](a[0], a[1]);
      case 'framesToTime': return a[0] / (env.fps || 30);
      case 'timeToFrames': return Math.round((a[0] ?? env.t) * (env.fps || 30));
      default: throw new Error(name);
    }
  };
  let last;
  for (const s of stmts) {
    if (s.k === 'set') vars[s.name] = last = ev(s.e);
    else last = ev(s.e);
  }
  return last;
}

/** loopOut/loopIn: "cycle", "pingpong", "offset", "continue" (como no AE). n = quantos keyframes entram no ciclo. */
function loop(side, type, n, env, byDuration) {
  const keys = env.keys;
  if (!keys || keys.length < 2) return env.value;
  const t = env.t;
  const first = keys[0].t, last = keys[keys.length - 1].t;
  let a, b;
  if (side === 'out') {
    if (t <= last) return env.value;
    a = byDuration && n > 0 ? last - n : n > 0 ? keys[Math.max(0, keys.length - 1 - n)].t : first; b = last;
  } else {
    if (t >= first) return env.value;
    a = first; b = byDuration && n > 0 ? first + n : n > 0 ? keys[Math.min(keys.length - 1, n)].t : last;
  }
  const d = b - a;
  if (d <= 0) return env.value;
  const va = env.at(a), vb = env.at(b);
  const off = side === 'out' ? t - b : a - t;
  const cyc = Math.floor(off / d), ph = off - cyc * d;
  switch (String(type).toLowerCase()) {
    case 'pingpong': {
      const even = cyc % 2 === 0;
      return side === 'out' ? env.at(even ? b - ph : a + ph) : env.at(even ? a + ph : b - ph);
    }
    case 'offset': {
      const delta = OPS['-'](vb, va);
      return side === 'out' ? OPS['+'](env.at(a + ph), OPS['*'](delta, cyc + 1)) : OPS['-'](env.at(b - ph), OPS['*'](delta, cyc + 1));
    }
    case 'continue': {
      const eps = 1 / (env.fps || 30);
      const vel = side === 'out' ? OPS['/'](OPS['-'](vb, env.at(b - eps)), eps) : OPS['/'](OPS['-'](env.at(a + eps), va), eps);
      return side === 'out' ? OPS['+'](vb, OPS['*'](vel, t - b)) : OPS['-'](va, OPS['*'](vel, a - t));
    }
    default: return side === 'out' ? env.at(a + ph) : env.at(b - ph); // cycle
  }
}

// ---------------------------------------------------------------- API
const cache = new Map();
let seedCounter = 1;
const seeds = new WeakMap();

/** Analisa a expressão (com cache). Lança erro se não for suportada. */
export function compileExpr(src) {
  let c = cache.get(src);
  if (!c) {
    try { c = { ok: true, ast: parse(src) }; } catch (e) { c = { ok: false, err: e.message }; }
    if (cache.size > 500) cache.clear();
    cache.set(src, c);
  }
  return c;
}

/** Valida e devolve a mensagem de erro (ou null). */
export function exprError(src) { const c = compileExpr(src); return c.ok ? null : c.err; }

/**
 * Valor da propriedade com expressão. raw(t) = valor dos keyframes no tempo t (o "value" do AE).
 * Se a expressão falhar, devolve o valor sem expressão (como o AE desativando a expressão com erro).
 */
export function evalExpr(p, t, raw, ctx = {}) {
  const c = compileExpr(p.expr);
  const value = raw(t);
  if (!c.ok) return value;
  let seed = seeds.get(p);
  if (!seed) { seed = seedCounter++ * 1.618; seeds.set(p, seed); }
  try {
    const r = evaluate(c.ast, { t, value, keys: p.keys, at: raw, seed: (p.exprSeed ?? seed), fps: ctx.fps, W: ctx.W, H: ctx.H, index: ctx.index });
    if (r == null || (typeof r === 'number' && !Number.isFinite(r))) return value;
    if (Array.isArray(value)) {
      if (Array.isArray(r)) return value.map((v, i) => (Number.isFinite(r[i]) ? r[i] : v));
      return value.map(() => r);
    }
    return Array.isArray(r) ? r[0] : typeof r === 'boolean' ? +r : r;
  } catch { return value; }
}

/** Expressões prontas (atalhos do inspetor). */
export const EXPR_PRESETS = [
  ['wiggle(5, 30)', 'Tremer (wiggle)'], ['wiggle(2, 10)', 'Tremer suave'], ['wiggle(12, 60)', 'Tremer forte'],
  ['loopOut("cycle")', 'Repetir (loop)'], ['loopOut("pingpong")', 'Vai e volta (pingpong)'], ['loopOut("offset")', 'Repetir somando (offset)'], ['loopOut("continue")', 'Continuar o movimento'],
  ['value + time * 90', 'Girar sem parar (rotação)'], ['value * (1 + Math.sin(time * 6) * 0.08)', 'Pulsar'],
];

/** A expressão roda com o que o MotionFrame suporta? (teste com valores de exemplo, para a importação de .aep). */
export function exprWorks(src, sample = 0) {
  const c = compileExpr(src);
  if (!c.ok) return false;
  try {
    const r = evaluate(c.ast, { t: 0.5, value: sample, keys: [{ t: 0, v: sample }, { t: 1, v: sample }], at: () => sample, seed: 1, fps: 30, W: 1080, H: 1920 });
    return r != null;
  } catch { return false; }
}
