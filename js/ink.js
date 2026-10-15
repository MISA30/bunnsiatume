'use strict';

// 手書きの元素記号を読み取る。
// 丸で囲まれた線を「1つの元素記号」とみなし、
// 「1文字目は大文字・2文字目は小文字」「実在する元素記号だけ」というルールで候補をしぼる。
// 文字の形のくらべ方は $P Point-Cloud Recognizer（Vatavu, Anthony, Wobbrock 2012）の方法。
const Ink = (function () {
  const N = 32; // 1文字を何点でくらべるか

  // ---- 文字のお手本（高さ1くらいの座標、y は下向き） ----
  const arc = (cx, cy, rx, ry, a0, a1, n = 18) => {
    const p = [];
    for (let i = 0; i <= n; i++) {
      const t = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
      p.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
    }
    return p;
  };
  const B_BUMPS = [[0, 0], [.35, 0], [.5, .08], [.52, .25], [.4, .45], [0, .5], [.45, .55], [.6, .75], [.5, .95], [.3, 1], [0, 1]];
  const P_BOWL = [[0, 0], [.38, 0], [.55, .1], [.56, .3], [.4, .45], [0, .48]];
  const S_CURVE = [[.62, .12], [.48, .01], [.25, 0], [.06, .1], [.04, .3], [.2, .45], [.45, .55], [.62, .7], [.6, .9], [.42, 1], [.18, 1], [0, .88]];
  const G_TAIL = [[.78, 0], [.78, 1.05], [.6, 1.3], [.3, 1.32], [.08, 1.15]];

  const UPPER = {
    H: [
      [[[0, 0], [0, 1]], [[.7, 0], [.7, 1]], [[0, .5], [.7, .5]]],
      [[[0, 0], [0, 1]], [[.5, 0], [.5, 1]], [[0, .45], [.5, .45]]],
    ],
    L: [[[[0, 0], [0, 1], [.6, 1]]], [[[0, 0], [0, 1]], [[0, 1], [.6, 1]]]],
    B: [[[[0, 0], [0, 1]], B_BUMPS], [[[0, 1], [0, 0], ...B_BUMPS.slice(1)]]],
    C: [[arc(.45, .5, .45, .5, -40, -320)], [arc(.45, .5, .45, .5, -55, -300)]],
    N: [
      [[[0, 1], [0, 0], [.7, 1], [.7, 0]]],
      [[[0, 1], [0, 0]], [[0, 0], [.7, 1]], [[.7, 1], [.7, 0]]],
      [[[0, 1], [0, 0]], [[0, 0], [.7, 1], [.7, 0]]],
    ],
    O: [[arc(.45, .5, .45, .5, -90, 270, 24)], [arc(.4, .5, .4, .5, -90, 270, 24)]],
    F: [
      [[[.6, 0], [0, 0], [0, 1]], [[0, .48], [.45, .48]]],
      [[[0, 0], [0, 1]], [[0, 0], [.6, 0]], [[0, .48], [.45, .48]]],
    ],
    M: [
      [[[0, 1], [0, 0], [.4, .65], [.8, 0], [.8, 1]]],
      [[[0, 1], [0, 0]], [[0, 0], [.4, .65], [.8, 0]], [[.8, 0], [.8, 1]]],
    ],
    A: [
      [[[0, 1], [.4, 0], [.8, 1]], [[.17, .62], [.63, .62]]],
      [[[0, 1], [.4, 0]], [[.4, 0], [.8, 1]], [[.17, .62], [.63, .62]]],
    ],
    S: [[S_CURVE]],
    P: [[[[0, 1], [0, 0]], P_BOWL], [[[0, 1], ...P_BOWL]]],
    K: [
      [[[0, 0], [0, 1]], [[.6, 0], [0, .55], [.6, 1]]],
      [[[0, 0], [0, 1]], [[.6, 0], [0, .55]], [[.2, .42], [.6, 1]]],
    ],
  };

  const LOWER = {
    a: [
      [arc(.4, .5, .4, .5, -10, -350), [[.8, 0], [.8, 1]]],
      [[...arc(.4, .5, .4, .5, -60, -390), [.8, .05], [.8, 1]]],
      [[[.1, .18], [.35, 0], [.7, .05], [.8, .3], [.8, 1]], [[.8, .45], [.35, .45], [.05, .65], [.15, .95], [.5, 1], [.8, .8]]],
    ],
    e: [[[[0, .5], [.95, .5], ...arc(.5, .5, .47, .5, 0, -310)]]],
    g: [
      [arc(.4, .33, .38, .33, -10, -350), G_TAIL],
      [[...arc(.4, .33, .38, .33, -60, -390), ...G_TAIL]],
    ],
    l: [[[[0, 0], [0, 1]]], [[[.08, 0], [0, 1]]]], // i も l と同じ形（点は使わない）として扱い、辞書で決める
    r: [
      [[[0, .25], [0, 1]], [[0, .55], [.15, .35], [.4, .25], [.62, .3]]],
      [[[0, 1], [0, .25], [0, .6], [.15, .38], [.4, .26], [.62, .32]]],
    ],
  };
  const lowerKey = ch => (ch === 'i' ? 'l' : ch);

  // ---- $P ----
  function toCloud(strokes) {
    const pts = [];
    strokes.forEach((s, id) => s.forEach(([x, y]) => pts.push({ x, y, id })));
    return normalize(resample(pts, N));
  }
  function pathLength(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i].id === pts[i - 1].id) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return d;
  }
  function resample(src, n) {
    const pts = src.map(p => ({ ...p }));
    const I = pathLength(pts) / (n - 1);
    let D = 0;
    const out = [{ ...pts[0] }];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].id !== pts[i - 1].id) continue;
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (D + d >= I && d > 0) {
        const t = (I - D) / d;
        const q = { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y), id: pts[i].id };
        out.push(q);
        pts.splice(i, 0, q);
        D = 0;
      } else D += d;
    }
    while (out.length < n) out.push({ ...pts[pts.length - 1] });
    return out.slice(0, n);
  }
  function normalize(pts) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of pts) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); }
    const s = Math.max(maxx - minx, maxy - miny) || 1;
    let cx = 0, cy = 0;
    const q = pts.map(p => ({ x: (p.x - minx) / s, y: (p.y - miny) / s }));
    for (const p of q) { cx += p.x; cy += p.y; }
    cx /= q.length; cy /= q.length;
    return q.map(p => ({ x: p.x - cx, y: p.y - cy }));
  }
  function cloudDistance(a, b, start) {
    const matched = new Array(b.length).fill(false);
    let sum = 0, i = start;
    do {
      let idx = -1, min = Infinity;
      for (let j = 0; j < b.length; j++) {
        if (matched[j]) continue;
        const d = Math.hypot(a[i].x - b[j].x, a[i].y - b[j].y);
        if (d < min) { min = d; idx = j; }
      }
      matched[idx] = true;
      sum += (1 - ((i - start + a.length) % a.length) / a.length) * min;
      i = (i + 1) % a.length;
    } while (i !== start);
    return sum;
  }
  function match(a, b) {
    const step = Math.floor(Math.pow(a.length, 0.5));
    let min = Infinity;
    for (let i = 0; i < a.length; i += step) min = Math.min(min, cloudDistance(a, b, i), cloudDistance(b, a, i));
    return min;
  }

  const TPL_UPPER = Object.fromEntries(Object.entries(UPPER).map(([k, vs]) => [k, vs.map(toCloud)]));
  const TPL_LOWER = Object.fromEntries(Object.entries(LOWER).map(([k, vs]) => [k, vs.map(toCloud)]));
  const best = (cloud, tpls) => Math.min(...tpls.map(t => match(cloud, t)));

  // ---- 読み取り ----
  // strokes: [[{x,y}...], ...]（丸の中の線）  返り値: [{ sym, score }]（score が小さいほど自信あり）
  function recognize(strokes, symbols) {
    const info = strokes.map(s => {
      const xs = s.map(p => p.x), ys = s.map(p => p.y);
      let len = 0;
      for (let i = 1; i < s.length; i++) len += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
      return { s, minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys), len };
    });
    const H = Math.max(...info.map(i => i.maxy)) - Math.min(...info.map(i => i.miny)) || 1;
    info.forEach(i => (i.dot = i.len < H * 0.12)); // i の点などは形の比較には使わない
    info.sort((a, b) => a.minx - b.minx);
    if (!info.some(i => !i.dot)) return [];

    const memo = new Map();
    const dist = (group, ch, upper) => {
      const k = group.map(g => info.indexOf(g)).join(',') + ch + upper;
      if (memo.has(k)) return memo.get(k);
      const lines = group.filter(g => !g.dot).map(g => g.s.map(p => [p.x, p.y]));
      const tpl = upper ? TPL_UPPER[ch] : TPL_LOWER[lowerKey(ch)];
      const d = lines.length && tpl ? best(toCloud(lines), tpl) : Infinity;
      memo.set(k, d);
      return d;
    };

    const scores = new Map();
    const put = (sym, sc) => { if (sc < (scores.get(sym) ?? Infinity)) scores.set(sym, sc); };
    const one = symbols.filter(s => s.length === 1);
    const two = symbols.filter(s => s.length === 2);

    // 1文字として読む
    for (const s of one) put(s, dist(info, s, true));
    // 2文字として読む（左から k 本目で区切る）
    for (let k = 1; k < info.length; k++) {
      const g1 = info.slice(0, k), g2 = info.slice(k);
      const gap = Math.min(...g2.map(i => i.minx)) - Math.max(...g1.map(i => i.maxx));
      const overlap = Math.max(0, -gap / H);
      for (const s of two) {
        const sc = (dist(g1, s[0], true) + dist(g2, s[1], false)) / 2 + overlap * 1.5;
        put(s, sc);
      }
    }
    return [...scores].map(([sym, score]) => ({ sym, score })).sort((a, b) => a.score - b.score);
  }

  // ---- 丸で囲んだかどうか ----
  // 書き始めと書き終わりが近い（または重なっている）大きめの線を「丸」とみなす
  function isLoop(pts) {
    if (pts.length < 10) return false;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (size < 46) return false;
    const n = pts.length, head = Math.ceil(n * 0.3), tail = Math.floor(n * 0.7);
    let min = Infinity;
    for (let i = 0; i < head; i++) for (let j = tail; j < n; j++) min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    return min < size * 0.25;
  }

  function inside(p, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }
  const insideRatio = (pts, poly) => pts.filter(p => inside(p, poly)).length / pts.length;

  return { recognize, isLoop, insideRatio, UPPER, LOWER };
})();
