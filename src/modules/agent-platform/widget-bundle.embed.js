/* CostKatana embedded chat widget — served at GET /api/public/widget/bundle.js
 *
 * Self-contained vanilla JS. No bundler, no React. Loaded directly into the
 * customer's site via:
 *   <script src="https://api.costkatana.com/api/public/widget/bundle.js"
 *           data-deployment-id="dep_xxxxxxxx" defer></script>
 *
 * Edit this file and `npm run build` — nest-cli copies it to dist/ via the
 * `assets` rule and the controller reads it at module init.
 */
(function () {
  'use strict';
  var SCRIPT = document.currentScript || (function () {
    var all = document.querySelectorAll('script[data-deployment-id]');
    return all[all.length - 1];
  })();
  var DEPLOY = SCRIPT ? SCRIPT.getAttribute('data-deployment-id') : null;
  var BASE = (SCRIPT ? (SCRIPT.getAttribute('data-api-url') || '') : '').replace(/\/$/, '');
  if (!BASE && SCRIPT && SCRIPT.src) {
    try { BASE = new URL(SCRIPT.src).origin; } catch (e) {}
  }
  if (!DEPLOY || DEPLOY === '<deployment-id>') {
    console.warn('[CostKatana] Widget: missing data-deployment-id');
    return;
  }

  var S = {
    token: null,
    open: false,
    busy: false,
    win: 'normal',
    theme: { primary: '#06ec9e', surface: '#ffffff', position: 'bottom-right' },
    welcome: 'Hi — how can I help today?',
  };
  var E = {};
  var SVG = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'on') {
          Object.keys(attrs[k]).forEach(function (ev) {
            e.addEventListener(ev, attrs[k][ev]);
          });
        } else {
          e.setAttribute(k, attrs[k]);
        }
      });
    }
    if (kids) {
      [].concat(kids).forEach(function (c) {
        if (c == null) return;
        e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return e;
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVG, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function makeSvg(size, children) {
    var s = svgEl('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', 'stroke-width': '2',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    children.forEach(function (c) { s.appendChild(c); });
    return s;
  }

  function iconChat() {
    return makeSvg(22, [
      svgEl('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }),
    ]);
  }
  function iconSend() {
    return makeSvg(16, [
      svgEl('line', { x1: '22', y1: '2', x2: '11', y2: '13' }),
      svgEl('polygon', { points: '22 2 15 22 11 13 2 9 22 2' }),
    ]);
  }
  function iconClose() {
    return makeSvg(18, [
      svgEl('line', { x1: '18', y1: '6', x2: '6', y2: '18' }),
      svgEl('line', { x1: '6', y1: '6', x2: '18', y2: '18' }),
    ]);
  }
  function iconMinimize() {
    return makeSvg(18, [svgEl('line', { x1: '5', y1: '12', x2: '19', y2: '12' })]);
  }
  function iconExpand() {
    return makeSvg(18, [
      svgEl('polyline', { points: '15 3 21 3 21 9' }),
      svgEl('polyline', { points: '9 21 3 21 3 15' }),
      svgEl('line', { x1: '21', y1: '3', x2: '14', y2: '10' }),
      svgEl('line', { x1: '3', y1: '21', x2: '10', y2: '14' }),
    ]);
  }
  function iconRestore() {
    return makeSvg(18, [
      svgEl('polyline', { points: '4 14 10 14 10 20' }),
      svgEl('polyline', { points: '20 10 14 10 14 4' }),
      svgEl('line', { x1: '14', y1: '10', x2: '21', y2: '3' }),
      svgEl('line', { x1: '3', y1: '21', x2: '10', y2: '14' }),
    ]);
  }

  // ── Markdown → DOM nodes ─────────────────────────────────────────────
  // Build DOM nodes directly via createElement / createTextNode. No
  // innerHTML, no string concatenation of HTML, no escape concerns —
  // user-provided strings only ever land in text nodes or attribute
  // values that get sanitized below.
  //
  // Supported (chat-relevant) syntax:
  //   **bold**        _italic_ / *italic*    `code`
  //   [label](url)    headings (# ## ###)
  //   - bullet  * bullet  1. ordered  1) ordered
  //   blank line → paragraph break

  var INLINE_PATTERNS = [
    // [label](url)
    { re: /\[([^\]]+)\]\(([^)\s]+)\)/, build: function (m) {
        var href = m[2];
        if (!/^(https?:|mailto:)/i.test(href)) return document.createTextNode(m[0]);
        return el('a', { href: href, target: '_blank', rel: 'noopener noreferrer' }, [m[1]]);
      } },
    // **bold**
    { re: /\*\*([^*\n]+)\*\*/, build: function (m) { return el('strong', null, [m[1]]); } },
    // `code`
    { re: /`([^`\n]+)`/, build: function (m) { return el('code', null, [m[1]]); } },
    // *italic*
    { re: /\*([^*\n]+)\*/, build: function (m) { return el('em', null, [m[1]]); } },
    // _italic_
    { re: /_([^_\n]+)_/, build: function (m) { return el('em', null, [m[1]]); } },
  ];

  // Tokenize a single line into an array of DOM nodes (text + inline elements).
  function inlineNodes(line) {
    var nodes = [];
    var rest = line;
    while (rest.length > 0) {
      var earliest = -1;
      var hit = null;
      for (var i = 0; i < INLINE_PATTERNS.length; i++) {
        var m = rest.match(INLINE_PATTERNS[i].re);
        if (m && (earliest === -1 || m.index < earliest)) {
          earliest = m.index;
          hit = { match: m, build: INLINE_PATTERNS[i].build };
        }
      }
      if (!hit) {
        nodes.push(document.createTextNode(rest));
        break;
      }
      if (earliest > 0) nodes.push(document.createTextNode(rest.slice(0, earliest)));
      nodes.push(hit.build(hit.match));
      rest = rest.slice(earliest + hit.match[0].length);
    }
    return nodes;
  }

  // Parse markdown into a DocumentFragment of structural nodes.
  function mdFragment(text) {
    var frag = document.createDocumentFragment();
    var lines = String(text).split(/\r?\n/);
    var i = 0;

    while (i < lines.length) {
      var line = lines[i].replace(/\s+$/, '');

      // Skip blank lines (paragraph separators).
      if (!line.trim()) { i++; continue; }

      // Heading: # / ## / ###  → h4/h5/h6 (small visual scale inside chat bubble).
      var heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        frag.appendChild(el('h' + (heading[1].length + 3), null, inlineNodes(heading[2])));
        i++;
        continue;
      }

      // Bulleted list: gather all consecutive bullet lines into one <ul>.
      if (/^[\s]*[\-\*]\s+/.test(line)) {
        var ul = el('ul');
        while (i < lines.length) {
          var b = lines[i].replace(/\s+$/, '').match(/^[\s]*[\-\*]\s+(.*)$/);
          if (!b) break;
          ul.appendChild(el('li', null, inlineNodes(b[1])));
          i++;
        }
        frag.appendChild(ul);
        continue;
      }

      // Ordered list: gather consecutive `1. foo` / `1) foo` lines.
      if (/^[\s]*\d+[\.\)]\s+/.test(line)) {
        var ol = el('ol');
        while (i < lines.length) {
          var o = lines[i].replace(/\s+$/, '').match(/^[\s]*\d+[\.\)]\s+(.*)$/);
          if (!o) break;
          ol.appendChild(el('li', null, inlineNodes(o[1])));
          i++;
        }
        frag.appendChild(ol);
        continue;
      }

      // Paragraph: gather consecutive non-blank, non-special lines.
      var paraLines = [];
      while (i < lines.length) {
        var pl = lines[i].replace(/\s+$/, '');
        if (!pl.trim()) break;
        if (pl.match(/^(#{1,3})\s+/)) break;
        if (/^[\s]*[\-\*]\s+/.test(pl)) break;
        if (/^[\s]*\d+[\.\)]\s+/.test(pl)) break;
        paraLines.push(pl);
        i++;
      }
      var p = el('p');
      var children = inlineNodes(paraLines.join(' '));
      children.forEach(function (c) { p.appendChild(c); });
      frag.appendChild(p);
    }

    return frag;
  }

  // ── Session bootstrap ────────────────────────────────────────────────
  function initSession() {
    fetch(BASE + '/api/public/widget/' + DEPLOY + '/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        S.token = d.sessionToken;
        if (d.theme) S.theme = Object.assign({}, S.theme, d.theme);
        if (d.welcomeMessage) S.welcome = d.welcomeMessage;
        mount();
      })
      .catch(function (e) { console.error('[CostKatana] Widget init:', e); });
  }

  function mount() {
    var p = S.theme.primary;
    var surf = S.theme.surface;
    var left = S.theme.position === 'bottom-left';
    var side = left ? 'left:20px' : 'right:20px';
    var orig = left ? 'bottom left' : 'bottom right';

    var css = [
      '#ck-b,#ck-p{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-sizing:border-box}',
      '#ck-b *,#ck-p *{box-sizing:border-box}',
      '#ck-b{position:fixed;bottom:20px;' + side + ';z-index:2147483646;width:54px;height:54px;border-radius:50%;',
        'background:' + p + ';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;',
        'box-shadow:0 4px 20px rgba(0,0,0,.22);transition:transform .15s;color:#0f172a}',
      '#ck-b:hover{transform:scale(1.08)}',

      '#ck-p{position:fixed;bottom:86px;' + side + ';width:340px;max-width:calc(100vw - 24px);height:480px;',
        'max-height:calc(100vh - 106px);display:flex;flex-direction:column;border-radius:16px;overflow:hidden;',
        'box-shadow:0 10px 44px rgba(0,0,0,.18);z-index:2147483645;background:' + surf + ';',
        'transition:opacity .18s,transform .18s,width .22s,height .22s,bottom .22s,right .22s,left .22s,top .22s,border-radius .22s;',
        'transform-origin:' + orig + '}',
      '#ck-p.ck-off{opacity:0;transform:scale(.94) translateY(8px);pointer-events:none}',

      '#ck-p.ck-exp{left:16px !important;right:16px !important;top:16px !important;bottom:16px !important;',
        'width:auto;max-width:none;height:auto;max-height:none;border-radius:12px}',
      '#ck-p.ck-min{height:56px !important;max-height:56px !important;width:300px !important;border-radius:12px}',
      '#ck-p.ck-min #ck-msgs,#ck-p.ck-min #ck-row{display:none}',
      '#ck-p.ck-min #ck-hd{cursor:pointer}',

      '#ck-hd{background:linear-gradient(135deg,' + p + '28,' + p + '08);border-bottom:1px solid rgba(0,0,0,.07);',
        'padding:12px 16px;display:flex;align-items:center;gap:8px;flex-shrink:0}',
      '#ck-hd .d{width:8px;height:8px;border-radius:50%;background:' + p + ';box-shadow:0 0 8px ' + p + ';flex-shrink:0}',
      '#ck-hd .t{font-size:13px;font-weight:600;flex:1;color:#0f172a;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#ck-hd .hb{background:none;border:none;cursor:pointer;color:#94a3b8;padding:4px;display:flex;line-height:1;border-radius:4px;flex-shrink:0;transition:color .12s,background .12s}',
      '#ck-hd .hb:hover{color:#475569;background:rgba(0,0,0,.05)}',

      '#ck-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:0}',
      '.ck-m{max-width:84%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.55;word-wrap:break-word;overflow-wrap:break-word}',
      '.ck-m.usr{background:' + p + ';color:#0f172a;align-self:flex-end;border-bottom-right-radius:3px;font-weight:500;white-space:pre-wrap}',
      '.ck-m.bot{background:#f1f5f9;color:#1e293b;align-self:flex-start;border-bottom-left-radius:3px}',

      '.ck-m.bot p{margin:0 0 6px 0}',
      '.ck-m.bot p:last-child{margin-bottom:0}',
      '.ck-m.bot ul,.ck-m.bot ol{margin:0 0 6px 0;padding-left:20px}',
      '.ck-m.bot ul:last-child,.ck-m.bot ol:last-child{margin-bottom:0}',
      '.ck-m.bot li{margin:2px 0}',
      '.ck-m.bot strong{font-weight:600}',
      '.ck-m.bot em{font-style:italic}',
      '.ck-m.bot code{background:rgba(15,23,42,.08);padding:1px 5px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}',
      '.ck-m.bot a{color:' + p + ';text-decoration:underline;text-underline-offset:2px}',
      '.ck-m.bot a:hover{text-decoration:none}',
      '.ck-m.bot h4,.ck-m.bot h5,.ck-m.bot h6{margin:6px 0 4px 0;font-weight:600;line-height:1.3}',
      '.ck-m.bot h4{font-size:14px}',
      '.ck-m.bot h5{font-size:13px}',
      '.ck-m.bot h6{font-size:13px;color:#475569}',
      '.ck-m.bot h4:first-child,.ck-m.bot h5:first-child,.ck-m.bot h6:first-child{margin-top:0}',

      '.ck-typ{display:inline-flex;align-items:center;gap:4px;padding:2px 0}',
      '.ck-typ .ck-d{width:6px;height:6px;border-radius:50%;background:#94a3b8;display:inline-block;animation:ck-bounce 1.2s infinite ease-in-out}',
      '.ck-typ .ck-d:nth-child(2){animation-delay:.16s}',
      '.ck-typ .ck-d:nth-child(3){animation-delay:.32s}',
      '@keyframes ck-bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}',

      '#ck-row{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;border-top:1px solid rgba(0,0,0,.07);flex-shrink:0}',
      '#ck-inp{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:13px;',
        'outline:none;background:#f8fafc;color:#0f172a;resize:none;min-height:38px;max-height:100px;font-family:inherit}',
      '#ck-inp:focus{border-color:' + p + ';background:#fff}',
      '#ck-snd{width:36px;height:36px;border-radius:8px;background:' + p + ';border:none;cursor:pointer;',
        'display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#0f172a;transition:opacity .15s}',
      '#ck-snd:disabled{opacity:.45;cursor:not-allowed}',
    ].join('');

    var styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    E.msgs = el('div', { id: 'ck-msgs' });
    E.inp = el('textarea', {
      id: 'ck-inp', placeholder: 'Type a message…', rows: '1',
      on: {
        keydown: function (ev) {
          if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); }
        },
        input: function () {
          this.style.height = 'auto';
          this.style.height = Math.min(this.scrollHeight, 100) + 'px';
        },
      },
    });
    E.snd = el('button', { id: 'ck-snd', 'aria-label': 'Send', on: { click: send } }, [iconSend()]);

    E.btnMin = el('button', {
      class: 'hb', 'aria-label': 'Minimize chat', title: 'Minimize',
      on: { click: function (ev) { ev.stopPropagation(); setWindowState('minimized'); } },
    }, [iconMinimize()]);
    E.btnExp = el('button', {
      class: 'hb', 'aria-label': 'Expand chat to full screen', title: 'Expand',
      on: {
        click: function (ev) {
          ev.stopPropagation();
          setWindowState(S.win === 'expanded' ? 'normal' : 'expanded');
        },
      },
    }, [iconExpand()]);
    E.btnClose = el('button', {
      class: 'hb', 'aria-label': 'Close chat', title: 'Close',
      on: { click: function (ev) { ev.stopPropagation(); toggle(); } },
    }, [iconClose()]);

    E.header = el('div', {
      id: 'ck-hd',
      on: {
        click: function () {
          if (S.win === 'minimized') setWindowState('normal');
        },
      },
    }, [
      el('span', { class: 'd' }),
      el('span', { class: 't' }, 'Chat'),
      E.btnMin,
      E.btnExp,
      E.btnClose,
    ]);

    E.panel = el('div', { id: 'ck-p', class: 'ck-off' }, [
      E.header,
      E.msgs,
      el('div', { id: 'ck-row' }, [E.inp, E.snd]),
    ]);

    E.bubble = el('button', { id: 'ck-b', 'aria-label': 'Open chat', on: { click: toggle } }, [iconChat()]);

    document.body.appendChild(E.panel);
    document.body.appendChild(E.bubble);
    addBotMsg(S.welcome);
  }

  function setWindowState(next) {
    S.win = next;
    E.panel.classList.toggle('ck-exp', next === 'expanded');
    E.panel.classList.toggle('ck-min', next === 'minimized');
    E.btnExp.replaceChildren(next === 'expanded' ? iconRestore() : iconExpand());
    if (next === 'normal') {
      setTimeout(function () { E.inp && E.inp.focus(); }, 80);
    }
  }

  function toggle() {
    S.open = !S.open;
    E.panel.classList.toggle('ck-off', !S.open);
    if (!S.open) {
      setWindowState('normal');
    } else {
      setTimeout(function () { E.inp.focus(); }, 80);
    }
  }

  // Replace a bubble's contents with a fresh DOM tree. No HTML strings,
  // no innerHTML — pure node construction.
  function renderInto(bubble, fragment) {
    while (bubble.firstChild) bubble.removeChild(bubble.firstChild);
    bubble.appendChild(fragment);
  }

  function addBotMsg(text) {
    var m = el('div', { class: 'ck-m bot' });
    m.appendChild(mdFragment(text));
    E.msgs.appendChild(m);
    E.msgs.scrollTop = E.msgs.scrollHeight;
    return m;
  }

  function addUsrMsg(text) {
    var m = el('div', { class: 'ck-m usr' });
    m.textContent = text;
    E.msgs.appendChild(m);
    E.msgs.scrollTop = E.msgs.scrollHeight;
    return m;
  }

  function addTypingMsg() {
    var m = el('div', { class: 'ck-m bot' });
    var dots = el('span', { class: 'ck-typ', 'aria-label': 'Assistant is typing' }, [
      el('span', { class: 'ck-d' }),
      el('span', { class: 'ck-d' }),
      el('span', { class: 'ck-d' }),
    ]);
    m.appendChild(dots);
    E.msgs.appendChild(m);
    E.msgs.scrollTop = E.msgs.scrollHeight;
    return m;
  }

  function setBotText(bubble, text) {
    renderInto(bubble, mdFragment(text));
    E.msgs.scrollTop = E.msgs.scrollHeight;
  }

  function setBotPlain(bubble, text) {
    bubble.textContent = text;
    E.msgs.scrollTop = E.msgs.scrollHeight;
  }

  function send() {
    if (S.busy) return;
    var txt = (E.inp.value || '').trim();
    if (!txt) return;
    E.inp.value = '';
    E.inp.style.height = 'auto';
    addUsrMsg(txt);
    var typEl = addTypingMsg();
    S.busy = true;
    E.snd.disabled = true;
    E.inp.disabled = true;

    fetch(BASE + '/api/public/widget/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + S.token,
      },
      body: JSON.stringify({ message: txt }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.runId) throw new Error('no runId');
        openStream(d.runId, typEl);
      })
      .catch(function () {
        setBotPlain(typEl, 'Request failed — please try again.');
        idle();
      });
  }

  function openStream(runId, typEl) {
    var es = new EventSource(BASE + '/api/public/widget/runs/' + runId + '/stream');
    var buf = '';

    es.addEventListener('step.end', function (ev) {
      try {
        var d = JSON.parse(ev.data);
        if (d && d.output && typeof d.output.text === 'string') {
          buf += d.output.text;
          setBotText(typEl, buf);
        }
      } catch (_) {}
    });

    es.addEventListener('run.end', function (ev) {
      try {
        var d = JSON.parse(ev.data);
        if (!buf && d && d.output && typeof d.output.text === 'string') {
          buf = d.output.text;
          setBotText(typEl, buf);
        }
      } catch (_) {}
      if (!buf) setBotPlain(typEl, '(no response)');
      es.close();
      idle();
    });

    es.addEventListener('run.error', function () {
      setBotPlain(typEl, 'Something went wrong. Please try again.');
      es.close();
      idle();
    });

    es.onerror = function () {
      if (!buf) setBotPlain(typEl, 'Connection lost.');
      es.close();
      idle();
    };
  }

  function idle() {
    S.busy = false;
    E.snd.disabled = false;
    E.inp.disabled = false;
    setTimeout(function () { E.inp.focus(); }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSession);
  } else {
    initSession();
  }
})();
