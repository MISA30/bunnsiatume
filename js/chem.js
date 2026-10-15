'use strict';

// 化学まわりの共通処理と保存データ。window.GA にまとめて公開する。
(function () {
  const ELEMENTS = Object.fromEntries(ELEMENT_LIST.map(e => [e.sym, e]));

  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  const sub = s => String(s).replace(/\d/g, d => SUB[d]);

  // ---- 分子の「つながり方」をくらべるためのハッシュ ----
  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  // Weisfeiler-Lehman 法：各原子に「自分＋となりの原子」のラベルを何度も重ねていく
  function wlHash(syms, edges) {
    const n = syms.length;
    const adj = syms.map(() => []);
    for (const [i, j, o] of edges) { adj[i].push([j, o]); adj[j].push([i, o]); }
    let lab = syms.slice();
    for (let it = 0; it < Math.min(n, 12); it++) {
      lab = lab.map((l, i) => fnv(l + '|' + adj[i].map(([j, o]) => o + ':' + lab[j]).sort().join(',')));
    }
    return syms.slice().sort().join('') + ':' + fnv(lab.slice().sort().join(';'));
  }

  // 共有結合でつながったまとまりごとにハッシュを作り、並べて1つのキーにする
  // （イオン結合の物質は「どのイオンが何個あるか」で決まる）
  function covKey(syms, edges) {
    const n = syms.length;
    const p = [...Array(n).keys()];
    const f = i => (p[i] === i ? i : (p[i] = f(p[i])));
    for (const [i, j] of edges) p[f(i)] = f(j);
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const r = f(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    }
    const keys = [];
    for (const g of groups.values()) {
      const idx = new Map(g.map((v, k) => [v, k]));
      const s = g.map(i => syms[i]);
      const e = edges.filter(([i]) => idx.has(i)).map(([i, j, o]) => [idx.get(i), idx.get(j), o]);
      keys.push(wlHash(s, e));
    }
    return keys.sort().join('+');
  }

  const ORDER = { '-': 1, '=': 2, '#': 3 };
  function parseBonds(str) {
    if (!str) return [];
    return str.split(/\s+/).map(t => {
      const m = t.match(/^(\d+)([-=#])(\d+)$/);
      return [+m[1], +m[3], ORDER[m[2]]];
    });
  }

  function countElements(syms) {
    const c = {};
    for (const s of syms) c[s] = (c[s] || 0) + 1;
    return c;
  }

  // 化学式（図鑑にない分子用）：金属 → C → H → その他アルファベット順
  function formulaOf(syms) {
    const c = countElements(syms);
    const keys = Object.keys(c).sort((a, b) => {
      const r = s => (ELEMENTS[s].metal ? 0 : s === 'C' ? 1 : s === 'H' ? 2 : 3);
      return r(a) - r(b) || a.localeCompare(b);
    });
    return keys.map(k => k + (c[k] > 1 ? c[k] : '')).join('');
  }

  const MOLECULES = MOLECULE_DEFS.map(([id, name, formula, tier, atoms, bonds, note]) => {
    const syms = atoms.split(' ');
    const edges = parseBonds(bonds);
    return {
      id, name, formula, tier, note, syms, edges,
      key: covKey(syms, edges),
      ionic: syms.some(s => ELEMENTS[s].metal),
      mono: syms.length === 1,
    };
  });
  const MOL_BY_KEY = new Map(MOLECULES.map(m => [m.key, m]));
  const MOL_BY_ID = Object.fromEntries(MOLECULES.map(m => [m.id, m]));

  // ---- 保存データ ----
  const SAVE_KEY = 'gensoatume.save.v1';
  const DEFAULT_SAVE = () => ({ collected: {}, sound: true, helpSeen: false });
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && s.collected) return Object.assign(DEFAULT_SAVE(), s);
    } catch (e) { /* 保存が使えない環境でも遊べるようにする */ }
    return DEFAULT_SAVE();
  }
  const save = loadSave();
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 無視 */ }
  }
  function resetSave() {
    save.collected = {};
    persist();
  }

  const collectedCount = () => Object.keys(save.collected).filter(id => MOL_BY_ID[id]).length;
  function currentTier() {
    const n = collectedCount();
    let t = 1;
    for (const x of TIERS) if (n >= x.need) t = x.tier;
    return t;
  }
  function nextTierInfo() {
    const n = collectedCount();
    const next = TIERS.find(x => x.need > n);
    return next ? { tier: next.tier, remaining: next.need - n } : null;
  }

  // ---- 小さな構造式の絵（図鑑用） ----
  // snap = { atoms: [[sym, x, y, charge]], bonds: [[i, j, order]] }
  function miniSVG(snap, w, h) {
    const at = snap.atoms;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const [, x, y] of at) {
      minx = Math.min(minx, x); maxx = Math.max(maxx, x);
      miny = Math.min(miny, y); maxy = Math.max(maxy, y);
    }
    const bw = maxx - minx, bh = maxy - miny;
    const s = Math.min(1, (w - 8) / (bw + 60), (h - 8) / (bh + 60));
    const mx = (minx + maxx) / 2, my = (miny + maxy) / 2;
    const P = ([, x, y]) => [w / 2 + (x - mx) * s, h / 2 + (y - my) * s];
    const r = 26 * s;
    const sw = Math.max(1, 2.4 * s);
    let out = '';
    for (const [i, j, o] of snap.bonds) {
      const [x1, y1] = P(at[i]), [x2, y2] = P(at[j]);
      const d = Math.hypot(x2 - x1, y2 - y1) || 1;
      const px = -(y2 - y1) / d, py = (x2 - x1) / d;
      const gap = Math.max(2.6, 7 * s);
      for (let k = 0; k < o; k++) {
        const off = (k - (o - 1) / 2) * gap;
        out += `<line x1="${(x1 + px * off).toFixed(1)}" y1="${(y1 + py * off).toFixed(1)}" x2="${(x2 + px * off).toFixed(1)}" y2="${(y2 + py * off).toFixed(1)}" stroke="#222" stroke-width="${sw.toFixed(2)}" stroke-linecap="round"/>`;
      }
    }
    for (const a of at) {
      const [x, y] = P(a);
      const sym = a[0], ch = a[3] || 0;
      const kind = ELEMENTS[sym].kind;
      out += `<g class="k-${kind}"><circle class="a-shadow" cx="${(x + 2.5 * s).toFixed(1)}" cy="${(y + 3 * s).toFixed(1)}" r="${r.toFixed(1)}"/>` +
        `<circle class="a-main" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" stroke-width="${Math.max(0.8, 1.8 * s).toFixed(2)}"/>` +
        `<text class="a-sym" x="${x.toFixed(1)}" y="${(y + 1 * s).toFixed(1)}" font-size="${(r * (sym.length > 1 ? 0.75 : 0.85)).toFixed(1)}">${sym}</text>`;
      if (ch) out += `<text class="a-charge" x="${(x + r * 0.85).toFixed(1)}" y="${(y - r * 0.8).toFixed(1)}" font-size="${Math.max(8, r * 0.6).toFixed(1)}">${chargeText(ch)}</text>`;
      out += '</g>';
    }
    return `<svg class="mini" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${out}</svg>`;
  }

  function chargeText(c) {
    if (!c) return '';
    return (Math.abs(c) > 1 ? Math.abs(c) : '') + (c > 0 ? '+' : '−');
  }

  window.GA = {
    ELEMENTS, ELEMENT_LIST, MOLECULES, MOL_BY_KEY, MOL_BY_ID, TIERS,
    sub, covKey, formulaOf, countElements, chargeText, miniSVG,
    save, persist, resetSave, collectedCount, currentTier, nextTierInfo,
  };
})();
