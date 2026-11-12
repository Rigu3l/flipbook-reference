/* F8 interactions editor: drag-select an area on a page, pick a type
   (Link / Image / Video / Audio / Web), configure it, and save it into
   the design sidecar as design.interactions (owner-only page). */
(function () {
  'use strict';

  var id = getQueryParam('id');
  var book = null;
  var user = null;
  var design = null;
  var pdf = null;
  var currentPage = 1;
  var selection = null;   /* {x,y,w,h} fractions of the page, or null */
  var editingId = null;   /* id of the interaction being edited, or null */

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function showError(msg) {
    var el = $('#ia-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function designPath() { return user.id + '/' + book.id + '.design.json'; }
  function uid() { return 'ia-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  async function load() {
    if (!id) { showError('No flipbook selected.'); return; }
    user = await window.currentUser();
    if (!user) { window.location.href = 'auth.html'; return; }
    var res = await window.fbClient.from('flipbooks')
      .select('id,title,file_path,page_count,user_id')
      .eq('id', id).eq('user_id', user.id)
      .maybeSingle();
    if (res.error) throw res.error;
    book = res.data;
    if (!book) { showError('This flipbook was not found, or it is not yours.'); return; }
    $('#page-title').textContent = 'Interactions — ' + (book.title || 'Untitled');
    $('#view-link').href = 'viewer.html?id=' + book.id;
    /* Load the design sidecar (preserve everything else; only
       interactions are edited here). */
    design = { interactions: [] };
    try {
      var url = window.publicPdfUrl(designPath());
      if (url) {
        var r = await fetch(url, { cache: 'no-store' });
        if (r.ok) {
          var saved = await r.json();
          if (saved && typeof saved === 'object') design = saved;
        }
      }
    } catch (e) { /* no design yet — start with interactions only */ }
    if (!Array.isArray(design.interactions)) design.interactions = [];
    /* Load the PDF. */
    var pdfUrl = window.publicPdfUrl(book.file_path);
    pdf = await window.pdfjsLib.getDocument(pdfUrl).promise;
    /* Page picker. */
    var sel = $('#ia-page-select');
    for (var n = 1; n <= book.page_count; n++) {
      var opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = 'Page ' + n;
      sel.appendChild(opt);
    }
    $('#ia-page-count').textContent = 'of ' + book.page_count;
    $('#ia-loading').classList.add('hidden');
    $('#ia-main').classList.remove('hidden');
    await renderPage(1);
  }

  async function renderPage(n) {
    currentPage = Math.max(1, Math.min(book.page_count, n));
    $('#ia-page-select').value = String(currentPage);
    $('#ia-prev').disabled = currentPage <= 1;
    $('#ia-next').disabled = currentPage >= book.page_count;
    selection = null;
    editingId = null;
    $('#select-box').style.display = 'none';
    $('#ia-form').classList.add('hidden');
    $('#ia-selection-hint').textContent = 'Drag on the page to select an area first.';
    var pg = await pdf.getPage(currentPage);
    var vp = pg.getViewport({ scale: 1 });
    var scale = Math.min(2, 800 / vp.width);
    var canvas = $('#ia-canvas');
    canvas.width = Math.round(vp.width * scale);
    canvas.height = Math.round(vp.height * scale);
    await pg.render({ canvasContext: canvas.getContext('2d'), viewport: pg.getViewport({ scale: scale }) }).promise;
    renderHotspots();
    renderList();
  }
  function pageInteractions() {
    return design.interactions.filter(function (it) { return it.page === currentPage; });
  }
  function renderHotspots() {
    var layer = $('#hotspot-layer');
    layer.innerHTML = '';
    var canvas = $('#ia-canvas');
    pageInteractions().forEach(function (it) {
      var el = document.createElement('div');
      el.className = 'hotspot-preview';
      el.style.left = (it.x * 100) + '%';
      el.style.top = (it.y * 100) + '%';
      el.style.width = (it.w * 100) + '%';
      el.style.height = (it.h * 100) + '%';
      var label = document.createElement('span');
      label.className = 'hotspot-label';
      label.textContent = it.type;
      el.appendChild(label);
      el.addEventListener('click', function (e) { e.stopPropagation(); editInteraction(it); });
      layer.appendChild(el);
    });
  }
  function renderList() {
    var box = $('#ia-list');
    box.innerHTML = '';
    var items = pageInteractions();
    if (!items.length) {
      box.innerHTML = '<p class="text-sm text-slate-500">None yet.</p>';
      return;
    }
    items.forEach(function (it) {
      var row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm';
      var label = document.createElement('button');
      label.type = 'button';
      label.className = 'min-w-0 flex-1 truncate text-left text-slate-700 hover:text-emerald-700';
      label.textContent = it.type + ' — ' + summarize(it);
      label.addEventListener('click', function () { editInteraction(it); });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'shrink-0 rounded px-2 py-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Remove interaction');
      del.addEventListener('click', function () {
        design.interactions = design.interactions.filter(function (x) { return x.id !== it.id; });
        renderHotspots();
        renderList();
      });
      row.appendChild(label);
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  function summarize(it) {
    if (it.type === 'link') {
      if (it.action === 'page') return 'go to page ' + (it.targetPage || 1);
      if (it.action === 'url') return it.url || '';
      if (it.action === 'zoom') return 'zoom ' + Math.round((it.zoom || 1.5) * 100) + '%';
      return 'popup: ' + (it.popupUrl || '');
    }
    if (it.type === 'image') return it.imageUrl || '';
    if (it.type === 'video') return it.videoUrl || '';
    if (it.type === 'audio') return it.title || it.audioUrl || '';
    if (it.type === 'web') return it.webUrl || '';
    return '';
  }

  /* ---- Drag-select on the page canvas. ---- */
  var drag = null;
  function canvasPos(e) {
    var rect = $('#ia-canvas').getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    };
  }
  $('#ia-canvas').addEventListener('pointerdown', function (e) {
    var p = canvasPos(e);
    drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    e.preventDefault();
  });
  window.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var p = canvasPos(e);
    drag.x1 = p.x; drag.y1 = p.y;
    var box = $('#select-box');
    box.style.display = 'block';
    box.style.left = (Math.min(drag.x0, drag.x1) * 100) + '%';
    box.style.top = (Math.min(drag.y0, drag.y1) * 100) + '%';
    box.style.width = (Math.abs(drag.x1 - drag.x0) * 100) + '%';
    box.style.height = (Math.abs(drag.y1 - drag.y0) * 100) + '%';
  });
  window.addEventListener('pointerup', function () {
    if (!drag) return;
    var x0 = drag.x0, y0 = drag.y0, x1 = drag.x1, y1 = drag.y1;
    drag = null;
    $('#select-box').style.display = 'none';
    var w = Math.abs(x1 - x0);
    var h = Math.abs(y1 - y0);
    if (w < 0.02 || h < 0.02) return; /* too small to be a selection */
    selection = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: w, h: h };
    openForm(null);
  });

  /* ---- Config form. ---- */
  function showTypeConfig(type) {
    ['link', 'image', 'video', 'audio', 'web'].forEach(function (t) {
      $('#ia-cfg-' + t).classList.toggle('hidden', t !== type);
    });
    updateLinkRows();
  }
  function updateLinkRows() {
    var action = $('#ia-link-action').value;
    $('#ia-link-page-row').classList.toggle('hidden', action !== 'page');
    $('#ia-link-url-row').classList.toggle('hidden', action !== 'url');
    $('#ia-link-zoom-row').classList.toggle('hidden', action !== 'zoom');
    $('#ia-link-popup-row').classList.toggle('hidden', action !== 'popup');
  }
  function openForm(it) {
    editingId = it ? it.id : null;
    if (it) selection = { x: it.x, y: it.y, w: it.w, h: it.h };
    $('#ia-selection-hint').textContent = it
      ? 'Editing the selected area on page ' + currentPage + '.'
      : 'Area selected on page ' + currentPage + '. Fill in the details below.';
    $('#ia-form').classList.remove('hidden');
    if (it) {
      $('#ia-type').value = it.type;
      if (it.type === 'link') {
        $('#ia-link-action').value = it.action || 'page';
        $('#ia-link-page').value = String(it.targetPage || 1);
        $('#ia-link-url').value = it.url || '';
        $('#ia-link-newtab').checked = it.newTab !== false;
        $('#ia-link-zoom').value = String(it.zoom || 1.5);
        $('#ia-link-popup-type').value = it.popupType || 'image';
        $('#ia-link-popup-url').value = it.popupUrl || '';
        $('#ia-link-highlight').checked = !!it.highlight;
      } else if (it.type === 'image') {
        $('#ia-image-url').value = it.imageUrl || '';
      } else if (it.type === 'video') {
        $('#ia-video-url').value = it.videoUrl || '';
        $('#ia-video-muted').checked = !!it.muted;
        $('#ia-video-autoplay').checked = !!it.autoplay;
        $('#ia-video-controls').checked = it.controls !== false;
      } else if (it.type === 'audio') {
        $('#ia-audio-url').value = it.audioUrl || '';
        $('#ia-audio-title').value = it.title || '';
      } else if (it.type === 'web') {
        $('#ia-web-url').value = it.webUrl || '';
        $('#ia-web-noscroll').checked = !!it.noScrollbars;
      }
      $('#ia-add').textContent = 'Update interaction';
    } else {
      $('#ia-add').textContent = 'Add interaction';
    }
    showTypeConfig($('#ia-type').value);
  }
  function editInteraction(it) { openForm(it); }
  $('#ia-type').addEventListener('change', function () { showTypeConfig($('#ia-type').value); });
  $('#ia-link-action').addEventListener('change', updateLinkRows);
  $('#ia-cancel').addEventListener('click', function () {
    selection = null;
    editingId = null;
    $('#ia-form').classList.add('hidden');
    $('#ia-selection-hint').textContent = 'Drag on the page to select an area first.';
  });
  $('#ia-add').addEventListener('click', function () {
    if (!selection) return;
    var type = $('#ia-type').value;
    var it = {
      id: editingId || uid(),
      page: currentPage,
      x: selection.x, y: selection.y, w: selection.w, h: selection.h,
      type: type
    };
    if (type === 'link') {
      it.action = $('#ia-link-action').value;
      it.targetPage = parseInt($('#ia-link-page').value, 10) || 1;
      it.url = $('#ia-link-url').value.trim();
      it.newTab = $('#ia-link-newtab').checked;
      it.zoom = parseFloat($('#ia-link-zoom').value) || 1.5;
      it.popupType = $('#ia-link-popup-type').value;
      it.popupUrl = $('#ia-link-popup-url').value.trim();
      it.highlight = $('#ia-link-highlight').checked;
    } else if (type === 'image') {
      it.imageUrl = $('#ia-image-url').value.trim();
    } else if (type === 'video') {
      it.videoUrl = $('#ia-video-url').value.trim();
      it.muted = $('#ia-video-muted').checked;
      it.autoplay = $('#ia-video-autoplay').checked;
      it.controls = $('#ia-video-controls').checked;
    } else if (type === 'audio') {
      it.audioUrl = $('#ia-audio-url').value.trim();
      it.title = $('#ia-audio-title').value.trim();
    } else if (type === 'web') {
      it.webUrl = $('#ia-web-url').value.trim();
      it.noScrollbars = $('#ia-web-noscroll').checked;
    }
    if (editingId) {
      var idx = design.interactions.findIndex(function (x) { return x.id === editingId; });
      if (idx !== -1) design.interactions[idx] = it;
    } else {
      design.interactions.push(it);
    }
    selection = null;
    editingId = null;
    $('#ia-form').classList.add('hidden');
    $('#ia-selection-hint').textContent = 'Drag on the page to select an area first.';
    renderHotspots();
    renderList();
    showToast('Interaction added.', 'success');
  });

  /* ---- Save (whole design sidecar, interactions updated). ---- */
  $('#ia-save').addEventListener('click', async function () {
    var btn = $('#ia-save');
    var status = $('#ia-status');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      var blob = new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' });
      var up = await window.fbClient.storage
        .from(window.fbConfig.BUCKET || 'pdfs')
        .upload(designPath(), blob, { upsert: true, contentType: 'application/json' });
      if (up.error) throw up.error;
      status.textContent = 'Interactions saved.';
      showToast('Interactions saved.', 'success');
    } catch (e) {
      status.textContent = 'Could not save: ' + (e.message || e);
      showToast('Could not save the interactions.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save interactions';
    }
  });

  /* ---- Page navigation. ---- */
  $('#ia-prev').addEventListener('click', function () { renderPage(currentPage - 1); });
  $('#ia-next').addEventListener('click', function () { renderPage(currentPage + 1); });
  $('#ia-page-select').addEventListener('change', function () {
    renderPage(parseInt($('#ia-page-select').value, 10) || 1);
  });

  document.addEventListener('DOMContentLoaded', load);
})();
