(() => {
  'use strict';

  const B = window.BLOG;
  const main = document.getElementById('main');
  if (!B) {
    main.innerHTML = '<p class="empty">data.js 가 없습니다. <code>python3 -I tools/build.py</code> 를 먼저 실행하세요.</p>';
    return;
  }

  const PAGE = 10;
  const ED = window.TexcubeEditor;
  // 글쓰기: mode = 'checking' | 'github'(올린 사이트) | 'local'(tools/serve.py) | null(쓸 수 없는 사본)
  //         ready = 바로 쓸 수 있는지 (GitHub 은 이 브라우저에 토큰을 넣었는지)
  const api = { mode: ED ? 'checking' : null, ready: false };
  const enc = encodeURIComponent;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------- 날짜 (블로그 시간대 기준)
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: B.meta.timezone || 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = (ts) => Object.fromEntries(dtf.formatToParts(new Date(ts * 1000)).map((p) => [p.type, p.value]));
  const ymd = (ts) => { const p = parts(ts); return `${p.year}.${p.month}.${p.day}`; };
  const ymdhm = (ts) => { const p = parts(ts); return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}`; };

  // ---------------------------------------------------------------- 색인
  const entries = B.entries; // 최신 글이 앞
  const byId = new Map();
  const bySlogan = new Map();
  entries.forEach((e, i) => {
    const p = parts(e.published);
    e.idx = i;
    e.year = p.year;
    e.ym = `${p.year}-${p.month}`;
    e.search = [e.title, e.text, e.tags.join(' '), e.location].join(' ').toLowerCase();
    byId.set(e.id, e);
    bySlogan.set(e.slogan, e);
  });
  const catById = new Map(B.categories.map((c) => [c.id, c]));
  const catByName = new Map(B.categories.map((c) => [c.name, c]));
  const catLabel = (c) => (c ? c.label || c.name : '분류 없음');

  const tagCount = new Map();
  entries.forEach((e) => e.tags.forEach((t) => tagCount.set(t, (tagCount.get(t) || 0) + 1)));

  const locRoot = { name: '', path: '', count: 0, kids: new Map() };
  entries.forEach((e) => {
    if (!e.location) return;
    let node = locRoot;
    let path = '';
    for (const seg of e.location.split('/').filter(Boolean)) {
      path += '/' + seg;
      if (!node.kids.has(seg)) node.kids.set(seg, { name: seg, path, count: 0, kids: new Map() });
      node = node.kids.get(seg);
      node.count++;
    }
  });

  const allComments = [];
  entries.forEach((e) => e.comments.forEach((c) => allComments.push({ ...c, entry: e })));
  B.guestbook.forEach((c) => allComments.push({ ...c, entry: null }));
  allComments.sort((a, b) => b.written - a.written);

  // ---------------------------------------------------------------- 조각
  const locLink = (loc) => {
    const segs = loc.split('/').filter(Boolean);
    return segs.map((s, i) => `<a href="#/location/${enc('/' + segs.slice(0, i + 1).join('/'))}">${esc(s)}</a>`).join('<span class="sep">›</span>');
  };

  const metaLine = (e, withTime) => {
    const c = catById.get(e.category);
    const bits = [
      `<time>${withTime ? ymdhm(e.published) : ymd(e.published)}</time>`,
      `<a href="#/category/${enc(c ? c.name : '')}">${esc(catLabel(c))}</a>`,
    ];
    if (e.location) bits.push(`<span class="loc">${withTime ? locLink(e.location) : esc(e.location.split('/').filter(Boolean).slice(-2).join(' '))}</span>`);
    if (!withTime && e.comments.length) bits.push(`<span>댓글 ${e.comments.length}</span>`);
    return bits.join('<span class="dot">·</span>');
  };

  const highlight = (s, q) => {
    if (!q) return esc(s);
    const lower = s.toLowerCase();
    let out = '';
    let i = 0;
    for (let j = lower.indexOf(q); j >= 0; j = lower.indexOf(q, i)) {
      out += esc(s.slice(i, j)) + '<mark>' + esc(s.slice(j, j + q.length)) + '</mark>';
      i = j + q.length;
    }
    return out + esc(s.slice(i));
  };

  const excerpt = (e, q) => {
    if (q) {
      const j = e.text.toLowerCase().indexOf(q);
      if (j >= 0) {
        const start = Math.max(0, j - 40);
        return (start ? '…' : '') + highlight(e.text.slice(start, start + 150), q);
      }
    }
    return esc(e.text.slice(0, 150));
  };

  const card = (e, q) => `
    <article class="card">
      <a href="#/entry/${e.id}" class="card-link">
        ${e.thumb ? `<img class="thumb" src="${esc(e.thumb)}" alt="" loading="lazy">` : '<span class="thumb none" aria-hidden="true"></span>'}
        <span class="card-body">
          <span class="card-title">${e.private ? '<span class="badge">비공개</span>' : ''}${highlight(e.title, q)}</span>
          <span class="card-meta">${metaLine(e, false).replace(/<a [^>]*>|<\/a>/g, '')}</span>
          <span class="card-excerpt">${excerpt(e, q)}</span>
        </span>
      </a>
    </article>`;

  const pager = (page, pages, base) => {
    if (pages <= 1) return '';
    const href = (n) => (n === 1 ? base : `${base}/page/${n}`).replace('#//', '#/');
    const nums = [];
    for (let n = 1; n <= pages; n++) {
      if (n === 1 || n === pages || Math.abs(n - page) <= 2) nums.push(n);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    return `<nav class="pager" aria-label="페이지">
      ${page > 1 ? `<a href="${href(page - 1)}" rel="prev">‹ 이전</a>` : '<span class="off">‹ 이전</span>'}
      ${nums.map((n) => (n === '…' ? '<span class="gap">…</span>' : n === page ? `<span class="cur" aria-current="page">${n}</span>` : `<a href="${href(n)}">${n}</a>`)).join('')}
      ${page < pages ? `<a href="${href(page + 1)}" rel="next">다음 ›</a>` : '<span class="off">다음 ›</span>'}
    </nav>`;
  };

  const listView = ({ heading, sub, items, base, page = 1, q = '' }) => {
    const pages = Math.max(1, Math.ceil(items.length / PAGE));
    page = Math.min(Math.max(1, page), pages);
    const slice = items.slice((page - 1) * PAGE, page * PAGE);
    let lastYear = null;
    const rows = slice.map((e) => {
      const sep = e.year !== lastYear ? `<h3 class="year-sep">${e.year}</h3>` : '';
      lastYear = e.year;
      return sep + card(e, q);
    }).join('');
    return `
      ${heading ? `<header class="page-head"><h1>${heading}</h1>${sub ? `<p>${sub}</p>` : ''}</header>` : ''}
      ${rows || '<p class="empty">글이 없습니다.</p>'}
      ${pager(page, pages, base)}`;
  };

  const autolink = (escaped) => escaped.replace(/https?:\/\/[^\s<>"']+/g, (u) => `<a href="${u}" target="_blank" rel="nofollow noopener">${u}</a>`);

  const commentTree = (list) => {
    if (!list.length) return '<p class="empty">댓글이 없습니다.</p>';
    const ids = new Set(list.map((c) => c.id));
    const kids = new Map();
    const roots = [];
    list.forEach((c) => {
      if (c.parent && ids.has(c.parent)) {
        if (!kids.has(c.parent)) kids.set(c.parent, []);
        kids.get(c.parent).push(c);
      } else roots.push(c);
    });
    const one = (c) => `
      <li class="cmt${c.owner ? ' by-owner' : ''}" id="c${c.id}">
        <div class="cmt-head">
          ${c.homepage ? `<a class="cmt-name" href="${esc(c.homepage)}" target="_blank" rel="nofollow noopener">${esc(c.name)}</a>` : `<span class="cmt-name">${esc(c.name)}</span>`}
          ${c.owner ? '<span class="badge">주인장</span>' : ''}
          <time>${ymdhm(c.written)}</time>
        </div>
        <div class="cmt-body">${c.secret && !c.text ? '<em class="muted">비밀 댓글입니다.</em>' : autolink(esc(c.text)).replace(/\r?\n/g, '<br>')}</div>
        ${kids.has(c.id) ? `<ol class="replies">${kids.get(c.id).map(one).join('')}</ol>` : ''}
      </li>`;
    return `<ol class="cmts">${roots.map(one).join('')}</ol>`;
  };

  // ---------------------------------------------------------------- 화면
  const views = {
    home(page) {
      return listView({ items: entries, base: '#/', page });
    },

    category(name, page) {
      const c = catByName.get(name);
      if (!c) return null;
      const items = entries.filter((e) => e.category === c.id);
      return listView({ heading: esc(catLabel(c)), sub: `글 ${items.length}개`, items, base: `#/category/${enc(name)}`, page });
    },

    tag(name, page) {
      const items = entries.filter((e) => e.tags.includes(name));
      return listView({ heading: `<span class="muted">태그</span> ${esc(name)}`, sub: `글 ${items.length}개`, items, base: `#/tag/${enc(name)}`, page });
    },

    tags() {
      const max = Math.max(...tagCount.values());
      const list = [...tagCount.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'));
      return `
        <header class="page-head"><h1>태그</h1><p>${list.length}개</p></header>
        <p class="cloud">${list.map(([t, n]) => `<a href="#/tag/${enc(t)}" style="--w:${(0.4 + 0.6 * Math.log(n + 1) / Math.log(max + 1)).toFixed(2)}">${esc(t)}<sup>${n}</sup></a>`).join('')}</p>`;
    },

    archive(key, page) {
      if (key) {
        const items = entries.filter((e) => (key.length === 4 ? e.year === key : e.ym === key));
        const label = key.length === 4 ? `${key}년` : `${key.slice(0, 4)}년 ${Number(key.slice(5))}월`;
        return listView({ heading: label, sub: `글 ${items.length}개`, items, base: `#/archive/${key}`, page });
      }
      const years = new Map();
      entries.forEach((e) => {
        if (!years.has(e.year)) years.set(e.year, new Array(12).fill(0));
        years.get(e.year)[Number(e.ym.slice(5)) - 1]++;
      });
      const max = Math.max(...[...years.values()].flat());
      return `
        <header class="page-head"><h1>보관함</h1><p>${entries[entries.length - 1].year}–${entries[0].year}, 글 ${entries.length}개</p></header>
        <div class="arch">
          <div class="arch-row arch-labels" aria-hidden="true"><span></span>${Array.from({ length: 12 }, (_, i) => `<span>${i + 1}</span>`).join('')}<span></span></div>
          ${[...years.entries()].map(([y, months]) => `
            <div class="arch-row">
              <a class="arch-year" href="#/archive/${y}">${y}</a>
              ${months.map((n, i) => {
                const m = String(i + 1).padStart(2, '0');
                return n
                  ? `<a class="arch-cell${n / max >= 0.4 ? ' hi' : ''}" href="#/archive/${y}-${m}" style="--a:${(0.2 + 0.8 * n / max).toFixed(2)}" title="${y}년 ${i + 1}월 · 글 ${n}개">${n}</a>`
                  : '<span class="arch-cell empty"></span>';
              }).join('')}
              <span class="arch-sum">${months.reduce((a, b) => a + b, 0)}</span>
            </div>`).join('')}
        </div>`;
    },

    location(path, page) {
      if (path) {
        const items = entries.filter((e) => e.location === path || e.location.startsWith(path + '/'));
        return listView({ heading: locLink(path), sub: `글 ${items.length}개`, items, base: `#/location/${enc(path)}`, page });
      }
      const tree = (node) => `<ul>${[...node.kids.values()].sort((a, b) => b.count - a.count).map((k) => `
        <li><a href="#/location/${enc(k.path)}">${esc(k.name)}</a> <span class="muted">${k.count}</span>${k.kids.size ? tree(k) : ''}</li>`).join('')}</ul>`;
      const n = entries.filter((e) => e.location).length;
      return `
        <header class="page-head"><h1>지역</h1><p>지역을 적어 둔 글 ${n}개</p></header>
        <div class="loc-tree">${tree(locRoot)}</div>`;
    },

    search(q, page) {
      const needle = q.trim().toLowerCase();
      const items = needle ? entries.filter((e) => e.search.includes(needle)) : [];
      return listView({ heading: `<span class="muted">검색</span> ${esc(q)}`, sub: `글 ${items.length}개`, items, base: `#/search/${enc(q)}`, page, q: needle });
    },

    guestbook() {
      const old = B.bbs ? ` · 2004년 <a href="#/bbs">${esc(B.bbs.title)}</a>도 있습니다` : '';
      return `
        <header class="page-head"><h1>방명록</h1><p>${B.guestbook.length}개${old}</p></header>
        <section class="comments">${commentTree(B.guestbook)}</section>`;
    },

    write(id) {
      if (id && !/^\d+$/.test(id)) return null;
      if (api.mode === 'checking') return '<p class="empty">글쓰기를 준비하는 중…</p>';
      if (!api.mode) {
        return `
          <header class="page-head"><h1>글쓰기</h1></header>
          <div class="notice-box">
            <p>이 사본에서는 글을 쓸 수 없습니다. 글은 다음 두 곳에서 쓸 수 있습니다.</p>
            <ul>
              <li>GitHub Pages 에 올린 사이트의 글쓰기 화면(<code>#/write</code>). GitHub 토큰으로 저장소에 바로 저장합니다.</li>
              <li>내 컴퓨터의 글쓰기 서버. <code>python3 -I tools/serve.py</code> 를 실행한 뒤 <code>http://127.0.0.1:8000/#/write</code> 를 엽니다.</li>
            </ul>
          </div>`;
      }
      return '<div id="editor-root"></div>';
    },

    // 예전 avej.com 제로보드 (읽기 전용 사본)
    bbs(page) {
      const b = B.bbs;
      if (!b) return null;
      const pages = Math.max(1, Math.ceil(b.posts.length / PAGE));
      page = Math.min(Math.max(1, page), pages);
      const times = b.posts.map((p) => p.written);
      const name = (x) => (x.homepage
        ? `<a class="cmt-name" href="${esc(x.homepage)}" target="_blank" rel="nofollow noopener">${esc(x.name)}</a>`
        : `<span class="cmt-name">${esc(x.name)}</span>`) + (x.owner ? '<span class="badge">주인장</span>' : '');
      const rows = b.posts.slice((page - 1) * PAGE, page * PAGE).map((p) => `
        <article class="bbs-post" id="b${p.no}">
          <h2>${p.notice ? '<span class="badge">공지</span>' : ''}${esc(p.subject)}</h2>
          <p class="bbs-meta">${name(p)}<span class="dot">·</span><time>${ymdhm(p.written)}</time><span class="dot">·</span><span>조회 ${p.hit.toLocaleString('ko-KR')}</span></p>
          <div class="content bbs-body">${p.html}</div>
          ${p.comments.length ? `<ol class="bbs-cmts">${p.comments.map((c) => `
            <li${c.owner ? ' class="by-owner"' : ''}>
              <div class="cmt-head">${name(c)}<time>${ymdhm(c.written)}</time></div>
              <div class="cmt-body">${c.html}</div>
            </li>`).join('')}</ol>` : ''}
        </article>`).join('');
      return `
        <header class="page-head">
          <h1>${esc(b.title)}</h1>
          <p>${ymd(Math.min(...times)).slice(0, 7)}–${ymd(Math.max(...times)).slice(0, 7)} · 글 ${b.posts.length}개 · 예전 avej.com 제로보드를 옮겨 온 읽기 전용 사본</p>
        </header>
        ${rows}
        ${pager(page, pages, '#/bbs')}`;
    },

    entry(key) {
      const e = byId.get(Number(key)) || bySlogan.get(key);
      if (!e) return null;
      const c = catById.get(e.category);
      const older = entries[e.idx + 1];
      const newer = entries[e.idx - 1];
      document.title = `${e.title} — ${B.meta.title}`;
      return `
        <article class="post">
          <header class="post-head">
            <a class="crumb" href="#/category/${enc(c ? c.name : '')}">${esc(catLabel(c))}</a>
            <h1>${e.private ? '<span class="badge">비공개</span>' : ''}${esc(e.title)}</h1>
            <p class="post-meta">${metaLine(e, true)}${e.isNew && api.ready ? `<span class="dot">·</span><a class="edit-link" href="#/write/${e.id}">고치기</a>` : ''}</p>
          </header>
          <div class="content">${e.html}</div>
          ${e.tags.length ? `<p class="post-tags">${e.tags.map((t) => `<a href="#/tag/${enc(t)}">#${esc(t)}</a>`).join('')}</p>` : ''}
        </article>
        <nav class="prevnext" aria-label="다른 글">
          ${older ? `<a class="older" href="#/entry/${older.id}"><small>이전 글</small>${esc(older.title)}</a>` : '<span></span>'}
          ${newer ? `<a class="newer" href="#/entry/${newer.id}"><small>다음 글</small>${esc(newer.title)}</a>` : '<span></span>'}
        </nav>
        ${e.isNew ? '' : `<section class="comments" id="comments">
          <h2>댓글 <span class="muted">${e.comments.length}</span></h2>
          ${commentTree(e.comments)}
        </section>`}`;
    },
  };

  // ---------------------------------------------------------------- 라우터
  // #/                      #/page/2
  // #/entry/12[/c345]       #/category/trip[/page/2]
  // #/tag/이름  #/tags      #/archive[/2008[-03]]
  // #/location[/경로]       #/search/검색어       #/guestbook
  const parse = (hash) => {
    const raw = hash.replace(/^#\/?/, '');
    const segs = raw ? raw.split('/').map((s) => { try { return decodeURIComponent(s); } catch { return s; } }) : [];
    let page = 1;
    if (segs.length >= 2 && segs[segs.length - 2] === 'page' && /^\d+$/.test(segs[segs.length - 1])) {
      page = Number(segs.pop());
      segs.pop();
    }
    return { segs, page };
  };

  const render = () => {
    const { segs, page } = parse(location.hash);
    const [head, ...rest] = segs;
    document.title = B.meta.title;
    let html = null;
    let anchor = null;
    let section = head || 'home';
    switch (head) {
      case undefined: case '': html = views.home(page); break;
      case 'entry': html = views.entry(rest[0]); anchor = rest[1]; break;
      case 'category': html = views.category(rest[0], page); section = 'cat:' + rest[0]; break;
      case 'tag': html = views.tag(rest[0], page); section = 'tags'; break;
      case 'tags': html = views.tags(); break;
      case 'archive': html = views.archive(rest[0], page); break;
      case 'location': html = views.location(rest.join('/') ? '/' + rest.join('/').replace(/^\/+/, '') : '', page); break;
      case 'search': html = views.search(rest.join('/'), page); break;
      case 'guestbook': html = views.guestbook(); anchor = rest[0]; break;
      case 'bbs': html = views.bbs(page); anchor = rest[0]; section = 'guestbook'; break;
      case 'write': html = views.write(rest[0]); document.title = `글쓰기 — ${B.meta.title}`; break;
      default: break;
    }
    if (head === 'entry' && html) {
      const e = byId.get(Number(rest[0])) || bySlogan.get(rest[0]);
      section = 'cat:' + (catById.get(e.category) || {}).name;
    }
    main.innerHTML = html ?? '<header class="page-head"><h1>찾을 수 없는 페이지</h1></header><p><a href="#/">처음으로</a></p>';

    document.querySelectorAll('#nav a').forEach((a) => {
      if (a.dataset.section === section) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (head === 'search') document.querySelector('#search input').value = rest.join('/');
    const editorRoot = document.getElementById('editor-root');
    if (editorRoot) ED.mount(editorRoot, { B, esc, catLabel, ymdhm, entries, mode: api.mode }, rest[0]);

    if (anchor) {
      const el = document.getElementById(anchor);
      if (el) {
        el.classList.add('flash');
        el.scrollIntoView({ block: 'center' });
        return;
      }
    }
    const y = scrollMemo.get(location.hash);
    window.scrollTo(0, y ?? 0);
  };

  // 뒤로 가기 했을 때 보던 위치로
  const scrollMemo = new Map();
  let currentHash = location.hash;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', () => {
    scrollMemo.set(currentHash, window.scrollY);
    currentHash = location.hash;
    render();
  });

  // ---------------------------------------------------------------- 머리·옆·바닥
  const chrome = () => {
    const m = B.meta;
    document.getElementById('site-title').textContent = m.title;
    document.getElementById('site-desc').textContent = m.description;
    if (m.logo) {
      const logo = document.getElementById('logo');
      logo.src = m.logo;
      logo.hidden = false;
    }

    document.getElementById('nav').innerHTML = [
      ['#/', '전체', 'home'],
      ...B.categories.map((c) => [`#/category/${enc(c.name)}`, catLabel(c), 'cat:' + c.name]),
      ['#/tags', '태그', 'tags'],
      ['#/location', '지역', 'location'],
      ['#/archive', '보관함', 'archive'],
      ['#/guestbook', '방명록', 'guestbook'],
      ...(api.ready ? [['#/write', '글쓰기', 'write']] : []),
    ].map(([href, label, sec]) => `<a href="${href}" data-section="${esc(sec)}">${esc(label)}</a>`).join('');

    const years = new Map();
    entries.forEach((e) => years.set(e.year, (years.get(e.year) || 0) + 1));
    const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);

    document.getElementById('side').innerHTML = `
      <section>
        <h2>분류</h2>
        <ul class="side-list">
          <li><a href="#/">전체</a><span>${entries.length}</span></li>
          ${B.categories.map((c) => `<li><a href="#/category/${enc(c.name)}">${esc(catLabel(c))}</a><span>${entries.filter((e) => e.category === c.id).length}</span></li>`).join('')}
        </ul>
      </section>
      <section>
        <h2>최근 댓글</h2>
        <ul class="side-cmts">
          ${allComments.slice(0, 6).map((c) => `
            <li><a href="${c.entry ? `#/entry/${c.entry.id}/c${c.id}` : `#/guestbook/c${c.id}`}">
              <span class="who">${esc(c.name)}</span>
              <span class="what">${esc((c.text || '비밀 댓글').slice(0, 40))}</span>
              <time>${ymd(c.written)}</time>
            </a></li>`).join('')}
        </ul>
      </section>
      <section>
        <h2>태그 <a class="more" href="#/tags">모두</a></h2>
        <p class="side-tags">${topTags.map(([t]) => `<a href="#/tag/${enc(t)}">${esc(t)}</a>`).join('')}</p>
      </section>
      <section>
        <h2>보관함 <a class="more" href="#/archive">달력</a></h2>
        <ul class="side-years">${[...years.entries()].map(([y, n]) => `<li><a href="#/archive/${y}">${y}</a><span>${n}</span></li>`).join('')}</ul>
      </section>
      ${B.links.length ? `<section><h2>링크</h2><ul class="side-list">${B.links.map((l) => (l.url.startsWith('#/')
        ? `<li><a href="${esc(l.url)}">${esc(l.name)}</a></li>`
        : `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a></li>`)).join('')}</ul></section>` : ''}`;

    const first = entries[entries.length - 1];
    const last = entries[0];
    document.getElementById('foot').innerHTML = `
      <p>© ${first.year}–${last.year} ${esc(m.author)} · ${esc(m.title)}</p>
      <p class="muted">${entries.some((e) => e.isNew) ? '2006–2018년 글은 태터툴즈 1.0.5 백업에서 옮김' : '태터툴즈 1.0.5 백업에서 만든 읽기 전용 사본'}${m.visitors ? ` · 백업 시점 누적 방문 ${m.visitors.toLocaleString('ko-KR')}` : ''}${m.includePrivate ? ' · <strong>비공개 글 포함</strong>' : ''}</p>`;
  };

  // 검색
  document.getElementById('search').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = ev.target.q.value.trim();
    if (q) location.hash = `#/search/${enc(q)}`;
  });

  // 본문 사진 크게 보기
  const box = document.getElementById('lightbox');
  const boxImg = box.querySelector('img');
  main.addEventListener('click', (ev) => {
    const img = ev.target.closest('.content img');
    if (!img || img.closest('a')) return;
    boxImg.src = img.currentSrc || img.src;
    box.hidden = false;
  });
  const closeBox = () => { box.hidden = true; boxImg.removeAttribute('src'); };
  box.addEventListener('click', closeBox);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !box.hidden) closeBox();
    if (box.hidden || !['ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
    const imgs = [...main.querySelectorAll('.content img')];
    const i = imgs.findIndex((x) => (x.currentSrc || x.src) === boxImg.src);
    const next = imgs[i + (ev.key === 'ArrowRight' ? 1 : -1)];
    if (next) boxImg.src = next.currentSrc || next.src;
  });

  // 불러오지 못한 본문 사진(사라진 외부 사이트 등)은 깨진 그림 대신 표시로 바꾼다
  main.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || !img.closest('.content')) return;
    const note = document.createElement('span');
    note.className = 'img-missing';
    note.textContent = '사진을 불러오지 못함';
    note.title = img.getAttribute('src') || '';
    img.replaceWith(note);
  }, true);

  chrome();
  render();

  // 글을 쓸 수 있으면 메뉴에 「글쓰기」를 넣고, 지금 화면을 다시 그린다
  if (ED) {
    ED.probe(B).then(({ mode, ready }) => {
      api.mode = mode;
      api.ready = ready;
      const head = parse(location.hash).segs[0];
      if (ready) {
        chrome();
        render();
      } else if (head === 'write') {
        render();
      }
    });
  }
})();
