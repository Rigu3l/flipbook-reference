/* F11 Dashboard: stats, search, bookshelves, trash.
   Stats: total flipbooks + total views (from the loaded rows).
   Search: filters the cards by title, client-side.
   Bookshelves: shelves live in a per-user sidecar {user_id}/shelves.json
   (array of {id, name, bookIds[]}); a shelf filter + per-card shelf
   picker assign books to shelves.
   Trash: delete moves the book id into {user_id}/trash.json (the row
   and files stay); the Trash view lists them with Restore and
   Delete permanently. */
(function () {
  'use strict';

  var grid = document.getElementById('my-grid');
  var statusEl = document.getElementById('my-status');
  var searchEl = document.getElementById('dash-search');
  var statsEl = document.getElementById('dash-stats');
  var filtersEl = document.getElementById('dash-filters');
  var newShelfBtn = document.getElementById('dash-new-shelf');

  var user = null;
  var rows = [];
  var shelves = [];
  var trash = [];
  var currentFilter = 'all'; /* 'all' | 'trash' | shelf id */
  var searchQuery = '';

  function trashPath() { return user.id + '/trash.json'; }
  function shelvesPath() { return user.id + '/shelves.json'; }

  async function loadSidecar(path, fallback) {
    try {
      var url = window.publicPdfUrl(path);
      if (!url) return fallback;
      var r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return fallback;
      var data = await r.json();
      return data == null ? fallback : data;
    } catch (e) { return fallback; }
  }
  async function saveSidecar(path, data) {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var up = await window.fbClient.storage
      .from(window.fbConfig.BUCKET || 'pdfs')
      .upload(path, blob, { upsert: true, contentType: 'application/json' });
    if (up.error) throw up.error;
  }

  async function loadMine() {
    user = await window.currentUser();
    if (!user) { window.location.href = 'auth.html'; return; }
    if (!window.fbClient) { statusEl.textContent = 'Supabase is not configured yet.'; return; }
    try {
      var res = await window.fbClient
        .from('flipbooks')
        .select('id,title,file_path,page_count,views,created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (res.error) throw res.error;
      rows = res.data || [];
      var t = await loadSidecar(trashPath(), []);
      trash = Array.isArray(t) ? t : [];
      var s = await loadSidecar(shelvesPath(), []);
      shelves = Array.isArray(s) ? s : [];
      renderFilters();
      render();
    } catch (err) {
      statusEl.textContent = 'Could not load your flipbooks: ' + (err.message || 'unknown error');
    }
  }

  function visibleRows() {
    var list = rows.filter(function (row) {
      var isTrashed = trash.indexOf(row.id) !== -1;
      if (currentFilter === 'trash') return isTrashed;
      if (isTrashed) return false;
      if (currentFilter !== 'all') {
        var shelf = shelves.filter(function (sh) { return sh.id === currentFilter; })[0];
        if (!shelf || (shelf.bookIds || []).indexOf(row.id) === -1) return false;
      }
      if (searchQuery) {
        return (row.title || '').toLowerCase().indexOf(searchQuery) !== -1;
      }
      return true;
    });
    return list;
  }

  function render() {
    var totalViews = rows.reduce(function (sum, r) { return sum + (r.views || 0); }, 0);
    var liveCount = rows.filter(function (r) { return trash.indexOf(r.id) === -1; }).length;
    statsEl.textContent = liveCount + (liveCount === 1 ? ' flipbook' : ' flipbooks') +
      ' · ' + totalViews + ' total views' +
      (trash.length ? ' · ' + trash.length + ' in trash' : '');
    var list = visibleRows();
    grid.innerHTML = '';
    if (!list.length) {
      statusEl.textContent = currentFilter === 'trash'
        ? 'Trash is empty.'
        : (searchQuery ? 'No flipbooks match "' + searchQuery + '".' : 'No flipbooks yet. Upload your first PDF above.');
      return;
    }
    statusEl.textContent = list.length + (list.length === 1 ? ' flipbook' : ' flipbooks');
    list.forEach(function (row) { grid.appendChild(card(row)); });
  }

  function renderFilters() {
    filtersEl.innerHTML = '';
    function addFilter(label, value) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rounded-full border px-3 py-1 text-sm font-medium ' +
        (currentFilter === value
          ? 'border-emerald-600 bg-emerald-600 text-white'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100');
      b.textContent = label;
      b.addEventListener('click', function () { currentFilter = value; renderFilters(); render(); });
      filtersEl.appendChild(b);
    }
    addFilter('All books', 'all');
    shelves.forEach(function (sh) { addFilter(sh.name, sh.id); });
    addFilter('Trash', 'trash');
  }

  function shelfOf(row) {
    for (var i = 0; i < shelves.length; i++) {
      if ((shelves[i].bookIds || []).indexOf(row.id) !== -1) return shelves[i].id;
    }
    return '';
  }

  function card(row) {
    var isTrashed = trash.indexOf(row.id) !== -1;
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
    body.appendChild(h3); body.appendChild(meta);

    if (!isTrashed) {
      /* Shelf picker. */
      var shelfRow = document.createElement('div');
      shelfRow.className = 'mt-3 flex items-center gap-2';
      var shelfLabel = document.createElement('label');
      shelfLabel.className = 'text-sm text-slate-500';
      shelfLabel.textContent = 'Shelf:';
      var shelfSel = document.createElement('select');
      shelfSel.className = 'min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm';
      shelfSel.setAttribute('aria-label', 'Bookshelf for ' + row.title);
      var noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = 'No shelf';
      shelfSel.appendChild(noneOpt);
      shelves.forEach(function (sh) {
        var opt = document.createElement('option');
        opt.value = sh.id;
        opt.textContent = sh.name;
        shelfSel.appendChild(opt);
      });
      shelfSel.value = shelfOf(row);
      shelfSel.addEventListener('change', function () { assignShelf(row.id, shelfSel.value); });
      shelfRow.appendChild(shelfLabel);
      shelfRow.appendChild(shelfSel);
      body.appendChild(shelfRow);
    }

    var actions = document.createElement('div');
    actions.className = 'mt-3 flex flex-wrap gap-2';
    if (isTrashed) {
      var restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700';
      restore.textContent = 'Restore';
      restore.addEventListener('click', function () { restoreFlipbook(row, el); });
      var delPerm = document.createElement('button');
      delPerm.type = 'button';
      delPerm.className = 'rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50';
      delPerm.textContent = 'Delete permanently';
      delPerm.addEventListener('click', function () { deletePermanently(row, el); });
      actions.appendChild(restore);
      actions.appendChild(delPerm);
    } else {
      var open = document.createElement('a');
      open.className = 'rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700';
      open.href = 'viewer.html?id=' + row.id;
      open.textContent = 'Open';
      var designLink = document.createElement('a');
      designLink.className = 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100';
      designLink.href = 'design.html?id=' + row.id;
      designLink.textContent = 'Design';
      var iaLink = document.createElement('a');
      iaLink.className = 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100';
      iaLink.href = 'interactions.html?id=' + row.id;
      iaLink.textContent = 'Interactions';
      var settingsLink = document.createElement('a');
      settingsLink.className = 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100';
      settingsLink.href = 'settings.html?id=' + row.id;
      settingsLink.textContent = 'Settings';
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50';
      del.textContent = 'Delete';
      del.addEventListener('click', function () { moveToTrash(row, el); });
      actions.appendChild(open);
      actions.appendChild(designLink);
      actions.appendChild(iaLink);
      actions.appendChild(settingsLink);
      actions.appendChild(del);
    }
    body.appendChild(actions);
    el.appendChild(cover); el.appendChild(body);
    return el;
  }

  async function assignShelf(bookId, shelfId) {
    shelves.forEach(function (sh) {
      sh.bookIds = (sh.bookIds || []).filter(function (id) { return id !== bookId; });
      if (sh.id === shelfId) sh.bookIds.push(bookId);
    });
    try {
      await saveSidecar(shelvesPath(), shelves);
      showToast('Shelf updated.');
    } catch (err) {
      showToast('Could not update the shelf: ' + (err.message || 'unknown error'), 'error');
    }
  }

  /* ---- In-page confirm (replaces window.confirm, which the
     automated browser auto-dismisses and which is jarring UX). ---- */
  var confirmEl = document.getElementById('dash-confirm');
  var confirmTextEl = document.getElementById('dash-confirm-text');
  var confirmOkBtn = document.getElementById('dash-confirm-ok');
  var confirmCancelBtn = document.getElementById('dash-confirm-cancel');
  var confirmResolve = null;
  function askConfirm(message) {
    return new Promise(function (resolve) {
      confirmResolve = resolve;
      confirmTextEl.textContent = message;
      confirmEl.classList.remove('hidden');
      confirmEl.classList.add('flex');
      confirmOkBtn.focus();
    });
  }
  function closeConfirm(result) {
    confirmEl.classList.add('hidden');
    confirmEl.classList.remove('flex');
    if (confirmResolve) { var r = confirmResolve; confirmResolve = null; r(result); }
  }
  if (confirmOkBtn) confirmOkBtn.addEventListener('click', function () { closeConfirm(true); });
  if (confirmCancelBtn) confirmCancelBtn.addEventListener('click', function () { closeConfirm(false); });
  if (confirmEl) confirmEl.addEventListener('click', function (e) { if (e.target === confirmEl) closeConfirm(false); });

  async function moveToTrash(row, el) {
    if (!await askConfirm('Move "' + row.title + '" to trash? You can restore it later.')) return;
    try {
      if (trash.indexOf(row.id) === -1) trash.push(row.id);
      await saveSidecar(trashPath(), trash);
      el.remove();
      showToast('Moved to trash.');
      render();
    } catch (err) {
      showToast('Could not move to trash: ' + (err.message || 'unknown error'), 'error');
    }
  }

  async function restoreFlipbook(row, el) {
    try {
      trash = trash.filter(function (id) { return id !== row.id; });
      await saveSidecar(trashPath(), trash);
      el.remove();
      showToast('Flipbook restored.');
      render();
    } catch (err) {
      showToast('Could not restore: ' + (err.message || 'unknown error'), 'error');
    }
  }

  async function deletePermanently(row, el) {
    if (!await askConfirm('Delete "' + row.title + '" permanently? This cannot be undone.')) return;
    try {
      var userPart = (row.file_path || '').split('/')[0] || user.id;
      var paths = [
        row.file_path,
        userPart + '/' + row.id + '.design.json',
        userPart + '/' + row.id + '-bg.png',
        userPart + '/' + row.id + '-bg.jpg',
        userPart + '/' + row.id + '-audio.mp3',
        userPart + '/' + row.id + '-audio.wav'
      ];
      var delStorage = await window.fbClient.storage
        .from(window.fbConfig.BUCKET || 'pdfs').remove(paths);
      if (delStorage.error) throw delStorage.error;
      var delRow = await window.fbClient.from('flipbooks').delete().eq('id', row.id).eq('user_id', user.id);
      if (delRow.error) throw delRow.error;
      trash = trash.filter(function (id) { return id !== row.id; });
      await saveSidecar(trashPath(), trash);
      shelves.forEach(function (sh) {
        sh.bookIds = (sh.bookIds || []).filter(function (id) { return id !== row.id; });
      });
      await saveSidecar(shelvesPath(), shelves);
      el.remove();
      showToast('Flipbook deleted permanently.');
      render();
    } catch (err) {
      showToast('Delete failed: ' + (err.message || 'unknown error'), 'error');
    }
  }

  if (newShelfBtn) {
    newShelfBtn.addEventListener('click', async function () {
      var name = window.prompt('Name the new bookshelf:');
      if (!name || !name.trim()) return;
      var shelf = { id: 'shelf-' + Date.now().toString(36), name: name.trim(), bookIds: [] };
      shelves.push(shelf);
      try {
        await saveSidecar(shelvesPath(), shelves);
        showToast('Bookshelf "' + shelf.name + '" created.', 'success');
        renderFilters();
        render();
      } catch (err) {
        shelves.pop();
        showToast('Could not create the shelf: ' + (err.message || 'unknown error'), 'error');
      }
    });
  }
  if (searchEl) {
    searchEl.addEventListener('input', function () {
      searchQuery = searchEl.value.trim().toLowerCase();
      render();
    });
  }

  window.addEventListener('flipbook-created', loadMine);
  document.addEventListener('DOMContentLoaded', loadMine);
})();
