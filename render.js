// 본문 변환. tools/build.py 의 render() 를 그대로 옮긴 것으로, 글쓰기 화면의 미리보기가 쓴다.
// build.py 를 고치면 여기도 같이 고친다. (두 결과가 같은지는 옛 글 177개로 맞춰 봄)
(() => {
  'use strict';

  // Python html.escape(s, quote=True) 와 같게
  const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

  const imgAttrs = (prop) => {
    prop = prop.replace(/&quot;/g, '"');
    const out = [];
    for (const k of ['width', 'height', 'alt', 'title']) {
      const m = prop.match(new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`)) || prop.match(new RegExp(`\\b${k}\\s*=\\s*([^\\s"]+)`));
      if (m) out.push(`${k}="${escAttr(m[1])}"`);
    }
    return out.join(' ');
  };

  const img = (name, prop) => `<img src="attach/1/${escAttr(name)}" ${imgAttrs(prop)} loading="lazy">`;

  function bindAttachments(content) {
    content = content.split('[##_ATTACH_PATH_##]').join('attach/1');
    return content.replace(/\[##_([\s\S]+?)_##\]/g, (whole, inner) => {
      const a = inner.split('|');
      const kind = a[0];
      if (['Gallery', 'iMazing', 'Jukebox'].includes(kind)) {
        const files = a.slice(1).filter((x) => /\.(jpe?g|gif|png)$/i.test(x));
        return '<div class="imageblock gallery">' + files.map((f) => img(f, '')).join('') + '</div>';
      }
      if (a.length === 4) {
        const pos = { '1L': 'left', '1R': 'right' }[kind] || 'center';
        const cap = a[3].trim() ? `<p class="cap">${a[3]}</p>` : '';
        return `<div class="imageblock ${pos}">${img(a[1], a[2])}${cap}</div>`;
      }
      if (a.length === 7 || a.length === 10) {
        let cells = '';
        for (let i = 1; i < a.length; i += 3) {
          cells += `<div class="cell">${img(a[i], a[i + 1])}` + (a[i + 2].trim() ? `<p class="cap">${a[i + 2]}</p>` : '') + '</div>';
        }
        return `<div class="imageblock multi">${cells}</div>`;
      }
      return whole;
    });
  }

  function bindMoreless(content) {
    return content.replace(/\[#M_([\s\S]+?)_M#\]/g, (_, inner) => {
      // Python 의 split('|', 2): 앞의 두 칸만 자르고 나머지는 그대로
      const i = inner.indexOf('|');
      const j = i < 0 ? -1 : inner.indexOf('|', i + 1);
      const more = i < 0 ? inner : inner.slice(0, i);
      const full = j < 0 ? '' : inner.slice(j + 1);
      return `<details class="moreless"><summary>${more || '더보기'}</summary>${full}</details>`;
    });
  }

  function nl2brWithHtml(s) {
    s = s.split('[CODE]').join('[CODE][HTML]').split('[/CODE]').join('[/HTML][/CODE]');
    const nl2br = (t) => t.replace(/(\r\n|\n\r|\n|\r)/g, '<br />$1');
    const out = [];
    let inHtml = false;
    for (;;) {
      if (inHtml) {
        const end = s.indexOf('[/HTML]');
        if (end < 0) break; // 원본도 닫히지 않은 [HTML] 뒤는 버린다
        out.push(s.slice(0, end));
        s = s.slice(end + 7);
        inHtml = false;
      } else {
        const off = s.indexOf('[HTML]');
        if (off < 0) { out.push(nl2br(s)); break; }
        out.push(nl2br(s.slice(0, off)));
        s = s.slice(off + 6);
        inHtml = true;
      }
    }
    return out.join('').split('[CODE]').join('').split('[/CODE]').join('');
  }

  const TABLE_GAP = /(<(?:table|tbody|thead|tfoot|tr)\b[^>]*>|<\/(?:td|th|tr|tbody|thead|tfoot|caption)>)((?:\s|<br \/>)+)(?=<(?:\/?(?:tbody|thead|tfoot|tr|td|th)|\/table)\b)/gi;

  function tidy(view) {
    view = view.replace(TABLE_GAP, (_, tag, gap) => tag + gap.split('<br />').join(''));
    view = view.replace(/https?:\/\/(?:www\.)?smgal\.net\/tatools\/attach\/(1|user)\//g, 'attach/$1/');
    const yt = (m) => {
      const vid = m.match(/youtube\.com\/v\/([\w-]{6,})/);
      if (!vid) return m;
      return `<div class="video"><iframe src="https://www.youtube.com/embed/${vid[1]}" `
        + 'title="YouTube" loading="lazy" allowfullscreen></iframe></div>';
    };
    view = view.replace(/<object\b[\s\S]*?<\/object>/gi, yt);
    view = view.replace(/<embed\b[^>]*youtube\.com[^>]*>(?:<\/embed>)?/gi, yt);
    view = view.replace(/<img\b(?![^>]*\bloading=)/gi, '<img loading="lazy"');
    view = view.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    view = view.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
    return view;
  }

  const render = (content) => tidy(nl2brWithHtml(bindMoreless(bindAttachments(String(content ?? '')))));

  window.TexcubeRender = { render };
})();
