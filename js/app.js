/* Shared helpers for every page: Supabase client, toasts, escaping,
   hashing, and the top-nav auth state. Loaded after config.js and
   the Supabase CDN script on every page. */
(function () {
  'use strict';

  var cfg = window.FLIPBOOK_CONFIG || {};
  var client = null;

  if (window.FLIPBOOK_CONFIGURED && window.FLIPBOOK_CONFIGURED() &&
      window.supabase && window.supabase.createClient) {
    try {
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (err) {
      console.error('Supabase client failed:', err);
    }
  }
  window.fbClient = client;
  window.fbConfig = cfg;

  window.escapeHtml = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  window.showToast = function (message, type) {
    var box = document.getElementById('toast-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast-box';
      box.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2';
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    var el = document.createElement('div');
    el.className = 'rounded-lg px-4 py-3 text-sm text-white shadow-lg ' +
      (type === 'error' ? 'bg-red-600' : 'bg-emerald-600');
    el.textContent = message;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  };

  /* SHA-256 hex. Used for flipbook passwords: only the hash is
     stored, the plain password never leaves the browser. */
  window.sha256Hex = async function (text) {
    var data = new TextEncoder().encode(text);
    var digest = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  };

  window.getQueryParam = function (name) {
    return new URLSearchParams(window.location.search).get(name);
  };

  window.formatDate = function (iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (err) { return iso; }
  };

  window.publicPdfUrl = function (filePath) {
    if (!client) return '';
    return client.storage.from(cfg.BUCKET || 'pdfs').getPublicUrl(filePath).data.publicUrl;
  };

  window.siteBaseUrl = function () {
    var href = window.location.href.split('?')[0].split('#')[0];
    return href.replace(/[^\/]*$/, '');
  };

  async function currentUser() {
    if (!client) return null;
    try {
      var res = await client.auth.getSession();
      return res.data && res.data.session ? res.data.session.user : null;
    } catch (err) { return null; }
  }
  window.currentUser = currentUser;

  /* Top nav: Dashboard + Sign out when signed in, else Sign in. */
  async function renderNav() {
    var nav = document.getElementById('nav-auth');
    if (!nav) return;
    var user = await currentUser();
    nav.innerHTML = '';
    if (user) {
      var dash = document.createElement('a');
      dash.className = 'text-sm font-medium text-slate-700 hover:text-emerald-700';
      dash.href = 'dashboard.html'; dash.textContent = 'My flipbooks';
      var out = document.createElement('button');
      out.className = 'text-sm font-medium text-slate-700 hover:text-emerald-700';
      out.type = 'button'; out.textContent = 'Sign out';
      out.addEventListener('click', async function () {
        await client.auth.signOut();
        window.location.href = 'index.html';
      });
      nav.appendChild(dash); nav.appendChild(out);
    } else {
      var link = document.createElement('a');
      link.className = 'text-sm font-medium text-slate-700 hover:text-emerald-700';
      link.href = 'auth.html'; link.textContent = 'Sign in';
      nav.appendChild(link);
    }
  }

  document.addEventListener('DOMContentLoaded', renderNav);
})();
