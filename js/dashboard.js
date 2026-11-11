/* Dashboard: list the signed-in user's flipbooks, newest first.
   Delete removes the row and the stored PDF. */
(function () {
  'use strict';

  var grid = document.getElementById('my-grid');
  var statusEl = document.getElementById('my-status');

  async function loadMine() {
    var user = await window.currentUser();
    if (!user) { window.location.href = 'auth.html'; return; }
    if (!window.fbClient) { statusEl.textContent = 'Supabase is not configured yet.'; return; }
    try {
      var res = await window.fbClient
        .from('flipbooks')
        .select('id,title,file_path,page_count,views,created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (res.error) throw res.error;
      var rows = res.data || [];
      if (!rows.length) {
        statusEl.textContent = 'No flipbooks yet. Upload your first PDF above.';
        grid.innerHTML = '';
        return;
      }
      statusEl.textContent = rows.length + (rows.length === 1 ? ' flipbook' : ' flipbooks');
      grid.innerHTML = '';
      rows.forEach(function (row) { grid.appendChild(card(row)); });
    } catch (err) {
      statusEl.textContent = 'Could not load your flipbooks: ' + (err.message || 'unknown error');
    }
  }

  function card(row) {
    var el = document.createElement('article');
    el.className = 'rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden';
    el.dataset.flipbookId = row.id;

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
    var actions = document.createElement('div');
    actions.className = 'mt-3 flex gap-2';
    var open = document.createElement('a');
    open.className = 'rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700';
    open.href = 'viewer.html?id=' + row.id;
    open.textContent = 'Open';
    var designLink = document.createElement('a');
    designLink.className = 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100';
    designLink.href = 'design.html?id=' + row.id;
    designLink.textContent = 'Design';
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50';
    del.textContent = 'Delete';
    del.addEventListener('click', function () { deleteFlipbook(row, el); });
    actions.appendChild(open);
    actions.appendChild(designLink);
    actions.appendChild(del);
    body.appendChild(h3); body.appendChild(meta); body.appendChild(actions);
    el.appendChild(cover); el.appendChild(body);
    return el;
  }

  async function deleteFlipbook(row, el) {
    if (!window.confirm('Delete "' + row.title + '"? This cannot be undone.')) return;
    try {
      var user = await window.currentUser();
      var userPart = (row.file_path || '').split('/')[0] || user.id;
      var paths = [row.file_path, userPart + '/' + row.id + '.design.json'];
      var delStorage = await window.fbClient.storage
        .from(window.fbConfig.BUCKET || 'pdfs').remove(paths);
      if (delStorage.error) throw delStorage.error;
      var delRow = await window.fbClient.from('flipbooks').delete().eq('id', row.id).eq('user_id', user.id);
      if (delRow.error) throw delRow.error;
      el.remove();
      showToast('Flipbook deleted.');
      loadMine();
    } catch (err) {
      showToast('Delete failed: ' + (err.message || 'unknown error'), 'error');
    }
  }

  window.addEventListener('flipbook-created', loadMine);
  document.addEventListener('DOMContentLoaded', loadMine);
})();
