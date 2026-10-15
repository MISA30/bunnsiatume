'use strict';

// 図鑑（集めた構造式の本）
const Book = (function () {
  const { MOLECULES, MOL_BY_ID, sub, miniSVG, save, persist } = GA;
  const $ = q => document.querySelector(q);

  const ov = $('#bookOverlay');
  const book = $('#book');
  const pageL = $('#pageL'), pageR = $('#pageR');
  const cover = $('#cover');
  const coverBack = cover.querySelector('.cover-back');
  const leaf = $('#leaf'), leafF = $('#leafFront'), leafB = $('#leafBack');
  const prevBtn = $('#bookPrev'), nextBtn = $('#bookNext');
  const detail = $('#detail'), detailBody = $('#detailBody');

  let pages = [];
  let view = 0;
  let wide = true;
  let busy = false;
  let isOpen = false;
  const api = { open, close, onClose: null };

  const isWide = () => window.innerWidth >= 760 && window.innerHeight >= 420;

  // 今の段階で見えている分子＋段階より先に見つけた「ひみつの分子」
  function entries() {
    const t = GA.currentTier();
    return MOLECULES.filter(m => m.tier <= t || save.collected[m.id]);
  }

  function build() {
    const list = entries();
    pages = [{ head: true, items: list.slice(0, 4) }];
    for (let i = 4; i < list.length; i += 6) pages.push({ items: list.slice(i, i + 6) });
    if (wide && pages.length % 2) pages.push({ items: [], blank: true });
  }

  const maxView = () => (wide ? Math.ceil(pages.length / 2) - 1 : pages.length - 1);

  function headHTML() {
    const list = entries();
    const got = list.filter(m => save.collected[m.id]).length;
    const next = GA.nextTierInfo();
    const pct = Math.round((got / list.length) * 100);
    return `<div class="page-head">
      <h2 class="page-title">集めた構造式</h2>
      <div class="progress"><span>${got} / ${list.length}</span><div class="bar"><i style="width:${pct}%"></i></div></div>
      <p class="next">${next ? `あと <b>${next.remaining}</b> こ集めると、新しい分子がリストに追加されるよ` : 'すべてのリストが開放された！'}</p>
    </div>`;
  }

  function entryHTML(m) {
    const c = save.collected[m.id];
    if (c) {
      return `<button class="entry" data-id="${m.id}">
        ${c.seen === false ? '<span class="new">NEW</span>' : ''}
        <div class="emini">${miniSVG(c.snap, 140, 84)}</div>
        <div class="ename">${m.name}</div><div class="eform">${sub(m.formula)}</div>
      </button>`;
    }
    return `<button class="entry locked" data-id="${m.id}">
      <div class="emini mystery">？</div>
      <div class="ename">？？？</div><div class="eform">&nbsp;</div>
    </button>`;
  }

  function pageHTML(i) {
    const p = pages[i];
    if (!p) return '';
    let h = '<div class="page-inner">';
    if (p.head) h += headHTML();
    if (p.blank) {
      h += `<div class="page-blank"><svg viewBox="0 0 60 70" width="70"><circle cx="20" cy="10" r="6"/><circle cx="34" cy="20" r="4"/>
        <path d="M24 30h12M27 30v12L16 62h28L33 42V30"/></svg><p>つづきは、分子を集めると<br>増えていくよ</p></div>`;
    } else {
      h += `<div class="entries${p.head ? ' two-rows' : ''}">${p.items.map(entryHTML).join('')}</div>`;
    }
    h += `<div class="page-no">${i + 1}</div></div>`;
    return h;
  }

  function show() {
    if (wide) {
      pageL.innerHTML = pageHTML(2 * view);
      pageR.innerHTML = pageHTML(2 * view + 1);
    } else {
      pageR.innerHTML = pageHTML(view);
    }
    updateNav();
  }

  function updateNav() {
    prevBtn.disabled = view <= 0;
    nextBtn.disabled = view >= maxView();
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    wide = isWide();
    book.classList.toggle('single', !wide);
    build();
    view = 0;
    show();
    detail.hidden = true;
    leaf.hidden = true;
    // 表紙の裏に左ページと同じ中身を描いておく → めくれた表紙がそのまま左ページになる
    coverBack.innerHTML = wide ? pageL.innerHTML : '';
    cover.style.transition = 'none';
    cover.style.opacity = '1';
    book.classList.remove('open', 'revealed');
    ov.hidden = false;
    busy = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      cover.style.transition = '';
      ov.classList.add('shown');
      setTimeout(() => { book.classList.add('open'); sfxPage(); }, 380);
      setTimeout(() => {
        // 表紙がめくれきったら、見た目の同じ本物の左ページと入れかえる
        book.classList.add('revealed');
        cover.style.transition = 'none';
        cover.style.opacity = '0';
        busy = false;
      }, 1450);
    }));
  }

  function close() {
    if (!isOpen || busy) return;
    busy = true;
    detail.hidden = true;
    // 見たものは NEW を外す
    for (const id in save.collected) save.collected[id].seen = true;
    persist();
    // 今の左ページを表紙の裏に写してから、本物の左ページを隠して表紙を戻す
    coverBack.innerHTML = wide ? pageL.innerHTML : '';
    cover.style.transition = 'none';
    cover.style.opacity = '1';
    book.classList.remove('revealed');
    void cover.offsetWidth;
    cover.style.transition = '';
    setTimeout(() => book.classList.remove('open'), 30);
    setTimeout(() => ov.classList.remove('shown'), 1050);
    setTimeout(() => {
      ov.hidden = true;
      busy = false;
      isOpen = false;
      if (api.onClose) api.onClose();
    }, 1400);
  }

  function flip(dir) {
    if (busy || !isOpen) return;
    const nv = view + dir;
    if (nv < 0 || nv > maxView()) return;
    busy = true;
    detail.hidden = true;
    let from, to, after;
    if (wide) {
      if (dir > 0) {
        leaf.className = 'leaf on-right';
        leafF.innerHTML = pageHTML(2 * view + 1);
        leafB.innerHTML = pageHTML(2 * nv);
        pageR.innerHTML = pageHTML(2 * nv + 1);
        [from, to] = [0, -180];
        after = () => { pageL.innerHTML = pageHTML(2 * nv); };
      } else {
        leaf.className = 'leaf on-left';
        leafF.innerHTML = pageHTML(2 * view);
        leafB.innerHTML = pageHTML(2 * nv + 1);
        pageL.innerHTML = pageHTML(2 * nv);
        [from, to] = [0, 180];
        after = () => { pageR.innerHTML = pageHTML(2 * nv + 1); };
      }
    } else {
      leaf.className = 'leaf on-full';
      if (dir > 0) {
        leafF.innerHTML = pageHTML(view);
        leafB.innerHTML = '';
        pageR.innerHTML = pageHTML(nv);
        [from, to] = [0, -180];
        after = () => {};
      } else {
        leafF.innerHTML = pageHTML(nv);
        leafB.innerHTML = '';
        [from, to] = [-180, 0];
        after = () => { pageR.innerHTML = pageHTML(nv); };
      }
    }
    leaf.hidden = false;
    sfxPage();
    const anim = leaf.animate(
      [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }],
      { duration: 650, easing: 'cubic-bezier(.45,.05,.35,1)' }
    );
    // 画面が裏に回っているとアニメーションが終わらないことがあるので、時間でも確実に終える
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      anim.cancel();
      after();
      leaf.hidden = true;
      view = nv;
      updateNav();
      busy = false;
    };
    anim.onfinish = finish;
    setTimeout(finish, 720);
  }

  // ページをめくる音（紙がこすれるようなノイズ）
  let actx = null;
  function sfxPage() {
    if (!save.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const len = actx.sampleRate * 0.25;
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2) * Math.sin((Math.PI * i) / len);
      const src = actx.createBufferSource();
      const f = actx.createBiquadFilter();
      const g = actx.createGain();
      f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8;
      g.gain.value = 0.25;
      src.buffer = buf;
      src.connect(f).connect(g).connect(actx.destination);
      src.start();
    } catch (e) { /* 無視 */ }
  }

  // ---- くわしく見る ----
  function showDetail(id) {
    const m = MOL_BY_ID[id];
    const c = save.collected[id];
    const kind = m.mono ? '単原子分子' : m.ionic ? 'イオン結合' : '共有結合';
    if (c) {
      const date = new Date(c.t).toLocaleDateString('ja-JP');
      detailBody.innerHTML = `
        <div class="d-mini">${miniSVG(c.snap, 300, 190)}</div>
        <h3 class="d-name">${m.name}</h3>
        <div class="d-form">${sub(m.formula)}<span class="d-kind">${kind}</span></div>
        <p class="d-note">${m.note}</p>
        <p class="d-date">${date} に発見</p>`;
    } else {
      detailBody.innerHTML = `
        <div class="d-mini mystery">？</div>
        <h3 class="d-name">？？？</h3>
        <p class="d-note">まだ見つけていない分子だよ。<br>いろいろな原子を ○（ひとりの電子）がすべてなくなるようにつないでみよう。</p>`;
    }
    detail.hidden = false;
  }

  book.addEventListener('click', e => {
    const b = e.target.closest('.entry');
    if (!b || busy) return;
    showDetail(b.dataset.id);
  });
  $('#detailClose').addEventListener('click', () => (detail.hidden = true));
  detail.addEventListener('click', e => { if (e.target === detail) detail.hidden = true; });

  prevBtn.addEventListener('click', () => flip(-1));
  nextBtn.addEventListener('click', () => flip(1));
  $('#bookClose').addEventListener('click', close);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });

  // スワイプでページをめくる
  let sw = null;
  book.addEventListener('pointerdown', e => { sw = { x: e.clientX, y: e.clientY }; });
  book.addEventListener('pointerup', e => {
    if (!sw) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    sw = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) flip(dx < 0 ? 1 : -1);
  });

  document.addEventListener('keydown', e => {
    if (!isOpen) return;
    if (e.key === 'Escape') { if (!detail.hidden) detail.hidden = true; else close(); }
    if (e.key === 'ArrowRight') flip(1);
    if (e.key === 'ArrowLeft') flip(-1);
  });

  window.addEventListener('resize', () => {
    if (!isOpen || busy) return;
    const w = isWide();
    if (w === wide) return;
    const first = wide ? 2 * view : view; // 今見ているページ番号を保つ
    wide = w;
    book.classList.toggle('single', !wide);
    build();
    view = Math.min(wide ? Math.floor(first / 2) : first, maxView());
    show();
  });

  return api;
})();
