// Shared client for the TSG Event Ticketing pages. Reads config.js (written by
// tools/build-site.js from the deployment record, never committed), talks to
// the Apps Script backend cross-site, and draws QR codes with the vendored
// qrcode-generator library.
//
// WHY cross-site (2026-10-01, TSG Forms): a page served from script.google.com
// is routed through the visitor's Google session when the browser has one and
// can fail before our code runs. A page on another host calls the /exec URL
// without Google cookies and never meets that. POST bodies go as text/plain
// so the browser sends no preflight, which Apps Script cannot answer.
window.ET = (function () {
  'use strict';
  var cfg = window.ET_CONFIG || {};
  var QA_KEY = 'et_qa_token';

  function param(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function execUrl() {
    if (!cfg.execUrl) throw new Error('config.js is missing: build the site with tools/build-site.js');
    return cfg.execUrl;
  }

  function siteUrl() {
    if (cfg.siteUrl) return cfg.siteUrl.replace(/\/?$/, '/');
    return window.location.href.replace(/[^/]*$/, '');
  }

  function api(params) {
    var u = new URL(execUrl());
    Object.keys(params).forEach(function (k) { if (params[k] !== '' && params[k] !== undefined) u.searchParams.set(k, params[k]); });
    return fetch(u.toString(), { method: 'GET', redirect: 'follow', credentials: 'omit' })
      .then(function (r) { return r.json(); });
  }

  function post(body) {
    var qa = qaToken();
    if (qa) body.qaToken = qa;
    return fetch(execUrl(), {
      method: 'POST', redirect: 'follow', credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  // Rehearsal mode: ?qatest=<secret> on any page mints a token the backend
  // recognises for 30 minutes; it is kept for the tab only.
  function qaToken() {
    try { return window.sessionStorage.getItem(QA_KEY) || ''; } catch (e) { return ''; }
  }
  function initQa() {
    var secret = param('qatest');
    if (!secret) return Promise.resolve(qaToken());
    return api({ api: 'qa', qatest: secret }).then(function (r) {
      var t = (r && r.qaToken) || '';
      try { if (t) window.sessionStorage.setItem(QA_KEY, t); } catch (e) { /* private mode */ }
      return t;
    }).catch(function () { return ''; });
  }
  function showQaBanner() {
    if (!qaToken()) return;
    var b = document.createElement('div');
    b.id = 'qaTestBanner';
    b.style.display = 'block';
    b.title = 'Rehearsal mode: this submission is flagged as a test and is not counted.';
    b.textContent = 'QA TEST MODE: nothing you submit here counts as a real RSVP.';
    document.body.insertBefore(b, document.body.firstChild);
  }

  // The QR encodes the check-in link for this ticket. Error level H so a
  // scuffed phone screen still reads; a scaled SVG keeps it crisp at any size.
  function drawQr(el, text) {
    var q = window.qrcode(0, 'H');
    q.addData(text);
    q.make();
    el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    var svg = el.querySelector('svg');
    if (svg) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR code for check-in'); }
  }

  // Public pages show every time in the viewer's own zone, with its name
  // (Durand, 2026-10-07: serve the recipient's time zone, not a fixed one).
  // The backend stores instants; only staff pages fix on Eastern.
  function when(startIso, endIso) {
    if (!startIso) return '';
    var s = new Date(startIso);
    var opts = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };
    var text = new Intl.DateTimeFormat('en-US', opts).format(s);
    if (endIso) {
      var e = new Date(endIso);
      var sameDay = s.toDateString() === e.toDateString();
      text += ' to ' + new Intl.DateTimeFormat('en-US', sameDay ? { hour: 'numeric', minute: '2-digit' } : opts).format(e);
    }
    var zone = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(s).filter(function (x) { return x.type === 'timeZoneName'; })[0];
    return text + (zone ? ' ' + zone.value : '');
  }

  function ticketUrl(token) { return siteUrl() + 'ticket.html?t=' + encodeURIComponent(token); }
  function checkinUrl(token) { return siteUrl() + 'checkin.html?t=' + encodeURIComponent(token); }

  function pill(kind, text, title) {
    return '<span class="tsg-pill tsg-pill--' + kind + '" title="' + esc(title) + '">' + esc(text) + '</span>';
  }

  function showMessage(el, kind, text) {
    el.className = 'tsg-msg tsg-msg--' + kind;
    el.textContent = text;
    el.style.display = 'block';
  }
  function hideMessage(el) { el.style.display = 'none'; }

  // Renders the ticket card used by the confirmation and the ticket page.
  // The guest's agent (Durand, 2026-10-08): photo from FUB when it has one,
  // else a badge with the initials. Only https photos are drawn.
  function agentHtml(a, lead) {
    if (!a || !a.name) return '';
    var face = a.photo && /^https:\/\//.test(a.photo)
      ? '<img class="et-agent__photo" src="' + esc(a.photo) + '" alt="" width="56" height="56" referrerpolicy="no-referrer">'
      : '<span class="et-agent__initials" aria-hidden="true">' + esc(a.initials || '') + '</span>';
    return '<div class="et-agent">' + face + '<div><div class="et-agent__lead">' + esc(lead) + '</div>' +
      '<div class="et-agent__name">' + esc(a.name) + '</div></div></div>';
  }

  function renderTicket(el, t) {
    var status = t.status === 'checked_in'
      ? pill('good', 'Checked in', 'This ticket was scanned at the door.')
      : pill('neutral', 'Registered', 'This ticket is valid. Show the code at the door.');
    el.innerHTML =
      '<div class="et-ticket">' +
        '<div class="et-row" style="justify-content:center">' + status +
          (t.qaTest ? pill('critical', 'Test', 'A rehearsal ticket. It is not counted.') : '') + '</div>' +
        '<div class="et-ticket__qr" id="etQr"></div>' +
        '<p class="et-ticket__name">' + esc(t.name) + '</p>' +
        '<p class="et-ticket__meta">' + esc(t.guestCount) + (t.guestCount === 1 ? ' guest' : ' guests') + ', including you</p>' +
        '<p class="et-ticket__meta">' + esc(t.event.title) + '<br>' + esc(when(t.event.startsAt, t.event.endsAt)) +
          (t.event.venue ? '<br>' + esc(t.event.venue) : '') + '</p>' +
        (t.agent ? agentHtml(t.agent, 'Your agent') : '') +
        '<p class="et-note">Screenshot this code or keep the link below. Staff scan it at the door.</p>' +
        '<p class="et-ticket__code"><a href="' + esc(ticketUrl(t.token)) + '" title="Opens this ticket on its own page, which you can bookmark.">Open my ticket page</a></p>' +
      '</div>';
    drawQr(el.querySelector('#etQr'), checkinUrl(t.token));
  }

  return { param: param, esc: esc, api: api, post: post, initQa: initQa, showQaBanner: showQaBanner,
           qaToken: qaToken, drawQr: drawQr, ticketUrl: ticketUrl, checkinUrl: checkinUrl, pill: pill,
           showMessage: showMessage, hideMessage: hideMessage, renderTicket: renderTicket, siteUrl: siteUrl, when: when,
           agentHtml: agentHtml };
})();
