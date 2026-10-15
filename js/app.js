'use strict';

(function () {
  const { ELEMENTS, ELEMENT_LIST, MOL_BY_KEY, covKey, formulaOf, chargeText, sub, save, persist } = GA;

  const R = 26;            // 原子の半径
  const E_DIST = R + 11;   // 原子の中心から電子までの距離
  const NS = 'http://www.w3.org/2000/svg';
  const BASE_ANG = [-90, 90, 180, 0]; // 電子の置き場所：上・下・左・右（O は上下が対、左右がひとり）

  const $ = q => document.querySelector(q);
  const board = $('#board');
  const svg = $('#svg');
  const palette = $('#palette');
  const L = {
    bonds: $('#lyBonds'), atoms: $('#lyAtoms'), shared: $('#lyShared'),
    labels: $('#lyLabels'), ink: $('#lyInk'), link: $('#lyLink'), fx: $('#lyFx'),
  };

  // atoms: { id, sym, x, y, slots: [{ n: 電子の数, bond: 結合id|null }], charge, done }
  // bonds: { id, type: 'cov'(共有) | 'ion'(電子の受けわたし), a, sa, b, sb }
  const S = {
    atoms: new Map(), bonds: new Map(), nextId: 1,
    mode: 'draw', comps: [], link: null, drag: null, W: 0, H: 0,
  };
  const atomEls = new Map();
  const labelEls = new Map();

  const rad = d => (d * Math.PI) / 180;
  const deg = r => (r * 180) / Math.PI;
  const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const f1 = v => v.toFixed(1);
  function mk(tag, attrs = {}) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  // ===================== モデル =====================
  function initialSlots(el) {
    const s = [0, 0, 0, 0];
    if (el.sym === 'He') { s[0] = 2; return s; }
    for (let i = 0; i < el.v; i++) s[i % 4]++;
    return s;
  }

  function addAtom(sym, x, y) {
    const a = {
      id: S.nextId++, sym, x, y, charge: 0, done: null,
      slots: initialSlots(ELEMENTS[sym]).map(n => ({ n, bond: null })),
    };
    clampAtom(a);
    S.atoms.set(a.id, a);
    sfx('place');
    evaluate();
    return a;
  }

  const isUnpaired = s => s.n === 1 && s.bond == null;
  const hasUnpaired = a => a.slots.some(isUnpaired);

  function canLink(from, to) {
    return to.id !== from.id && !to.done && hasUnpaired(to) &&
      !(ELEMENTS[from.sym].metal && ELEMENTS[to.sym].metal);
  }

  function link(aId, sa, bId, sb) {
    const A = S.atoms.get(aId), B = S.atoms.get(bId);
    const eA = ELEMENTS[A.sym], eB = ELEMENTS[B.sym];
    const id = S.nextId++;
    if (eA.metal || eB.metal) {
      // 金属は電子を相手にわたす → イオンになる
      const [D, ds, C, cs] = eA.metal ? [A, sa, B, sb] : [B, sb, A, sa];
      const from = electronWorld(D, ds), to = electronWorld(C, cs);
      D.slots[ds] = { n: 0, bond: id };
      C.slots[cs] = { n: 2, bond: id };
      D.charge++; C.charge--;
      S.bonds.set(id, { id, type: 'ion', a: D.id, sa: ds, b: C.id, sb: cs });
      flyElectron(from, to);
      sfx('transfer');
      tip('ion', `${D.sym} の電子が ${C.sym} にうつった！ ${D.sym} は＋、${C.sym} は−のイオンになったよ`);
    } else {
      A.slots[sa].bond = id;
      B.slots[sb].bond = id;
      S.bonds.set(id, { id, type: 'cov', a: A.id, sa, b: B.id, sb });
      sfx('link');
      const order = bondOrder(A.id, B.id);
      if (order === 2) tip('double', '電子の組が2つ → 二重結合！');
      else if (order === 3) tip('triple', '電子の組が3つ → 三重結合！');
      else tip('cov', '電子が2つで1組（共有電子対）になった！ これが1本の線＝結合になるよ');
    }
    keepDistance(A, B);
    evaluate();
  }

  function bondOrder(a, b) {
    let n = 0;
    for (const x of S.bonds.values()) {
      if (x.type === 'cov' && ((x.a === a && x.b === b) || (x.a === b && x.b === a))) n++;
    }
    return n;
  }

  function removeBond(id) {
    const b = S.bonds.get(id);
    if (!b) return;
    const A = S.atoms.get(b.a), B = S.atoms.get(b.b);
    A.slots[b.sa] = { n: 1, bond: null };
    B.slots[b.sb] = { n: 1, bond: null };
    if (b.type === 'ion') { A.charge--; B.charge++; }
    S.bonds.delete(id);
  }

  function deleteAtom(id) {
    const a = S.atoms.get(id);
    if (!a) return;
    for (const s of a.slots) if (s.bond != null) removeBond(s.bond);
    S.atoms.delete(id);
  }

  function clearBoard() {
    clearInk();
    S.atoms.clear();
    S.bonds.clear();
    evaluate();
  }

  // 結合したら原子どうしの距離をほどよくする（動かすのは結合の少ない方）
  function keepDistance(A, B) {
    const nb = a => a.slots.filter(s => s.bond != null).length;
    const [fix, mov] = nb(A) >= nb(B) ? [A, B] : [B, A];
    const dx = mov.x - fix.x, dy = mov.y - fix.y;
    const d = Math.hypot(dx, dy) || 1;
    const t = Math.max(88, Math.min(170, d));
    if (Math.abs(t - d) < 1) return;
    mov.x = fix.x + (dx / d) * t;
    mov.y = fix.y + (dy / d) * t;
    clampAtom(mov);
  }

  // 置いたり結合で動いたりした原子がパレットの下にかくれないようにする
  function clampAtom(a) {
    const pal = board.classList.contains('palette-collapsed') ? 0 : palette.offsetWidth + 14;
    a.x = Math.max(R + 4, Math.min(S.W - pal - R - 4, a.x));
    a.y = Math.max(R + 4, Math.min(S.H - R - 4, a.y));
  }

  // ---- まとまり（分子）ごとの完成チェック ----
  function evaluate() {
    const parent = new Map();
    const find = i => (parent.get(i) === i ? i : (parent.set(i, find(parent.get(i))), parent.get(i)));
    for (const id of S.atoms.keys()) parent.set(id, id);
    for (const b of S.bonds.values()) parent.set(find(b.a), find(b.b));
    const groups = new Map();
    for (const id of S.atoms.keys()) {
      const r = find(id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(S.atoms.get(id));
    }
    S.comps = [];
    const fresh = [];
    for (const atoms of groups.values()) {
      const comp = { ids: atoms.map(a => a.id), complete: isComplete(atoms) };
      if (comp.complete) {
        comp.key = compKey(atoms);
        comp.doneKey = comp.key + '#' + Math.min(...comp.ids);
        comp.mol = MOL_BY_KEY.get(comp.key) || null;
        comp.formula = comp.mol ? comp.mol.formula : formulaOf(atoms.map(a => a.sym));
        if (atoms.some(a => a.done !== comp.doneKey)) fresh.push(comp);
        atoms.forEach(a => (a.done = comp.doneKey));
      } else {
        atoms.forEach(a => (a.done = null));
      }
      S.comps.push(comp);
    }
    renderAll();
    fresh.forEach(celebrate);
  }

  function isComplete(atoms) {
    if (atoms.some(hasUnpaired)) return false;
    return atoms.length > 1 || ELEMENTS[atoms[0].sym].noble;
  }

  function covEdges(atoms) {
    const idx = new Map(atoms.map((a, i) => [a.id, i]));
    const pairs = new Map();
    for (const b of S.bonds.values()) {
      if (b.type !== 'cov' || !idx.has(b.a)) continue;
      const i = idx.get(b.a), j = idx.get(b.b);
      const k = Math.min(i, j) + '-' + Math.max(i, j);
      pairs.set(k, (pairs.get(k) || 0) + 1);
    }
    return [...pairs].map(([k, o]) => { const [i, j] = k.split('-').map(Number); return [i, j, o]; });
  }

  function compKey(atoms) {
    return covKey(atoms.map(a => a.sym), covEdges(atoms));
  }

  const compOf = a => S.comps.find(c => c.ids.includes(a.id));

  // ===================== 電子の配置 =====================
  function partnersOf(a) {
    const m = new Map();
    for (const s of a.slots) {
      if (s.bond == null) continue;
      const b = S.bonds.get(s.bond);
      if (!b || b.type !== 'cov') continue;
      const p = b.a === a.id ? b.b : b.a;
      m.set(p, (m.get(p) || 0) + 1);
    }
    return m;
  }

  // 結合していない電子（ひとりの電子・非共有電子対）を、結合の方向をさけて上下左右に並べる
  function layoutAtom(a) {
    const free = [];
    a.slots.forEach((s, i) => {
      if (s.n > 0 && (s.bond == null || S.bonds.get(s.bond).type === 'ion')) free.push(i);
    });
    const pids = [...partnersOf(a).keys()];
    if (!pids.length) return free.map(i => ({ slot: i, ang: BASE_ANG[i], n: a.slots[i].n }));
    const angs = pids.map(id => { const p = S.atoms.get(id); return deg(Math.atan2(p.y - a.y, p.x - a.x)); });
    const grid = [0, 90, 180, 270].map(o => angs[0] + o);
    const used = [true, false, false, false];
    const nearest = target => {
      let bi = -1, bd = Infinity;
      grid.forEach((g, gi) => { if (!used[gi]) { const d = angDiff(g, target); if (d < bd) { bd = d; bi = gi; } } });
      return bi;
    };
    for (let k = 1; k < angs.length; k++) { const gi = nearest(angs[k]); if (gi >= 0) used[gi] = true; }
    return free.map(i => {
      let gi = nearest(BASE_ANG[i]);
      if (gi < 0) gi = 0;
      used[gi] = true;
      return { slot: i, ang: grid[gi], n: a.slots[i].n };
    });
  }

  function domainDots(d) {
    const t = rad(d.ang);
    const cx = Math.cos(t) * E_DIST, cy = Math.sin(t) * E_DIST;
    if (d.n === 1) return [{ x: cx, y: cy }];
    const px = -Math.sin(t) * 6, py = Math.cos(t) * 6;
    return [{ x: cx + px, y: cy + py }, { x: cx - px, y: cy - py }];
  }

  function electronWorld(a, slot) {
    const d = layoutAtom(a).find(x => x.slot === slot);
    if (!d) return { x: a.x, y: a.y };
    const p = domainDots(d)[0];
    return { x: a.x + p.x, y: a.y + p.y };
  }

  // ===================== 描画 =====================
  function renderAll() {
    renderBonds();
    renderAtoms();
    renderLabels();
    renderLink();
    $('#emptyHint').hidden = S.atoms.size > 0;
  }

  function createAtomEl(a) {
    const g = mk('g', { class: 'atom k-' + ELEMENTS[a.sym].kind, 'data-atom': a.id });
    const floater = mk('g', { class: 'floater' });
    floater.style.animationDelay = (-Math.random() * 3).toFixed(2) + 's';
    const body = mk('g', { class: 'body' });
    body.innerHTML =
      `<circle class="a-shadow" cx="3" cy="4" r="${R}"/>` +
      `<circle class="a-main" r="${R}"/>` +
      `<text class="a-sym" y="1" font-size="${a.sym.length > 1 ? 19 : 22}">${a.sym}</text>`;
    const elec = mk('g', { class: 'elec' });
    const charge = mk('text', { class: 'a-charge', x: R * 0.82, y: -R * 0.8 });
    floater.append(body, elec, charge);
    g.append(floater);
    return { g, floater, body, elec, charge, elecHTML: null, chargeText: null };
  }

  function renderAtoms() {
    const live = new Set();
    const from = S.link ? S.atoms.get(S.link.from) : null;
    const snap = S.link && S.link.snap;
    for (const a of S.atoms.values()) {
      live.add(a.id);
      let el = atomEls.get(a.id);
      if (!el) { el = createAtomEl(a); atomEls.set(a.id, el); L.atoms.appendChild(el.g); }
      el.g.setAttribute('transform', `translate(${f1(a.x)},${f1(a.y)})`);
      const isolated = !a.slots.some(s => s.bond != null);
      const dragging = S.drag && S.drag.moved && S.drag.ids.includes(a.id);
      el.floater.classList.toggle('float', isolated && !a.done && !dragging);
      el.g.classList.toggle('done', !!a.done);

      let h = '';
      if (!a.done) {
        const target = from && canLink(from, a);
        for (const d of layoutAtom(a)) {
          const dots = domainDots(d);
          if (d.n === 2) {
            for (const p of dots) h += `<circle class="e pair" cx="${f1(p.x)}" cy="${f1(p.y)}" r="4.6"/>`;
          } else {
            const p = dots[0];
            const cls = ['e', 'single'];
            if (target) cls.push('target');
            if (S.link && S.link.from === a.id && S.link.slot === d.slot) cls.push('from');
            if (snap && snap.atom === a.id && snap.slot === d.slot) cls.push('snap');
            h += `<circle class="${cls.join(' ')}" cx="${f1(p.x)}" cy="${f1(p.y)}" r="5.2"/>` +
              `<circle class="e-hit" data-slot="${d.slot}" cx="${f1(p.x)}" cy="${f1(p.y)}" r="15"/>`;
          }
        }
      }
      if (el.elecHTML !== h) { el.elec.innerHTML = h; el.elecHTML = h; }
      const ch = chargeText(a.charge);
      if (el.chargeText !== ch) { el.charge.textContent = ch; el.chargeText = ch; }
    }
    for (const [id, el] of atomEls) if (!live.has(id)) { el.g.remove(); atomEls.delete(id); }
  }

  function renderBonds() {
    let hb = '', hs = '';
    const pairs = new Map();
    const erase = S.mode === 'erase';
    for (const b of S.bonds.values()) {
      const A = S.atoms.get(b.a), B = S.atoms.get(b.b);
      if (b.type === 'ion') {
        if (A.done && A.done === B.done) continue;
        hb += `<line class="ion-link" x1="${f1(A.x)}" y1="${f1(A.y)}" x2="${f1(B.x)}" y2="${f1(B.y)}"/>`;
        if (erase) hb += `<line class="hit" data-bond="${b.id}" x1="${f1(A.x)}" y1="${f1(A.y)}" x2="${f1(B.x)}" y2="${f1(B.y)}"/>`;
        continue;
      }
      const k = Math.min(b.a, b.b) + '-' + Math.max(b.a, b.b);
      let p = pairs.get(k);
      if (!p) { p = { A, B, ids: [] }; pairs.set(k, p); }
      p.ids.push(b.id);
    }
    for (const { A, B, ids } of pairs.values()) {
      const n = ids.length;
      const dx = B.x - A.x, dy = B.y - A.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d, px = -uy, py = ux;
      const done = A.done && A.done === B.done;
      if (done) {
        // 構造式：電子の組1つ＝線1本
        for (let k = 0; k < n; k++) {
          const o = (k - (n - 1) / 2) * 7;
          hb += `<line class="bond" x1="${f1(A.x + px * o)}" y1="${f1(A.y + py * o)}" x2="${f1(B.x + px * o)}" y2="${f1(B.y + py * o)}"/>`;
        }
      } else {
        // 電子式：引いた線の上に、共有電子対（●●）を結合の数だけ並べる
        hb += `<line class="bond-pencil" x1="${f1(A.x)}" y1="${f1(A.y)}" x2="${f1(B.x)}" y2="${f1(B.y)}"/>`;
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        for (let k = 0; k < n; k++) {
          const o = (k - (n - 1) / 2) * 12;
          const cx = mx + ux * o, cy = my + uy * o;
          hs += `<circle class="e pair" cx="${f1(cx + px * 6)}" cy="${f1(cy + py * 6)}" r="4.6"/>` +
            `<circle class="e pair" cx="${f1(cx - px * 6)}" cy="${f1(cy - py * 6)}" r="4.6"/>`;
        }
      }
      if (erase) hb += `<line class="hit" data-bond="${ids[ids.length - 1]}" x1="${f1(A.x)}" y1="${f1(A.y)}" x2="${f1(B.x)}" y2="${f1(B.y)}"/>`;
    }
    L.bonds.innerHTML = hb;
    L.shared.innerHTML = hs;
  }

  const STAR = 'M0,-7 L1.6,-1.6 L7,0 L1.6,1.6 L0,7 L-1.6,1.6 L-7,0 L-1.6,-1.6Z';

  function createLabel(comp) {
    const g = mk('g', { class: 'mlabel' + (comp.mol ? '' : ' unknown') });
    const inner = mk('g', { class: 'mlabel-in' });
    const name = comp.mol ? comp.mol.name : 'なぞの分子';
    const w = name.length * 26 + 16;
    inner.innerHTML =
      `<rect class="hl" x="${-w / 2}" y="2" width="${w}" height="15" rx="7.5" transform="rotate(-2)"/>` +
      `<rect class="hl" x="${-w / 2 + 14}" y="10" width="${w * 0.55}" height="10" rx="5" transform="rotate(1.5)"/>` +
      `<text class="mname" y="0">${name}</text>` +
      `<text class="mform" y="34">${sub(comp.formula)}${comp.mol ? '' : '（図鑑にない分子）'}</text>` +
      `<path class="star" d="${STAR}" transform="translate(${-w / 2 - 16},6) scale(.8)"/>` +
      `<path class="star" d="${STAR}" transform="translate(${w / 2 + 14},-12) scale(.7)"/>` +
      `<circle class="star" cx="${w / 2 + 15}" cy="4" r="1.8"/>`;
    g.appendChild(inner);
    return g;
  }

  function bboxOf(ids) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const id of ids) {
      const a = S.atoms.get(id);
      minx = Math.min(minx, a.x); maxx = Math.max(maxx, a.x);
      miny = Math.min(miny, a.y); maxy = Math.max(maxy, a.y);
    }
    return { minx, miny, maxx, maxy, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2 };
  }

  function renderLabels() {
    const live = new Set();
    for (const c of S.comps) {
      if (!c.complete) continue;
      live.add(c.doneKey);
      let g = labelEls.get(c.doneKey);
      if (!g) { g = createLabel(c); labelEls.set(c.doneKey, g); L.labels.appendChild(g); }
      const bb = bboxOf(c.ids);
      let y = bb.maxy + R + 36;
      if (y > S.H - 30) y = bb.miny - R - 40;
      g.setAttribute('transform', `translate(${f1(bb.cx)},${f1(y)})`);
    }
    for (const [k, g] of labelEls) if (!live.has(k)) { g.remove(); labelEls.delete(k); }
  }

  function renderLink() {
    if (!S.link) { L.link.innerHTML = ''; return; }
    const a = S.atoms.get(S.link.from);
    const p0 = electronWorld(a, S.link.slot);
    let { x, y } = S.link;
    if (S.link.snap) { const q = electronWorld(S.atoms.get(S.link.snap.atom), S.link.snap.slot); x = q.x; y = q.y; }
    L.link.innerHTML =
      `<line class="link-line" x1="${f1(p0.x)}" y1="${f1(p0.y)}" x2="${f1(x)}" y2="${f1(y)}"/>` +
      `<circle class="link-tip" cx="${f1(x)}" cy="${f1(y)}" r="3.5"/>`;
  }

  // ===================== 演出 =====================
  function celebrate(comp) {
    for (const id of comp.ids) {
      const el = atomEls.get(id);
      if (!el) continue;
      el.body.classList.remove('pop');
      void el.body.getBoundingClientRect();
      el.body.classList.add('pop');
    }
    const bb = bboxOf(comp.ids);
    const spread = Math.max(bb.maxx - bb.minx, bb.maxy - bb.miny) / 2 + R;
    burst(bb.cx, bb.cy, spread);
    popText(bb.cx, bb.miny - R - 14);
    sfx('pop');
    if (comp.mol) record(comp);
    else toast('電子は安定したけど、図鑑にはない分子みたい…！');
  }

  function burst(x, y, r) {
    const n = 14;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const d = r + 24 + Math.random() * 34;
      const p = mk('path', { d: STAR, class: 'spark ' + (i % 3 ? 's1' : 's2') });
      L.fx.appendChild(p);
      const anim = p.animate([
        { transform: `translate(${x}px,${y}px) scale(.3) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${x + Math.cos(ang) * d}px,${y + Math.sin(ang) * d}px) scale(1) rotate(90deg)`, opacity: 0 },
      ], { duration: 650 + Math.random() * 350, easing: 'cubic-bezier(.2,.8,.3,1)' });
      anim.onfinish = () => p.remove();
    }
  }

  function popText(x, y) {
    const t = mk('text', { class: 'poptext' });
    t.textContent = 'ポンッ！';
    L.fx.appendChild(t);
    const anim = t.animate([
      { transform: `translate(${x}px,${y + 10}px) scale(.4)`, opacity: 0 },
      { transform: `translate(${x}px,${y}px) scale(1.15)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${x}px,${y - 6}px) scale(1)`, opacity: 1, offset: 0.7 },
      { transform: `translate(${x}px,${y - 16}px) scale(1)`, opacity: 0 },
    ], { duration: 1100, easing: 'ease-out' });
    anim.onfinish = () => t.remove();
  }

  function flyElectron(from, to) {
    const c = mk('circle', { class: 'e single fly', r: 5.2 });
    L.fx.appendChild(c);
    const anim = c.animate([
      { transform: `translate(${from.x}px,${from.y}px)` },
      { transform: `translate(${to.x}px,${to.y}px)` },
    ], { duration: 450, easing: 'cubic-bezier(.5,0,.3,1)' });
    anim.onfinish = () => c.remove();
  }

  function record(comp) {
    const mol = comp.mol;
    if (save.collected[mol.id]) {
      setTimeout(() => toast(`「${mol.name}」はもう図鑑にのっているよ`), 500);
      return;
    }
    const tierBefore = GA.currentTier();
    save.collected[mol.id] = { t: Date.now(), snap: snapshot(comp), seen: false };
    persist();
    const tierAfter = GA.currentTier();
    setTimeout(() => {
      sfx('fanfare');
      if (mol.tier > tierBefore) toast(`🔍 ひみつの分子「${mol.name}」を発見！ 図鑑に記録したよ`);
      else toast(`📖「${mol.name}」を図鑑に記録した！`);
      if (tierAfter > tierBefore) toast('✨ 図鑑のリストに新しい分子が追加された！');
    }, 450);
    updateBadge();
  }

  function snapshot(comp) {
    const atoms = comp.ids.map(id => S.atoms.get(id));
    return {
      atoms: atoms.map(a => [a.sym, Math.round(a.x), Math.round(a.y), a.charge]),
      bonds: covEdges(atoms),
    };
  }

  function updateBadge() {
    const anyNew = Object.values(save.collected).some(c => c.seen === false);
    $('#bookBadge').hidden = !anyNew;
  }

  // ---- トースト（順番に表示） ----
  const toastQ = [];
  let toastBusy = false;
  function toast(msg) {
    toastQ.push(msg);
    if (!toastBusy) nextToast();
  }
  function nextToast() {
    const el = $('#toast');
    if (!toastQ.length) { toastBusy = false; return; }
    toastBusy = true;
    el.textContent = toastQ.shift();
    el.classList.add('show');
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(nextToast, 320);
    }, 2400);
  }
  // 最初の1回だけ出す説明
  const tipsShown = new Set();
  function tip(key, msg) {
    if (tipsShown.has(key)) return;
    tipsShown.add(key);
    toast(msg);
  }

  // ---- 効果音 ----
  let actx = null;
  function sfx(kind) {
    if (!save.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime;
      const tone = (f0, f1v, start, dur, type = 'sine', vol = 0.18) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f0, t + start);
        o.frequency.exponentialRampToValueAtTime(f1v, t + start + dur);
        g.gain.setValueAtTime(0.0001, t + start);
        g.gain.exponentialRampToValueAtTime(vol, t + start + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
        o.connect(g).connect(actx.destination);
        o.start(t + start);
        o.stop(t + start + dur + 0.02);
      };
      if (kind === 'place') tone(420, 300, 0, 0.08, 'sine', 0.1);
      else if (kind === 'link') tone(660, 880, 0, 0.09, 'triangle', 0.14);
      else if (kind === 'transfer') { tone(500, 1000, 0, 0.18, 'triangle', 0.12); }
      else if (kind === 'pop') { tone(900, 160, 0, 0.14, 'sine', 0.3); tone(1400, 700, 0.03, 0.08, 'triangle', 0.08); }
      else if (kind === 'fanfare') { tone(784, 784, 0, 0.12, 'triangle'); tone(988, 988, 0.11, 0.12, 'triangle'); tone(1318, 1318, 0.22, 0.25, 'triangle'); }
      else if (kind === 'erase') tone(300, 150, 0, 0.1, 'sawtooth', 0.05);
      else if (kind === 'ng') tone(220, 180, 0, 0.12, 'square', 0.04);
    } catch (e) { /* 音が出せなくても続ける */ }
  }

  // ===================== 操作（キャンバス） =====================
  function pt(e) {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function overPalette(e) {
    if (board.classList.contains('palette-collapsed')) return false;
    const r = palette.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function findSnap(x, y) {
    const from = S.atoms.get(S.link.from);
    let best = null, bd = Infinity;
    for (const a of S.atoms.values()) {
      if (!canLink(from, a) || Math.hypot(a.x - x, a.y - y) > R + 34) continue;
      for (const d of layoutAtom(a)) {
        if (d.n !== 1 || !isUnpaired(a.slots[d.slot])) continue;
        const p = domainDots(d)[0];
        const dd = Math.hypot(a.x + p.x - x, a.y + p.y - y);
        if (dd < bd) { bd = dd; best = { atom: a.id, slot: d.slot }; }
      }
    }
    return best;
  }

  function atomAt(x, y) {
    let best = null, bd = R + 12;
    for (const a of S.atoms.values()) {
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  function capture(e) {
    try { svg.setPointerCapture(e.pointerId); } catch (_) { /* 無視 */ }
  }

  // ===================== 手書き（書いて丸で囲むと原子になる） =====================
  const SYMBOLS = ELEMENT_LIST.map(e => e.sym);
  S.ink = [];      // まだ丸で囲まれていない線
  S.inkCur = null; // いま書いている線
  let inkTimer = null;
  const inkPath = pts => (pts.length === 1
    ? `M${f1(pts[0].x)},${f1(pts[0].y)}h0.1`
    : 'M' + pts.map(p => f1(p.x) + ',' + f1(p.y)).join('L'));

  function startInk(p) {
    const el = mk('path', { class: 'ink' });
    L.ink.appendChild(el);
    S.inkCur = { pts: [p], el };
    el.setAttribute('d', inkPath(S.inkCur.pts));
    clearTimeout(inkTimer);
  }

  function moveInk(p) {
    const c = S.inkCur, last = c.pts[c.pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return;
    c.pts.push(p);
    c.el.setAttribute('d', inkPath(c.pts));
  }

  function finishInk(cancelled) {
    const cur = S.inkCur;
    S.inkCur = null;
    if (cancelled) { cur.el.remove(); return; }
    if (Ink.isLoop(cur.pts)) {
      const inner = S.ink.filter(s => Ink.insideRatio(s.pts, cur.pts) > 0.8);
      if (inner.length) { inkToAtom(cur, inner); return; }
    }
    S.ink.push(cur);
    tip('ink', '書いた元素記号を ◯ でかこむと、原子になるよ');
    scheduleInkFade();
  }

  function inkToAtom(loop, inner) {
    S.ink = S.ink.filter(s => !inner.includes(s));
    for (const s of [loop, ...inner]) {
      s.el.classList.add('consumed');
      setTimeout(() => s.el.remove(), 400);
    }
    const cands = Ink.recognize(inner.map(s => s.pts), SYMBOLS);
    if (!cands.length) { sfx('ng'); toast('うまく読めなかった…もう一度書いてみてね'); return; }
    const xs = loop.pts.map(p => p.x), ys = loop.pts.map(p => p.y);
    const a = addAtom(cands[0].sym, (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
    const el = atomEls.get(a.id);
    if (el) el.body.classList.add('pop');
    showCands(a, cands.slice(1, 4).map(c => c.sym));
    if (S.ink.length) scheduleInkFade();
  }

  // 丸で囲まれなかった線は、しばらくすると消える
  function scheduleInkFade() {
    clearTimeout(inkTimer);
    inkTimer = setTimeout(() => clearInk(), 15000);
  }
  function clearInk(filter = () => true) {
    const gone = S.ink.filter(filter);
    S.ink = S.ink.filter(s => !gone.includes(s));
    for (const s of gone) {
      s.el.classList.add('fading');
      setTimeout(() => s.el.remove(), 600);
    }
  }

  // 読み取りがちがったときの候補
  const candBox = $('#cands');
  let candTimer = null;
  function showCands(a, syms) {
    if (!syms.length) return;
    candBox.innerHTML = '<span>ちがう？</span>' + syms.map(s => `<button data-sym="${s}">${s}</button>`).join('');
    candBox.style.left = f1(a.x) + 'px';
    candBox.style.top = f1(a.y + R + 14) + 'px';
    candBox.dataset.atom = a.id;
    candBox.hidden = false;
    clearTimeout(candTimer);
    candTimer = setTimeout(hideCands, 6000);
  }
  function hideCands() { candBox.hidden = true; }
  candBox.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const a = S.atoms.get(+candBox.dataset.atom);
    hideCands();
    if (!a || a.slots.some(s => s.bond != null)) return;
    const { x, y } = a;
    deleteAtom(a.id);
    addAtom(b.dataset.sym, x, y);
  });

  svg.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const p = pt(e);
    const atomEl = e.target.closest('[data-atom]');
    const slotEl = e.target.closest('[data-slot]');
    const bondEl = e.target.closest('[data-bond]');
    hideCands();

    if (S.mode === 'erase') {
      if (atomEl) { deleteAtom(+atomEl.dataset.atom); sfx('erase'); evaluate(); }
      else if (bondEl) { removeBond(+bondEl.dataset.bond); sfx('erase'); evaluate(); }
      else clearInk(s => s.pts.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 16));
      return;
    }

    if (!atomEl && !bondEl) {
      startInk(p);
      capture(e);
      return;
    }

    if (atomEl && slotEl) {
      const a = S.atoms.get(+atomEl.dataset.atom);
      const slot = +slotEl.dataset.slot;
      if (a && isUnpaired(a.slots[slot])) {
        S.link = { from: a.id, slot, x: p.x, y: p.y, snap: null };
        capture(e);
        renderAll();
        return;
      }
    }
    if (atomEl) {
      const a = S.atoms.get(+atomEl.dataset.atom);
      if (!a) return;
      const ids = a.done ? compOf(a).ids : [a.id];
      S.drag = {
        ids, moved: false, sx: p.x, sy: p.y,
        offs: ids.map(id => { const b = S.atoms.get(id); return { id, dx: b.x - p.x, dy: b.y - p.y }; }),
      };
      ids.forEach(id => { const el = atomEls.get(id); if (el) L.atoms.appendChild(el.g); });
      capture(e);
    }
  });

  svg.addEventListener('pointermove', e => {
    if (!S.link && !S.drag && !S.inkCur) return;
    const p = pt(e);
    if (S.inkCur) { moveInk(p); return; }
    if (S.link) {
      S.link.x = p.x; S.link.y = p.y;
      S.link.snap = findSnap(p.x, p.y);
      renderAtoms();
      renderLink();
      return;
    }
    const D = S.drag;
    if (!D.moved && Math.hypot(p.x - D.sx, p.y - D.sy) < 4) return;
    D.moved = true;
    // まとまりで動かすときは、全体がはみ出さないように動きをそろえる
    let shiftX = 0, shiftY = 0;
    for (const o of D.offs) {
      const x = p.x + o.dx, y = p.y + o.dy;
      shiftX = Math.max(shiftX, R + 4 - x); shiftX = Math.min(shiftX, S.W - R - 4 - x);
      shiftY = Math.max(shiftY, R + 4 - y); shiftY = Math.min(shiftY, S.H - R - 4 - y);
    }
    for (const o of D.offs) {
      const a = S.atoms.get(o.id);
      a.x = p.x + o.dx + shiftX;
      a.y = p.y + o.dy + shiftY;
    }
    board.classList.toggle('trash-hover', overPalette(e));
    renderAll();
  });

  function endPointer(e, cancelled) {
    if (S.inkCur) { finishInk(cancelled); return; }
    if (S.link) {
      const L0 = S.link;
      S.link = null;
      if (!cancelled) {
        if (L0.snap) {
          link(L0.from, L0.slot, L0.snap.atom, L0.snap.slot);
          return;
        }
        const p = pt(e);
        const t = atomAt(p.x, p.y);
        const from = S.atoms.get(L0.from);
        if (t && t.id !== from.id) {
          sfx('ng');
          if (t.done) toast('それはもう完成した分子だよ');
          else if (ELEMENTS[from.sym].metal && ELEMENTS[t.sym].metal) toast('金属どうしは電子を受けわたさないよ');
          else if (!hasUnpaired(t)) toast(`${t.sym} にはもう ○（ひとりの電子）がないよ`);
        }
      }
      renderAll();
      return;
    }
    if (S.drag) {
      const D = S.drag;
      S.drag = null;
      board.classList.remove('trash-hover');
      if (!cancelled && D.moved && overPalette(e)) {
        D.ids.forEach(deleteAtom);
        sfx('erase');
      }
      evaluate();
    }
  }
  svg.addEventListener('pointerup', e => endPointer(e, false));
  svg.addEventListener('pointercancel', e => endPointer(e, true));

  // ===================== パレット =====================
  const list = $('#paletteList');
  for (const el of ELEMENT_LIST) {
    const b = document.createElement('button');
    b.className = 'el-btn k-' + el.kind;
    b.dataset.sym = el.sym;
    b.title = `${el.name}（価電子 ${el.v}）`;
    b.innerHTML = `<span class="el-sym">${el.sym}</span><span class="el-name">${el.name}</span>`;
    list.appendChild(b);
  }

  list.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.el-btn');
    if (!btn || e.button > 0) return;
    const sym = btn.dataset.sym;
    const st = { x: e.clientX, y: e.clientY, ghost: null };
    try { btn.setPointerCapture(e.pointerId); } catch (_) { /* 無視 */ }
    const move = ev => {
      if (!st.ghost && Math.hypot(ev.clientX - st.x, ev.clientY - st.y) > 8) {
        st.ghost = document.createElement('div');
        st.ghost.className = 'ghost-atom k-' + ELEMENTS[sym].kind;
        st.ghost.textContent = sym;
        document.body.appendChild(st.ghost);
      }
      if (st.ghost) {
        st.ghost.style.left = ev.clientX + 'px';
        st.ghost.style.top = ev.clientY + 'px';
      }
    };
    const up = ev => {
      cleanup();
      if (ev.type === 'pointercancel') return;
      if (!st.ghost) {
        // タップ：画面のまんなか付近に置く
        addAtom(sym, (S.W - 90) / 2 + (Math.random() - 0.5) * 160, S.H / 2 + (Math.random() - 0.5) * 120);
        return;
      }
      if (overPalette(ev)) return;
      const r = svg.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
      addAtom(sym, ev.clientX - r.left, ev.clientY - r.top);
    };
    const cleanup = () => {
      if (st.ghost) st.ghost.remove();
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', up);
    };
    btn.addEventListener('pointermove', move);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
  });

  $('#paletteToggle').addEventListener('click', () => {
    board.classList.toggle('palette-collapsed');
  });

  // ===================== ツール・ボタン =====================
  function setMode(m) {
    S.mode = m;
    $('#toolDraw').classList.toggle('active', m === 'draw');
    $('#toolErase').classList.toggle('active', m === 'erase');
    board.classList.toggle('erase-mode', m === 'erase');
    renderAll();
  }
  $('#toolDraw').addEventListener('click', () => setMode('draw'));
  $('#toolErase').addEventListener('click', () => {
    setMode(S.mode === 'erase' ? 'draw' : 'erase');
    if (S.mode === 'erase') tip('erase', '消しゴム：原子か結合をタップすると消えるよ');
  });

  $('#bookBtn').addEventListener('click', () => Book.open());
  Book.onClose = updateBadge;

  // 設定
  const settings = $('#settings');
  const soundChk = $('#soundChk');
  $('#gearBtn').addEventListener('click', () => { soundChk.checked = save.sound; settings.hidden = false; });
  $('#settingsClose').addEventListener('click', () => (settings.hidden = true));
  settings.addEventListener('click', e => { if (e.target === settings) settings.hidden = true; });
  soundChk.addEventListener('change', () => { save.sound = soundChk.checked; persist(); });
  $('#clearBtn').addEventListener('click', () => { clearBoard(); settings.hidden = true; });
  $('#helpBtn').addEventListener('click', () => { settings.hidden = true; $('#help').hidden = false; });
  $('#resetBtn').addEventListener('click', () => {
    if (confirm('図鑑の記録をすべて消します。よろしいですか？')) {
      GA.resetSave();
      updateBadge();
      settings.hidden = true;
      toast('図鑑の記録をリセットしました');
    }
  });

  // 遊び方
  const help = $('#help');
  $('#helpClose').addEventListener('click', () => {
    help.hidden = true;
    if (!save.helpSeen) { save.helpSeen = true; persist(); }
  });
  if (!save.helpSeen) help.hidden = false;

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { settings.hidden = true; }
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'e' || e.key === 'E') setMode(S.mode === 'erase' ? 'draw' : 'erase');
  });

  // ===================== サイズ調整・起動 =====================
  function resize() {
    S.W = svg.clientWidth;
    S.H = svg.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${S.W} ${S.H}`);
    for (const a of S.atoms.values()) clampAtom(a);
    renderAll();
  }
  window.addEventListener('resize', resize);
  resize();
  updateBadge();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン対応なしでも動く */ });
  }
})();
