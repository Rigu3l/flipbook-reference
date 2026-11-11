/* Landing page: recent public flipbooks. */
(function () {
  'use strict';

  async function loadRecent() {
    var grid = document.getElementById('recent-grid');
    var status = document.getElementById('recent-status');
    if (!window.fbClient) {
      status.textContent = 'Connect Supabase in js/config.js to see public flipbooks.';
      return;
    }
    try {
      var res = await window.fbClient
        .from('public_flipbooks')
        .select('id,title,page_count,views,created_at')
        .order('created_at', { ascending: false })
        .limit(12);
      if (res.error) throw res.error;
      var rows = res.data || [];
      if (!rows.length) {
        status.textContent = 'No public flipbooks yet. Be the first to upload one.';
        return;
      }
      status.textContent = '';
      grid.innerHTML = '';
      rows.forEach(function (row) {
        var card = document.createElement('article');
        card.className = 'rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden';
        var cover = document.createElement('div');
        cover.className = 'flex h-36 items-center justify-center bg-emerald-700 text-5xl font-bold text-white';
        cover.textContent = (row.title || '?').trim().charAt(0).toUpperCase();
        var body = document.createElement('div');
        body.className = 'p-4';
        var h3 = document.createElement('h3');
        h3.className = 'font-semibold text-slate-900';
        h3.textContent = row.title;
        var meta = document.createElement('p');
        meta.className = 'mt-1 text-sm text-slate-500';
        meta.textContent = (row.page_count || 0) + ' pages · ' + (row.views || 0) + ' views · ' + formatDate(row.created_at);
        body.appendChild(h3); body.appendChild(meta);
        card.appendChild(cover); card.appendChild(body);
        grid.appendChild(card);
      });
    } catch (err) {
      status.textContent = 'Could not load recent flipbooks: ' + (err.message || 'unknown error');
    }
  }

  document.addEventListener('DOMContentLoaded', loadRecent);
})();
