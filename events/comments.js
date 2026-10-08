/* Staff page comments (Durand, 2026-10-08: the tracker's comment feature,
   staff pages only). A "Comment" button in the header turns on comment mode:
   the element under the pointer is outlined, a click opens a note box anchored
   to it, Enter sends, Shift+Enter starts a new line, Escape closes the box and
   a second Escape leaves comment mode. The note goes to the backend with the
   admin key, which files it on the tracker as a Claude step. */
var ETComments = (function () {
  'use strict';
  var KEY = 'et_admin_key';
  var page = '', on = false, hover = null, box = null, target = null, btn = null;
  var PICK = 'button, a, input, select, textarea, label, h1, h2, h3, p, li, td, th, .tsg-pill, .tsg-callout, .field, section';

  function adminKey() { try { return window.localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function inUi(n) { return !!(n && n.closest && n.closest('.et-cmt-ui')); }
  function pick(n) { var p = n && n.closest ? n.closest(PICK) : null; return p || n; }

  function describe(n) {
    var tag = n.tagName.toLowerCase();
    var name = n.getAttribute('title') || n.getAttribute('aria-label') || '';
    var label = tag + (n.id ? '#' + n.id : '') + (name ? ' (' + name + ')' : '');
    var parts = [], cur = n;
    while (cur && cur.nodeType === 1 && parts.length < 5 && cur !== document.body) {
      var bit = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(bit + '#' + cur.id); break; }
      var cls = (cur.className && typeof cur.className === 'string') ? cur.className.trim().split(/\s+/).filter(function (c) { return c.indexOf('et-cmt') !== 0; })[0] : '';
      parts.unshift(bit + (cls ? '.' + cls : ''));
      cur = cur.parentElement;
    }
    var text = (n.value && n.type !== 'password' ? n.value : n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    return { label: label, path: parts.join(' > '), text: text };
  }

  function toast(text, bad) {
    var t = el('div', 'et-cmt-toast et-cmt-ui' + (bad ? ' et-cmt-toast--bad' : ''), text);
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  function setHover(n) {
    if (hover) hover.classList.remove('et-cmt-hover');
    hover = n; if (hover) hover.classList.add('et-cmt-hover');
  }

  function closeBox() { if (box) box.remove(); box = null; if (target) target.classList.remove('et-cmt-target'); target = null; }

  function openBox(n) {
    closeBox(); target = n; n.classList.add('et-cmt-target');
    box = el('div', 'et-cmt-box et-cmt-ui');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Comment on this part of the page');
    var d = describe(n);
    box.appendChild(el('div', 'et-cmt-box__on', 'On: ' + (d.text || d.label).slice(0, 80)));
    var ta = el('textarea'); ta.rows = 3; ta.placeholder = 'What should change here?'; ta.maxLength = 2000;
    box.appendChild(ta);
    var row = el('div', 'et-cmt-box__row');
    var send = el('button', 'tsg-btn tsg-btn--sm', 'Send');
    send.type = 'button'; send.title = 'Files this comment on the tracker as a step for Claude. Enter also sends.';
    var cancel = el('button', 'tsg-btn tsg-btn--sm tsg-btn--ghost', 'Cancel');
    cancel.type = 'button'; cancel.title = 'Closes this box without sending. Escape also closes it.';
    row.appendChild(el('span', 'et-cmt-box__hint', 'Enter sends, Shift+Enter for a new line'));
    row.appendChild(cancel); row.appendChild(send); box.appendChild(row);
    document.body.appendChild(box);
    var r = n.getBoundingClientRect();
    var top = window.scrollY + r.bottom + 8, left = window.scrollX + Math.max(8, Math.min(r.left, document.documentElement.clientWidth - box.offsetWidth - 8));
    box.style.top = top + 'px'; box.style.left = left + 'px';
    ta.focus();
    function submit() {
      var text = ta.value.trim(); if (!text) { ta.focus(); return; }
      send.disabled = true; send.textContent = 'Sending';
      ET.post({ action: 'comment', adminKey: adminKey(), page: page, text: text, anchor: d, where: location.pathname.split('/').pop() + location.search })
        .then(function (res) {
          if (res && res.ok) { closeBox(); toast('Comment sent to the tracker.'); }
          else { send.disabled = false; send.textContent = 'Send'; toast((res && res.error) || 'The comment was not sent.', true); }
        }, function () { send.disabled = false; send.textContent = 'Send'; toast('The comment was not sent. Check the connection and try again.', true); });
    }
    send.addEventListener('click', submit);
    cancel.addEventListener('click', closeBox);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeBox(); }
    });
  }

  function onMove(e) { if (on && !box && !inUi(e.target)) setHover(pick(e.target)); }
  function onClick(e) {
    if (!on || inUi(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    setHover(null); openBox(pick(e.target));
  }
  function onKey(e) {
    if (e.key !== 'Escape' || !on) return;
    if (box) closeBox(); else toggle(false);
  }

  function toggle(want) {
    var next = typeof want === 'boolean' ? want : !on;
    if (next && !adminKey()) { toast('Unlock with the admin key first.', true); return; }
    on = next; closeBox(); setHover(null);
    document.body.classList.toggle('et-comment-mode', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? 'Done commenting' : 'Comment';
    btn.title = on ? 'Leaves comment mode. Escape also leaves it.' : 'Turns on comment mode: click any part of this page to leave a note for Claude on the tracker.';
  }

  function init(pageName) {
    page = pageName;
    var host = document.querySelector('.tsg-band__meta') || document.querySelector('.tsg-band') || document.body;
    btn = el('button', 'tsg-btn tsg-btn--sm et-cmt-btn et-cmt-ui', 'Comment');
    btn.type = 'button'; btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Turns on comment mode: click any part of this page to leave a note for Claude on the tracker.';
    btn.addEventListener('click', function () { toggle(); });
    host.appendChild(btn);
    document.addEventListener('mouseover', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
  }

  return { init: init, toggle: toggle, describe: describe };
})();
