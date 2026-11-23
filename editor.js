// 글쓰기 화면. 글을 저장하는 곳은 둘 중 하나다.
//   GitHub    GitHub Pages 에 올린 사이트. 브라우저가 GitHub API 로 저장소의 posts/ 에 바로 커밋하고,
//             GitHub Actions 가 사이트를 다시 만든다(1~2분). 본인 확인 = 이 저장소에만 쓸 수 있는 GitHub 토큰.
//   내 컴퓨터  tools/serve.py 로 연 경우. 서버가 posts/ 에 쓰고 site/ 를 바로 다시 만든다. 올리는 것은 git push.
// 두 곳 모두 posts/<번호>.json 과 posts/attach/<사진> 을 같은 모양으로 쓴다 (tools/posts.py 설명 참고).
(() => {
  'use strict';

  const DRAFT_KEY = (id) => `texcube:draft:${id || 'new'}`;
  const GH_KEY = 'texcube:github';          // {token, owner, name, branch, login}
  const GH_API_KEY = 'texcube:github-api';  // 시험할 때만 씀: GitHub API 대신 부를 주소
  const MAX_SIDE = 1600;     // 올리는 사진의 긴 변
  const SHOW_WIDTH = 720;    // 본문에 넣을 때의 폭 (옛 글과 같은 640~720)
  const MAX_IMAGE = 15 * 1024 * 1024;
  const WAIT_LIMIT = 6 * 60 * 1000; // 사이트가 다시 만들어지기를 기다리는 최대 시간
  const enc = encodeURIComponent;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nowSec = () => Math.floor(Date.now() / 1000);

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 못 해도 글쓰기는 된다 */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
  };

  // ---------------------------------------------------------------- 글 검사 (tools/posts.py 의 clean·slugify 와 같게)
  function clean(data, categories) {
    const title = String(data.title ?? '').trim();
    if (!title) throw new Error('제목을 적어 주세요.');
    if (title.length > 255) throw new Error('제목은 255자까지 쓸 수 있습니다.');
    const content = String(data.content ?? '');
    if (!content.trim()) throw new Error('본문을 적어 주세요.');
    const category = Number(data.category);
    if (!categories.some((c) => c.id === category)) throw new Error('분류를 골라 주세요.');
    const tags = [];
    for (const t of data.tags || []) {
      const s = String(t).trim();
      if (s && !tags.includes(s)) tags.push(s.slice(0, 255));
    }
    const segs = String(data.location ?? '').split('/').map((s) => s.trim()).filter(Boolean);
    const visibility = data.visibility || 'public';
    if (!['public', 'private'].includes(visibility)) throw new Error('공개 여부가 올바르지 않습니다.');
    const published = Math.floor(Number(data.published) || nowSec());
    return {
      title,
      category,
      tags,
      location: segs.length ? '/' + segs.join('/') : '',
      visibility,
      published,
      content: content.replace(/\r\n/g, '\n'),
    };
  }

  function slugify(title, taken) {
    const s = title.replace(/-+/g, ' ').replace(/[!-/:-@[-^`{-~]+/g, '').trim().replace(/\s+/g, '-').replace(/^-+|-+$/g, '') || 'post';
    let slug = s;
    for (let n = 2; taken.has(slug); n++) slug = `${s}-${n}`;
    return slug;
  }

  // ---------------------------------------------------------------- 저장 전 사진 (GitHub 쪽)
  // 사진은 글을 저장할 때 함께 커밋한다. 그때까지 이 브라우저(IndexedDB)에 두어 새로고침해도 남게 한다.
  const pics = {
    mem: new Map(), // 이름 → {name, blob, draft}
    urls: new Map(),
    db: undefined,
    open() {
      if (this.db !== undefined) return Promise.resolve(this.db);
      return new Promise((ok) => {
        try {
          const r = indexedDB.open('texcube', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('pics');
          r.onsuccess = () => ok((this.db = r.result));
          r.onerror = () => ok((this.db = null));
        } catch { ok((this.db = null)); }
      });
    },
    async tx(mode, fn) {
      const db = await this.open();
      if (!db) return undefined; // 사생활 보호 창 등: 이 화면을 닫기 전까지만 기억한다
      return new Promise((ok) => {
        const t = db.transaction('pics', mode);
        const req = fn(t.objectStore('pics'));
        t.oncomplete = () => ok(req?.result);
        t.onerror = t.onabort = () => ok(undefined);
      });
    },
    async load() {
      ((await this.tx('readonly', (s) => s.getAll())) || []).forEach((rec) => this.mem.set(rec.name, rec));
    },
    async put(name, blob, draft) {
      const rec = { name, blob, draft, at: Date.now() };
      this.mem.set(name, rec);
      await this.tx('readwrite', (s) => s.put(rec, name));
    },
    async drop(names) {
      names = [...new Set(names)];
      names.forEach((n) => {
        this.mem.delete(n);
        if (this.urls.has(n)) { URL.revokeObjectURL(this.urls.get(n)); this.urls.delete(n); }
      });
      if (names.length) await this.tx('readwrite', (s) => { names.forEach((n) => s.delete(n)); });
    },
    names() { return [...this.mem.keys()]; },
    ofDraft(draft) { return [...this.mem.values()].filter((r) => r.draft === draft).map((r) => r.name); },
    url(name) {
      if (!this.mem.has(name)) return null;
      if (!this.urls.has(name)) this.urls.set(name, URL.createObjectURL(this.mem.get(name).blob));
      return this.urls.get(name);
    },
  };

  const b64 = (blob) => new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => no(r.error);
    r.readAsDataURL(blob);
  });

  const imageName = (type) => {
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[type];
    if (!ext) throw new Error('JPEG·PNG·GIF·WebP 사진만 올릴 수 있습니다.');
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const hex = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `n${ymd}-${hex}.${ext}`; // tools/posts.py 의 IMAGE_NAME 과 같은 꼴
  };

  // ---------------------------------------------------------------- 저장하는 곳 ① 내 컴퓨터 글쓰기 서버
  function localBackend() {
    async function call(method, path, body, raw) {
      const opts = { method, headers: { 'X-Texcube': '1' }, cache: 'no-store' };
      if (body !== undefined) {
        opts.body = raw ? body : JSON.stringify(body);
        opts.headers['Content-Type'] = raw ? (body.type || 'application/octet-stream') : 'application/json';
      }
      const res = await fetch(path, opts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `서버가 응답하지 않습니다 (${res.status})`);
      return data;
    }
    return {
      kind: 'local',
      hiddenLabel: '비공개',
      hiddenOption: '비공개',
      async me() {
        const m = await call('GET', '/api/me');
        return `${m.name} 님${m.temporary ? ' · 본인 확인은 아직 임시(항상 통과)' : ''}`;
      },
      list: async () => (await call('GET', '/api/posts')).posts,
      get: (id) => call('GET', `/api/posts/${id}`),
      save: (id, data) => (id ? call('PUT', `/api/posts/${id}`, data) : call('POST', '/api/posts', data)),
      remove: (id) => call('DELETE', `/api/posts/${id}`),
      addImage: async (blob) => (await call('POST', '/api/images', blob, true)).name,
    };
  }

  // ---------------------------------------------------------------- 저장하는 곳 ② GitHub 저장소
  function githubBackend(cfg, B) {
    const api = String(store.get(GH_API_KEY) || 'https://api.github.com').replace(/\/+$/, '');
    const R = `/repos/${enc(cfg.owner)}/${enc(cfg.name)}`;
    const head = `heads/${cfg.branch.split('/').map(enc).join('/')}`;
    const repoName = `${cfg.owner}/${cfg.name}`;
    const uploaded = new Map(); // 경로 → blob sha (다시 시도할 때 사진을 또 올리지 않게)
    const repoImages = new Map(); // 사진 이름 → 저장소에서 받은 사진의 blob: 주소 (Promise)

    const explain = (status, message) => {
      if (status === 401) return 'GitHub 가 이 토큰을 받지 않았습니다. 기한이 지났거나 지운 토큰입니다. 「연결 끊기」를 누르고 새 토큰을 넣어 주세요.';
      if (status === 403 && /rate limit/i.test(message)) return 'GitHub 요청 한도를 넘었습니다. 잠시 뒤에 다시 해 주세요.';
      if (status === 403 || status === 404) {
        return `이 토큰으로는 ${repoName} 저장소의 ${cfg.branch} 브랜치에 쓸 수 없습니다. 저장소·브랜치 이름, 토큰을 만들 때 이 저장소를 골랐는지, Contents 권한이 Read and write 인지 확인해 주세요.`;
      }
      if (status === 409) return `${repoName} 저장소가 비어 있습니다. 먼저 이 프로젝트를 저장소에 올려 주세요.`;
      return `GitHub 가 요청을 처리하지 못했습니다 (${status}${message ? `: ${message}` : ''}).`;
    };

    async function req(method, path, body, { raw = false, ok404 = false } = {}) {
      let res;
      try {
        res = await fetch(api + path, {
          method,
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${cfg.token}`,
            Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new Error('GitHub 에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
      }
      if (ok404 && res.status === 404) return null;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(explain(res.status, data.message || ''));
        err.status = res.status;
        throw err;
      }
      if (raw) return res.text();
      return res.status === 204 ? null : res.json();
    }

    const listDir = async (path, ref) => {
      const items = await req('GET', `${R}/contents/${path}?ref=${enc(ref)}`, undefined, { ok404: true });
      return Array.isArray(items) ? items.filter((x) => x.type === 'file') : [];
    };
    const readFile = (path, ref, ok404 = false) => req('GET', `${R}/contents/${path}?ref=${enc(ref)}`, undefined, { raw: true, ok404 });

    async function readPosts(ref) {
      const files = (await listDir('posts', ref)).filter((x) => /^\d+\.json$/.test(x.name));
      const posts = (await Promise.all(files.map(async (x) => {
        try { return JSON.parse(await readFile(`posts/${x.name}`, ref)); } catch { return null; }
      }))).filter((p) => p && Number.isInteger(p.id));
      const deleted = (await listDir('posts/deleted', ref))
        .map((x) => Number((x.name.match(/^(\d+)-/) || [])[1])).filter(Boolean);
      return { posts, deleted };
    }

    async function branchHead() {
      const ref = await req('GET', `${R}/git/ref/${head}`);
      const commit = await req('GET', `${R}/git/commits/${ref.object.sha}`);
      return { sha: ref.object.sha, tree: commit.tree.sha };
    }

    // 파일 여러 개를 커밋 하나로. files: [{path, text} | {path, blob} | {path, remove: true}]
    async function commitFiles(message, files, base) {
      const tree = [];
      for (const f of files) {
        const entry = { path: f.path, mode: '100644', type: 'blob' };
        if (f.remove) entry.sha = null;
        else if (f.text !== undefined) entry.content = f.text;
        else {
          if (!uploaded.has(f.path)) {
            uploaded.set(f.path, (await req('POST', `${R}/git/blobs`, { content: await b64(f.blob), encoding: 'base64' })).sha);
          }
          entry.sha = uploaded.get(f.path);
        }
        tree.push(entry);
      }
      const t = await req('POST', `${R}/git/trees`, { base_tree: base.tree, tree });
      const c = await req('POST', `${R}/git/commits`, { message, tree: t.sha, parents: [base.sha] });
      await req('PATCH', `${R}/git/refs/${head}`, { sha: c.sha }); // 그사이 다른 커밋이 들어왔으면 422
      return c.sha;
    }

    // 다른 기기에서 그사이 저장해 브랜치 끝이 바뀌었으면 처음부터 다시 한다
    async function onBranchHead(fn) {
      for (let i = 0; ; i++) {
        try {
          return await fn(await branchHead());
        } catch (err) {
          if (err.status !== 422 || i >= 2) throw err;
          await sleep(700);
        }
      }
    }

    return {
      kind: 'github',
      hiddenLabel: '비공개',
      hiddenOption: '비공개 (사이트에 올리지 않음)',
      repoName,
      actionsUrl: `https://github.com/${repoName}/actions`,

      // 토큰이 이 저장소·브랜치를 읽을 수 있는지. 쓰기 권한은 처음 저장할 때 GitHub 가 확인한다.
      async check() {
        const user = await req('GET', '/user');
        const repo = await req('GET', R);
        if (repo.permissions && repo.permissions.push === false) {
          throw new Error(`GitHub 계정 ${user.login} 은 ${repoName} 저장소에 쓸 권한이 없습니다.`);
        }
        await branchHead();
        return user.login;
      },
      me: async () => `${B.meta.author} 님 · GitHub ${cfg.login || ''} 계정으로 ${repoName} 저장소에 저장`,
      list: async () => (await readPosts(cfg.branch)).posts,
      async get(id) {
        const text = await readFile(`posts/${id}.json`, cfg.branch, true);
        if (text === null) throw new Error('그 번호의 새 글이 저장소에 없습니다. (옛 글은 고칠 수 없습니다)');
        return JSON.parse(text);
      },
      async save(id, data) {
        const images = pics.names().filter((n) => data.content.includes(n))
          .map((n) => ({ path: `posts/attach/${n}`, blob: pics.mem.get(n).blob }));
        return onBranchHead(async (base) => {
          const t = nowSec();
          let post;
          if (id) {
            const old = JSON.parse(await readFile(`posts/${id}.json`, base.sha));
            // 주소(slogan)는 처음 정한 것을 지킨다 — 이미 공유한 링크가 깨지지 않게
            post = { ...old, ...data, id: Number(id), modified: t };
          } else {
            const { posts, deleted } = await readPosts(base.sha);
            const used = [B.meta.maxOldId || 0, ...B.entries.map((e) => e.id), ...posts.map((p) => p.id), ...deleted];
            const taken = new Set([...B.entries.map((e) => e.slogan), ...posts.map((p) => p.slogan)]);
            const { title, ...rest } = data;
            post = { id: Math.max(...used) + 1, title, slogan: slugify(title, taken), ...rest, created: t, modified: t };
          }
          const commit = await commitFiles(`${id ? '글 고침' : '새 글'} ${post.id}: ${post.title}`,
            [{ path: `posts/${post.id}.json`, text: JSON.stringify(post, null, 2) + '\n' }, ...images], base);
          return { id: post.id, slogan: post.slogan, commit, images: images.map((x) => x.path.split('/').pop()) };
        });
      },
      remove(id) {
        return onBranchHead(async (base) => {
          const text = await readFile(`posts/${id}.json`, base.sha);
          let title = '';
          try { title = JSON.parse(text).title; } catch { /* 제목 없이 */ }
          // 지운 글은 posts/deleted/ 로 옮긴다(되살릴 수 있게). 사진은 그대로 둔다.
          return commitFiles(`글 지움 ${id}: ${title}`,
            [{ path: `posts/${id}.json`, remove: true }, { path: `posts/deleted/${id}-${nowSec()}.json`, text }], base);
        });
      },
      async addImage(blob, draft) {
        const name = imageName(blob.type);
        await pics.put(name, blob, draft);
        return name;
      },
      // 저장소에 커밋한 사진. 사이트에는 공개 글의 사진만 올라가고(빌드가 고름), 저장소는 private 이라
      // raw.githubusercontent.com 주소로는 받을 수 없어서 토큰을 붙여 API 로 받는다.
      loadImage(name) {
        if (!repoImages.has(name)) {
          repoImages.set(name, (async () => {
            const res = await fetch(`${api}${R}/contents/posts/attach/${enc(name)}?ref=${enc(cfg.branch)}`, {
              headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github.raw+json' },
            });
            if (!res.ok) throw new Error(String(res.status));
            return URL.createObjectURL(await res.blob());
          })());
          repoImages.get(name).catch(() => repoImages.delete(name)); // 실패한 것은 다음 미리보기에 다시 받는다
        }
        return repoImages.get(name);
      },

      // 사이트(version.json)가 commit 을 담은 빌드로 바뀔 때까지 기다린다
      async waitForSite(commit, onTick) {
        const start = Date.now();
        let seen = B.meta.commit || null;
        while (Date.now() - start < WAIT_LIMIT) {
          await sleep(5000);
          onTick(Math.round((Date.now() - start) / 1000));
          let v;
          try { v = await (await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' })).json(); } catch { continue; }
          if (!v.commit || v.commit === seen) continue;
          if (v.commit === commit) return true;
          try { // 그 뒤에 다른 커밋이 더 들어와 그것으로 만들어졌으면, 그 커밋이 내 커밋을 담고 있는지
            const cmp = await req('GET', `${R}/compare/${commit}...${v.commit}`);
            if (cmp.status === 'ahead' || cmp.status === 'identical') return true;
            seen = v.commit;
          } catch { /* 다음 차례에 다시 */ }
        }
        return false;
      },
    };
  }

  // 글을 저장할 저장소. GitHub Actions 가 빌드할 때 넣어 준 값을 쓴다.
  // 없으면 사이트 주소에서 짐작한다: 사이트는 public 저장소(예: blog_smgal-net)이고 글은 그 이름에
  // _src 를 붙인 private 저장소(blog_smgal-net_src)에 저장한다(README 「GitHub 에 올리기」의 이름 규칙).
  function siteRepo(B) {
    const r = B.meta.repo;
    if (r?.owner && r?.name) return { owner: r.owner, name: r.name, branch: r.branch || 'main' };
    const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
    if (!m) return null;
    const seg = location.pathname.split('/').filter(Boolean)[0];
    const site = seg && !/\.html?$/i.test(seg) ? seg : `${m[1]}.github.io`;
    return { owner: m[1], name: `${site}_src`, branch: 'main' };
  }

  async function localServer() {
    if (!/^https?:$/.test(location.protocol) || !/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return false;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    try {
      const res = await fetch('/api/health', { cache: 'no-store', signal: ctl.signal });
      const data = await res.json();
      return res.ok && data.app === 'texcube';
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // 어디에 저장할 수 있는지. mode: 'local' | 'github' | null, ready: 바로 쓸 수 있는지(GitHub 은 토큰을 넣었는지)
  async function probe(B) {
    if (await localServer()) return { mode: 'local', ready: true };
    if (store.get(GH_KEY)?.token) return { mode: 'github', ready: true };
    return { mode: siteRepo(B) ? 'github' : null, ready: false };
  }

  // 사진을 줄여 다시 저장한다. EXIF 는 따라가지 않으므로 회전 값·GPS 가 빠진다.
  async function shrink(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width: w0, height: h0 } = bmp;
    if (file.type === 'image/gif') { bmp.close(); return { blob: file, width: w0, height: h0 }; } // 움직이는 GIF 보존
    const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
    const width = Math.round(w0 * scale);
    const height = Math.round(h0 * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bmp, 0, 0, width, height);
    bmp.close();
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((ok) => canvas.toBlob(ok, type, 0.88));
    return { blob, width, height };
  }

  const toLocalInput = (ts) => {
    const d = new Date(ts * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // ---------------------------------------------------------------- GitHub 연결 (토큰 넣기)
  function setup(root, ctx) {
    const { B, esc } = ctx;
    const repo = siteRepo(B) || { owner: '', name: '', branch: 'main' };
    root.innerHTML = `
      <header class="page-head">
        <h1>글쓰기 — GitHub 연결</h1>
        <p>새 글은 GitHub 저장소의 posts/ 폴더에 저장되고, 사이트는 GitHub Actions 가 1~2분 안에 다시 만듭니다.</p>
      </header>
      <form class="editor gh-setup" novalidate>
        <div class="field-row">
          <label class="field grow"><span>저장소 <small>계정/저장소</small></span><input name="repo" value="${esc(repo.owner && `${repo.owner}/${repo.name}`)}" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span>브랜치</span><input name="branch" value="${esc(repo.branch)}" autocomplete="off" spellcheck="false"></label>
        </div>
        <label class="field"><span>토큰</span><input name="token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
        <p class="ed-status" role="status" aria-live="polite"></p>
        <div class="ed-actions"><button type="submit" class="btn primary">연결</button><a class="btn" href="#/">취소</a></div>
        <div class="ed-help">
          <p><strong>토큰 만드는 법</strong> (이 브라우저에서 한 번만)</p>
          <ol>
            <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub 의 새 fine-grained 토큰 화면</a>을 엽니다.</li>
            <li>Repository access 에서 <b>Only select repositories</b> 를 누르고 이 저장소 하나만 고릅니다.</li>
            <li>Permissions 의 Repository permissions 에서 <b>Contents</b> 를 <b>Read and write</b> 로 바꿉니다. 다른 권한은 그대로 둡니다.</li>
            <li>만든 토큰(github_pat_…)을 위 칸에 붙여 넣고 [연결]을 누릅니다.</li>
          </ol>
          <p>토큰은 이 브라우저에만 저장되고 GitHub 말고 다른 곳으로 보내지 않습니다. 남이 쓰는 컴퓨터라면 다 쓴 뒤 글쓰기 화면의 「연결 끊기」를 누르세요.</p>
        </div>
      </form>`;
    const form = root.querySelector('form');
    const f = form.elements;
    const statusEl = root.querySelector('.ed-status');
    const say = (msg, kind = '') => { statusEl.textContent = msg; statusEl.dataset.kind = kind; };
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const m = f.repo.value.trim().match(/^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/);
      if (!m) { say('저장소를 "계정/저장소" 꼴로 적어 주세요.', 'error'); f.repo.focus(); return; }
      const token = f.token.value.trim();
      if (!token) { say('토큰을 붙여 넣어 주세요.', 'error'); f.token.focus(); return; }
      const cfg = { owner: m[1], name: m[2], branch: f.branch.value.trim() || 'main', token };
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      say('GitHub 에 확인하는 중…', 'info');
      try {
        const login = await githubBackend(cfg, B).check();
        store.set(GH_KEY, { ...cfg, login });
        try { sessionStorage.setItem('texcube:flash', `GitHub ${login} 계정으로 연결했습니다.`); } catch { /* 무시 */ }
        location.reload(); // 메뉴에 「글쓰기」를 넣으려고
      } catch (err) {
        say(err.message, 'error');
        btn.disabled = false;
      }
    });
    (repo.owner ? f.token : f.repo).focus();
  }

  // ---------------------------------------------------------------- 글쓰기
  async function mount(root, ctx, id) {
    const { B, esc, catLabel, ymdhm } = ctx;
    if (ctx.mode === 'github' && !store.get(GH_KEY)?.token) { setup(root, ctx); return; }
    const backend = ctx.mode === 'local' ? localBackend() : githubBackend(store.get(GH_KEY), B);
    const github = backend.kind === 'github';
    const editing = Boolean(id);
    root.innerHTML = '<p class="empty">글쓰기 화면을 준비하는 중…</p>';

    let meLine;
    let post = null;
    let mine = [];
    try {
      if (github) await pics.load();
      [meLine, post, mine] = await Promise.all([backend.me(), editing ? backend.get(id) : null, backend.list()]);
      mine.sort((a, b) => b.published - a.published);
    } catch (err) {
      root.innerHTML = `<header class="page-head"><h1>글쓰기</h1></header><p class="empty">${esc(err.message)}</p>
        ${github ? '<p><button type="button" class="linkish" data-act="disconnect">GitHub 연결 끊기</button></p>' : ''}`;
      root.querySelector('[data-act=disconnect]')?.addEventListener('click', () => { store.del(GH_KEY); location.reload(); });
      return;
    }

    const counts = new Map();
    ctx.entries.forEach((e) => counts.set(e.category, (counts.get(e.category) || 0) + 1));
    const defaultCat = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? B.categories[0]?.id;
    const locs = [...new Set(ctx.entries.map((e) => e.location).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    const tagCount = new Map();
    ctx.entries.forEach((e) => e.tags.forEach((t) => tagCount.set(t, (tagCount.get(t) || 0) + 1)));
    const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t]) => t);

    root.innerHTML = `
      <header class="page-head">
        <h1>${editing ? '글 고치기' : '새 글 쓰기'}</h1>
        <p>${esc(meLine)}${github ? ' · <button type="button" class="linkish" data-act="disconnect">연결 끊기</button>' : ''}</p>
      </header>
      <form class="editor" novalidate>
        <label class="field"><span>제목</span><input name="title" maxlength="255" autocomplete="off" required></label>
        <div class="field-row">
          <label class="field"><span>분류</span><select name="category">
            ${B.categories.map((c) => `<option value="${c.id}">${esc(catLabel(c))}</option>`).join('')}
          </select></label>
          <label class="field"><span>공개</span><select name="visibility">
            <option value="public">공개</option><option value="private">${esc(backend.hiddenOption)}</option>
          </select></label>
          <label class="field"><span>발행 시각</span><input type="datetime-local" name="published"></label>
        </div>
        <div class="field-row">
          <label class="field grow"><span>지역</span><input name="location" list="ed-locs" placeholder="/대한민국/서울" autocomplete="off"></label>
          <label class="field grow"><span>태그 <small>쉼표로 구분</small></span><input name="tags" placeholder="나노카, 에버랜드" autocomplete="off"></label>
        </div>
        <p class="ed-chips" aria-label="자주 쓴 태그">${topTags.map((t) => `<button type="button" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</p>
        <datalist id="ed-locs">${locs.map((l) => `<option value="${esc(l)}">`).join('')}</datalist>

        <div class="ed-bar">
          <div class="ed-tools">
            <button type="button" data-act="image">사진 넣기</button>
            <button type="button" data-act="bold"><b>굵게</b></button>
            <button type="button" data-act="link">링크</button>
            <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden>
          </div>
          <div class="ed-tabs" role="tablist">
            <button type="button" role="tab" data-tab="write" aria-selected="true">쓰기</button>
            <button type="button" role="tab" data-tab="preview" aria-selected="false">미리보기</button>
          </div>
        </div>
        <textarea name="content" rows="18" placeholder="줄바꿈은 그대로 줄바꿈이 됩니다. HTML 태그도 쓸 수 있습니다."></textarea>
        <div class="ed-preview content" hidden></div>
        <p class="ed-help">사진은 [사진 넣기]로 고르거나, 본문 칸에 끌어다 놓거나 붙여 넣으면 들어갑니다. 긴 변 ${MAX_SIDE}px 로 줄여서 올리고, 위치 정보는 지웁니다.${github ? ' 사진은 글을 저장할 때 함께 저장소에 올라갑니다.' : ''}</p>

        <p class="ed-status" role="status" aria-live="polite"></p>
        <div class="ed-actions">
          <button type="submit" class="btn primary">저장</button>
          <a class="btn" href="${editing ? `#/entry/${id}` : '#/'}">취소</a>
          ${editing ? '<button type="button" class="btn danger" data-act="delete">지우기</button>' : ''}
        </div>
      </form>
      <section class="ed-mine">
        <h2>새로 쓴 글 <span class="muted">${mine.length}</span></h2>
        ${mine.length ? `<ul>${mine.map((p) => `
          <li><a href="#/write/${p.id}">${p.visibility === 'private' ? `<span class="badge">${esc(backend.hiddenLabel)}</span>` : ''}${esc(p.title)}</a><time>${ymdhm(p.published)}</time></li>`).join('')}</ul>`
          : '<p class="empty">아직 없습니다.</p>'}
      </section>`;

    const form = root.querySelector('form');
    const f = form.elements;
    const ta = f.content;
    const preview = root.querySelector('.ed-preview');
    const statusEl = root.querySelector('.ed-status');
    const fileInput = root.querySelector('input[type=file]');
    const say = (msg, kind = '') => { statusEl.textContent = msg; statusEl.dataset.kind = kind; };
    let publishedTouched = editing;

    root.querySelector('[data-act=disconnect]')?.addEventListener('click', () => {
      if (!confirm('이 브라우저에서 GitHub 토큰을 지울까요? 다시 쓰려면 토큰을 새로 넣어야 합니다.')) return;
      store.del(GH_KEY);
      location.hash = '#/';
      location.reload();
    });

    const fill = (p) => {
      f.title.value = p.title || '';
      f.category.value = String(p.category ?? defaultCat);
      f.visibility.value = p.visibility || 'public';
      f.location.value = p.location || '';
      f.tags.value = (p.tags || []).join(', ');
      ta.value = p.content || '';
      if (p.published) f.published.value = toLocalInput(p.published);
    };
    const read = () => ({
      title: f.title.value,
      category: Number(f.category.value),
      visibility: f.visibility.value,
      location: f.location.value,
      tags: f.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
      content: ta.value,
      published: publishedTouched && f.published.value ? Math.floor(new Date(f.published.value).getTime() / 1000) : null,
    });

    fill(post || { category: defaultCat, published: nowSec() });
    const original = JSON.stringify(read());

    // 임시 저장 불러오기
    const draft = store.get(DRAFT_KEY(id));
    if (draft && JSON.stringify(draft) !== original) {
      fill({ ...draft, published: draft.published || post?.published || nowSec() });
      if (draft.published) publishedTouched = true;
      say('이 브라우저에 임시 저장해 둔 내용을 불러왔습니다.', 'info');
      const discard = document.createElement('button');
      discard.type = 'button';
      discard.className = 'linkish';
      discard.textContent = '버리고 처음 내용으로';
      discard.addEventListener('click', () => {
        store.del(DRAFT_KEY(id));
        pics.drop(pics.ofDraft(DRAFT_KEY(id)));
        dirty = false;
        fill(post || { category: defaultCat, published: nowSec() });
        say('');
      });
      statusEl.append(' ', discard);
    }

    // 저장 뒤 다시 열었을 때 남긴 말
    try {
      const flash = sessionStorage.getItem('texcube:flash');
      if (flash) { say(flash, 'ok'); sessionStorage.removeItem('texcube:flash'); }
    } catch { /* 무시 */ }

    let dirty = false;
    let saveTimer = 0;
    form.addEventListener('input', (ev) => {
      if (ev.target === f.published) publishedTouched = true;
      dirty = JSON.stringify(read()) !== original;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => (dirty ? store.set(DRAFT_KEY(id), read()) : store.del(DRAFT_KEY(id))), 400);
    });
    window.addEventListener('beforeunload', (ev) => {
      if (dirty && document.body.contains(form)) { ev.preventDefault(); ev.returnValue = ''; }
    });

    // 본문 칸 다루기
    const insert = (text) => {
      ta.focus();
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const wrap = (before, after, fallback = '') => {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || fallback;
      insert(before + sel + after);
    };

    const addImages = async (files) => {
      const list = [...files].filter((x) => /^image\/(jpeg|png|gif|webp)$/.test(x.type));
      if (!list.length) { say('JPEG·PNG·GIF·WebP 사진만 넣을 수 있습니다.', 'error'); return; }
      for (const [i, file] of list.entries()) {
        say(`사진 ${github ? '줄이는' : '올리는'} 중… ${i + 1}/${list.length}`, 'info');
        try {
          const { blob, width, height } = await shrink(file);
          if (blob.size > MAX_IMAGE) throw new Error('사진 하나는 15MB 까지 올릴 수 있습니다.');
          const name = await backend.addImage(blob, DRAFT_KEY(id));
          const w = Math.min(SHOW_WIDTH, width);
          const h = Math.round((height * w) / width);
          insert(`[##_1C|${name}|width="${w}" height="${h}" alt=""|_##]\n`);
        } catch (err) {
          say(`「${file.name}」을 넣지 못했습니다: ${err.message}`, 'error');
          return;
        }
      }
      say(`사진 ${list.length}장을 넣었습니다.`, 'ok');
    };

    root.querySelector('.ed-tools').addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-act]')?.dataset.act;
      if (act === 'image') fileInput.click();
      if (act === 'bold') wrap('<b>', '</b>', '굵은 글씨');
      if (act === 'link') {
        const url = prompt('연결할 주소', 'https://');
        if (url && /^https?:\/\/\S+$/.test(url)) wrap(`<a href="${url.replace(/"/g, '&quot;')}">`, '</a>', url);
      }
    });
    fileInput.addEventListener('change', () => { if (fileInput.files.length) addImages(fileInput.files); fileInput.value = ''; });
    ta.addEventListener('paste', (ev) => {
      const files = [...(ev.clipboardData?.files || [])];
      if (files.length) { ev.preventDefault(); addImages(files); }
    });
    ta.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('Files')) { ev.preventDefault(); ta.classList.add('drop'); } });
    ta.addEventListener('dragleave', () => ta.classList.remove('drop'));
    ta.addEventListener('drop', (ev) => {
      ta.classList.remove('drop');
      if (ev.dataTransfer?.files.length) { ev.preventDefault(); addImages(ev.dataTransfer.files); }
    });

    root.querySelector('[data-tag]') && root.querySelector('.ed-chips').addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-tag]')?.dataset.tag;
      if (!t) return;
      const cur = f.tags.value.split(',').map((x) => x.trim()).filter(Boolean);
      if (!cur.includes(t)) cur.push(t);
      f.tags.value = cur.join(', ');
      form.dispatchEvent(new Event('input'));
    });

    // 쓰기 / 미리보기 — 사이트를 만들 때와 같은 변환(render.js)
    root.querySelector('.ed-tabs').addEventListener('click', (ev) => {
      const tab = ev.target.closest('[data-tab]')?.dataset.tab;
      if (!tab) return;
      root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
      const show = tab === 'preview';
      ta.hidden = show;
      preview.hidden = !show;
      if (!show) return;
      preview.innerHTML = window.TexcubeRender.render(ta.value) || '<p class="empty">본문이 비어 있습니다.</p>';
      preview.querySelectorAll('img[src^="attach/1/"]').forEach((img) => {
        const name = img.getAttribute('src').slice('attach/1/'.length);
        const local = pics.url(name);
        if (local) img.src = local; // 아직 저장하지 않은 사진
        else if (backend.loadImage) { // 저장한 사진: 비공개 글이거나 아직 빌드 전이면 사이트에 없다
          img.removeAttribute('src'); // 받는 동안 사이트 주소를 먼저 시도하다 「사진을 불러오지 못함」으로 바뀌지 않게
          backend.loadImage(name).then((u) => { img.src = u; }, () => { img.src = `attach/1/${name}`; });
        }
      });
    });

    const leave = (hash, msg) => {
      dirty = false;
      store.del(DRAFT_KEY(id));
      try { if (msg) sessionStorage.setItem('texcube:flash', msg); } catch { /* 무시 */ }
      location.hash = hash;
      location.reload(); // 새로 만든 data.js 를 읽는다
    };

    const waitScreen = async (res, title) => {
      dirty = false;
      store.del(DRAFT_KEY(id));
      root.innerHTML = `
        <header class="page-head"><h1>저장했습니다</h1><p>${esc(title)}</p></header>
        <div class="notice-box">
          <p class="ed-wait" role="status">GitHub 가 사이트를 다시 만드는 중입니다 · <span>0초</span></p>
          <p>보통 1~2분 걸립니다. 다 되면 이 화면이 저절로 글로 넘어갑니다. 이 창을 닫아도 글은 저장소에 남아 있습니다.</p>
          <p><a href="${esc(backend.actionsUrl)}" target="_blank" rel="noopener">GitHub 에서 진행 상황 보기</a></p>
        </div>`;
      const tick = root.querySelector('.ed-wait span');
      const ok = await backend.waitForSite(res.commit, (s) => { tick.textContent = s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`; });
      if (ok) { leave(`#/entry/${res.id}`); return; }
      root.querySelector('.ed-wait').textContent = `${WAIT_LIMIT / 60000}분이 지나도 사이트가 바뀌지 않았습니다.`;
      root.querySelector('.ed-wait + p').textContent = '글은 저장소에 저장되어 있습니다. GitHub 의 Actions 화면에서 사이트 만들기가 실패했는지 확인해 주세요.';
    };

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      let data;
      try {
        data = clean(read(), B.categories);
      } catch (err) {
        say(err.message, 'error');
        (/제목/.test(err.message) ? f.title : /본문/.test(err.message) ? ta : f.category).focus();
        return;
      }
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      say(github ? 'GitHub 에 저장하는 중…' : '저장하는 중…', 'info');
      try {
        const res = await backend.save(id, data);
        if (github) await pics.drop([...(res.images || []), ...pics.ofDraft(DRAFT_KEY(id))]);
        const hidden = data.visibility === 'private' && !B.meta.includePrivate;
        if (hidden) {
          leave(`#/write/${res.id}`, github
            ? '저장했습니다. 사이트에 숨긴 글이라 저장소에만 있습니다.'
            : '저장했습니다. 비공개 글이라 site/ 사본에는 나오지 않습니다.');
        } else if (github) {
          await waitScreen(res, data.title);
        } else {
          leave(`#/entry/${res.id}`);
        }
      } catch (err) {
        say(err.message, 'error');
        btn.disabled = false;
      }
    });

    root.querySelector('[data-act=delete]')?.addEventListener('click', async () => {
      const where = github ? '저장소의 posts/deleted/' : 'posts/deleted/';
      if (!confirm(`「${f.title.value}」을 지울까요? (${where} 로 옮겨 두므로 되살릴 수 있습니다)`)) return;
      say('지우는 중…', 'info');
      try {
        await backend.remove(id);
        leave('#/write', github ? '글을 지웠습니다. 사이트에서 사라지기까지 1~2분 걸립니다.' : '글을 지웠습니다.');
      } catch (err) {
        say(err.message, 'error');
      }
    });

    if (!editing && !draft) f.title.focus();
  }

  window.TexcubeEditor = { probe, mount };
})();
