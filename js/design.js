/* F5 design editor: title / background / controls for one flipbook.
   Saved as a JSON sidecar in Storage next to the PDF:
   {user_id}/{flipbook_id}.design.json (public read, owner write).
   The book title itself is also written back to the flipbooks row. */
(function () {
  'use strict';

  var id = getQueryParam('id');
  var book = null;
  var user = null;
  var bgImageFile = null;   /* newly chosen background image, if any */
  var bgImageRemoved = false;

  var COLOR_SWATCHES = ['#f1f5f9', '#ffffff', '#0f172a', '#19A975', '#7c5cff',
    '#f59e0b', '#ef4444', '#0ea5e9', '#f8ede9', '#fef3c7'];
  var GRADIENTS = [
    'linear-gradient(135deg,#7c5cff,#2dd4bf)',
    'linear-gradient(135deg,#f59e0b,#ef4444)',
    'linear-gradient(135deg,#0ea5e9,#059669)',
    'linear-gradient(135deg,#f8ede9,#feb4a7)',
    'linear-gradient(135deg,#0f172a,#334155)',
    'linear-gradient(135deg,#fef3c7,#fde68a)'
  ];

  function defaults() {
    return {
      subtitle: '', description: '', showTitles: true,
      toc: [],
      viewMode: 'magazine',
      backgroundAudio: { path: '', enabled: false },
      flipSound: true,
      background: {
        type: 'color', color: '#f1f5f9', gradient: '',
        imagePath: '', size: 'cover', position: 'center',
        transparency: 100, blur: 0
      },
      controls: {
        show: { fullscreen: true, zoom: true, prevNext: true,
                thumbnails: true, firstPage: true, lastPage: true,
                share: true, download: true, print: true,
                toc: true, search: true, bookmarks: true },
        size: 'medium', accent: '#19A975'
      }
    };
  }
  var design = defaults();

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  /* ---- F7 Table of contents items (title + page). ---- */
  function renderTocItems() {
    var box = $('#toc-items');
    box.innerHTML = '';
    var items = Array.isArray(design.toc) ? design.toc : [];
    if (!items.length) {
      box.innerHTML = '<p class="text-sm text-slate-500">No index items yet.</p>';
      return;
    }
    items.forEach(function (item, i) {
      var row = document.createElement('div');
      row.className = 'flex items-center gap-2';
      var title = document.createElement('input');
      title.type = 'text';
      title.placeholder = 'Title';
      title.value = item.title || '';
      title.className = 'toc-title min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm';
      title.dataset.idx = String(i);
      var page = document.createElement('input');
      page.type = 'number';
      page.min = '1';
      page.placeholder = 'Page';
      page.value = String(item.page || 1);
      page.className = 'toc-page w-20 shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm';
      page.dataset.idx = String(i);
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'shrink-0 rounded-lg px-2 py-1 text-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Remove index item');
      del.addEventListener('click', function () {
        collectToc();
        design.toc.splice(i, 1);
        renderTocItems();
      });
      row.appendChild(title);
      row.appendChild(page);
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  function collectToc() {
    var items = [];
    $$('#toc-items .toc-title').forEach(function (titleEl) {
      var i = parseInt(titleEl.dataset.idx, 10);
      var pageEl = document.querySelector('#toc-items .toc-page[data-idx="' + i + '"]');
      var page = pageEl ? (parseInt(pageEl.value, 10) || 1) : 1;
      var title = titleEl.value.trim();
      if (title) items.push({ title: title, page: page });
    });
    design.toc = items;
  }

  function showError(msg) {
    var el = $('#design-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function designPath() {
    return user.id + '/' + book.id + '.design.json';
  }
  function bgImagePath(ext) {
    return user.id + '/' + book.id + '-bg.' + ext;
  }
  function audioPath(ext) {
    return user.id + '/' + book.id + '-audio.' + ext;
  }
  function updateAudioLabel() {
    var el = $('#design-audio-current');
    var a = design.backgroundAudio || {};
    el.textContent = a.path ? ('Current audio: ' + a.path.split('/').pop()) : 'No audio uploaded yet.';
  }

  function readForm() {
    design.subtitle = $('#d-subtitle').value.trim();
    design.description = $('#d-description').value.trim();
    design.showTitles = $('#d-show-titles').checked;
    design.viewMode = $('#d-view-mode').value || 'magazine';
    collectToc();
    if (!design.backgroundAudio) design.backgroundAudio = {};
    design.backgroundAudio.enabled = $('#design-audio-enabled').checked;
    design.flipSound = $('#design-flip-sound').checked;
    var bg = design.background;
    bg.type = currentBgType();
    bg.color = $('#d-bg-color').value;
    bg.size = $('#d-bg-size').value;
    bg.position = $('#d-bg-position').value;
    bg.transparency = parseInt($('#d-bg-transparency').value, 10) || 100;
    bg.blur = parseInt($('#d-bg-blur').value, 10) || 0;
    if (bgImageRemoved) bg.imagePath = '';
    $$('input[data-show]').forEach(function (cb) {
      design.controls.show[cb.dataset.show] = cb.checked;
    });
    design.controls.size = $('#d-btn-size').value;
    design.controls.accent = $('#d-accent').value;
  }

  function currentBgType() {
    var active = document.querySelector('.bgtype-btn[data-active="true"]');
    return active ? active.dataset.bgtype : 'color';
  }
  function setBgType(type) {
    $$('.bgtype-btn').forEach(function (b) {
      var on = b.dataset.bgtype === type;
      b.setAttribute('data-active', on ? 'true' : 'false');
      b.classList.toggle('bg-[#19A975]', on);
      b.classList.toggle('text-white', on);
      b.classList.toggle('border-[#19A975]', on);
      b.classList.toggle('bg-white', !on);
      b.classList.toggle('text-slate-700', !on);
    });
    $('#bg-color-pane').classList.toggle('hidden', type !== 'color');
    $('#bg-image-pane').classList.toggle('hidden', type !== 'image');
    $('#bg-gradient-pane').classList.toggle('hidden', type !== 'gradient');
    design.background.type = type;
    updatePreview();
  }

  function updatePreview() {
    var bg = design.background;
    var pv = $('#bg-preview');
    var css = '';
    if (bg.type === 'image' && bg.imagePath) {
      css = 'url("' + window.publicPdfUrl(bg.imagePath) + '")';
    } else if (bg.type === 'image' && bgImageFile) {
      css = 'url("' + URL.createObjectURL(bgImageFile) + '")';
    } else if (bg.type === 'gradient' && bg.gradient) {
      css = bg.gradient;
    } else {
      css = $('#d-bg-color').value || bg.color || '#f1f5f9';
    }
    pv.style.background = css;
    pv.style.backgroundSize = bg.type === 'image'
      ? (bg.size === 'stretch' ? '100% 100%' : bg.size) : '';
    pv.style.backgroundPosition = bg.position || 'center';
    pv.style.backgroundRepeat = 'no-repeat';
    pv.style.opacity = String(Math.max(0, Math.min(100, parseInt($('#d-bg-transparency').value, 10) || 100)) / 100);
    pv.style.filter = 'blur(' + (parseInt($('#d-bg-blur').value, 10) || 0) + 'px)';
    /* The editor's live preview strip uses the same background. */
    var ep = document.getElementById('editor-preview');
    if (ep) {
      ep.style.background = css;
      ep.style.backgroundSize = pv.style.backgroundSize;
      ep.style.backgroundPosition = pv.style.backgroundPosition;
      ep.style.backgroundRepeat = 'no-repeat';
    }
    $('#d-bg-transparency-val').textContent = $('#d-bg-transparency').value + '%';
    $('#d-bg-blur-val').textContent = $('#d-bg-blur').value + 'px';
    $('#d-bg-color-hex').textContent = $('#d-bg-color').value;
    $('#d-accent-hex').textContent = $('#d-accent').value;
  }

  function fillForm() {
    $('#d-title').value = book.title || '';
    $('#d-subtitle').value = design.subtitle || '';
    $('#d-description').value = design.description || '';
    $('#d-show-titles').checked = design.showTitles !== false;
    $('#d-view-mode').value = design.viewMode || 'magazine';
    renderTocItems();
    var bg = design.background;
    $('#d-bg-color').value = bg.color || '#f1f5f9';
    $('#d-bg-size').value = bg.size || 'cover';
    $('#d-bg-position').value = bg.position || 'center';
    $('#d-bg-transparency').value = String(bg.transparency == null ? 100 : bg.transparency);
    $('#d-bg-blur').value = String(bg.blur || 0);
    $('#d-bg-image-name').textContent = bg.imagePath ? 'Current image saved.' : 'No image chosen.';
    $$('input[data-show]').forEach(function (cb) {
      cb.checked = design.controls.show[cb.dataset.show] !== false;
    });
    $('#d-btn-size').value = design.controls.size || 'medium';
    $('#d-accent').value = design.controls.accent || '#19A975';
    var a = design.backgroundAudio || {};
    $('#design-audio-enabled').checked = a.enabled === true;
    $('#design-flip-sound').checked = design.flipSound !== false;
    updateAudioLabel();
    setBgType(bg.type || 'color');
    updatePreview();
  }

  function buildSwatches() {
    var wrap = $('#bg-swatches');
    COLOR_SWATCHES.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'h-9 w-9 rounded-lg border border-slate-300';
      b.style.background = c;
      b.title = c;
      b.setAttribute('aria-label', 'Background color ' + c);
      b.addEventListener('click', function () {
        $('#d-bg-color').value = c;
        design.background.color = c;
        updatePreview();
      });
      wrap.appendChild(b);
    });
    var gwrap = $('#bg-gradients');
    GRADIENTS.forEach(function (g) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'h-9 w-16 rounded-lg border border-slate-300';
      b.style.background = g;
      b.title = g;
      b.setAttribute('aria-label', 'Background gradient');
      b.addEventListener('click', function () {
        design.background.gradient = g;
        updatePreview();
      });
      gwrap.appendChild(b);
    });
  }

  async function load() {
    if (!id) { showError('No flipbook selected.'); return; }
    user = await window.currentUser();
    if (!user) { window.location.href = 'auth.html'; return; }
    if (!window.fbClient) { showError('Supabase is not configured yet.'); return; }
    try {
      var res = await window.fbClient
        .from('flipbooks')
        .select('id,title,file_path,page_count,user_id')
        .eq('id', id).eq('user_id', user.id)
        .maybeSingle();
      if (res.error) throw res.error;
      book = res.data;
      if (!book) { showError('This flipbook does not exist or is not yours.'); return; }
      $('#design-for').textContent = 'For "' + book.title + '" · ' + (book.page_count || 0) + ' pages';
      $('#design-view').href = 'viewer.html?id=' + book.id;
      var shareSide = document.getElementById('design-share');
      if (shareSide) shareSide.href = 'viewer.html?id=' + book.id;
      var settingsLink = document.getElementById('header-settings-link');
      if (settingsLink) { settingsLink.href = 'settings.html?id=' + book.id; settingsLink.classList.remove('hidden'); }
      ['nav-settings', 'nav-lead', 'nav-replace', 'nav-copy'].forEach(function (navId) {
        var el = document.getElementById(navId);
        if (el) el.href = 'settings.html?id=' + book.id;
      });
      /* Existing design sidecar, if the owner saved one before. */
      try {
        var url = window.publicPdfUrl(designPath());
        var r = await fetch(url, { cache: 'no-store' });
        if (r.ok) {
          var saved = await r.json();
          if (saved && typeof saved === 'object') {
            design.subtitle = saved.subtitle || '';
            design.description = saved.description || '';
            if (typeof saved.showTitles === 'boolean') design.showTitles = saved.showTitles;
            if (saved.viewMode) design.viewMode = saved.viewMode;
            if (saved.backgroundAudio) Object.assign(design.backgroundAudio, saved.backgroundAudio);
            if (typeof saved.flipSound === 'boolean') design.flipSound = saved.flipSound;
            if (saved.background) Object.assign(design.background, saved.background);
            if (saved.controls) {
              if (saved.controls.show) Object.assign(design.controls.show, saved.controls.show);
              if (saved.controls.size) design.controls.size = saved.controls.size;
              if (saved.controls.accent) design.controls.accent = saved.controls.accent;
            }
          }
        }
      } catch (e) { /* no saved design yet — defaults stand */ }
      buildSwatches();
      fillForm();
      $('#design-form').classList.remove('hidden');
      showSection('sec-title'); /* Title is the card shown first. */
      renderPreview();
    } catch (err) {
      showError('Could not load this flipbook: ' + (err.message || 'unknown error'));
    }
  }

  /* ---- Live preview: the book's first page on the design background. ---- */
  async function renderPreview() {
    var canvas = document.getElementById('preview-canvas');
    var empty = document.getElementById('preview-empty');
    if (!canvas || !book || !window.pdfjsLib) return;
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
      var pdf = await window.pdfjsLib.getDocument(window.publicPdfUrl(book.file_path)).promise;
      var page = await pdf.getPage(1);
      var viewport = page.getViewport({ scale: 0.5 });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
      if (empty) empty.classList.add('hidden');
      canvas.classList.remove('hidden');
    } catch (e) {
      if (empty) empty.textContent = 'Preview unavailable.';
    }
  }

  async function save(e) {
    e.preventDefault();
    var status = $('#design-status');
    var saveBtn = $('#design-save');
    readForm();
    saveBtn.disabled = true;
    status.textContent = 'Saving…';
    try {
      /* New background image, if one was chosen. */
      if (bgImageFile) {
        var ext = (bgImageFile.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
        var path = bgImagePath(ext);
        var up = await window.fbClient.storage
          .from(window.fbConfig.BUCKET || 'pdfs')
          .upload(path, bgImageFile, { upsert: true, contentType: bgImageFile.type || 'image/png' });
        if (up.error) throw up.error;
        design.background.imagePath = path;
        design.background.type = 'image';
      }
      /* Design sidecar (JSON). */
      var blob = new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' });
      var upDesign = await window.fbClient.storage
        .from(window.fbConfig.BUCKET || 'pdfs')
        .upload(designPath(), blob, { upsert: true, contentType: 'application/json' });
      if (upDesign.error) throw upDesign.error;
      /* Title lives on the flipbooks row too. */
      var newTitle = $('#d-title').value.trim();
      if (newTitle && newTitle !== book.title) {
        var upd = await window.fbClient.from('flipbooks')
          .update({ title: newTitle }).eq('id', book.id).eq('user_id', user.id);
        if (upd.error) throw upd.error;
        book.title = newTitle;
        $('#design-for').textContent = 'For "' + book.title + '" · ' + (book.page_count || 0) + ' pages';
      }
      bgImageFile = null;
      bgImageRemoved = false;
      status.textContent = 'Design saved.';
      showToast('Design saved.');
      updatePreview();
    } catch (err) {
      status.textContent = '';
      showToast('Save failed: ' + (err.message || 'unknown error'), 'error');
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ---- Sidebar panels: only the section whose button was clicked is
     shown (Heyzine editor) — the rest stay hidden until picked. ---- */
  function showSection(sectionId) {
    $$('.editor-section').forEach(function (sec) {
      sec.classList.toggle('hidden', sec.id !== sectionId);
    });
    $$('.editor-nav-btn').forEach(function (b) {
      var on = b.dataset.section === sectionId;
      b.classList.toggle('bg-[#19A975]', on);
      b.classList.toggle('text-white', on);
      b.classList.toggle('bg-white', !on);
      b.classList.toggle('text-slate-700', !on);
      var icon = b.querySelector('span');
      if (icon) {
        icon.classList.toggle('text-white', on);
        icon.classList.toggle('text-[#19A975]', !on);
      }
    });
  }

  /* ---- Wire up ---- */
  /* Sidebar nav: pop up the matching section card. */
  $$('.editor-nav-btn').forEach(function (b) {
    b.addEventListener('click', function () { showSection(b.dataset.section); });
  });
  /* Sidebar Save triggers the same save as the form button. */
  var saveSide = document.getElementById('design-save-side');
  if (saveSide) saveSide.addEventListener('click', function () {
    var form = document.getElementById('design-form');
    if (form) form.requestSubmit();
  });
  var headerSignout = document.getElementById('header-signout');
  if (headerSignout) headerSignout.addEventListener('click', async function () {
    if (window.fbClient) await window.fbClient.auth.signOut();
    window.location.href = 'index.html';
  });
  $$('.bgtype-btn').forEach(function (b) {
    b.addEventListener('click', function () { setBgType(b.dataset.bgtype); });
  });
  ['d-bg-color', 'd-bg-size', 'd-bg-position', 'd-bg-transparency', 'd-bg-blur', 'd-accent']
    .forEach(function (idName) {
      var el = document.getElementById(idName);
      if (el) el.addEventListener('input', updatePreview);
    });
  $('#d-bg-image').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!f.type || f.type.indexOf('image/') !== 0) { showToast('Choose an image file.', 'error'); return; }
    bgImageFile = f;
    bgImageRemoved = false;
    $('#d-bg-image-name').textContent = f.name + ' — will upload on Save.';
    setBgType('image');
  });
  $('#d-bg-image-remove').addEventListener('click', function () {
    bgImageFile = null;
    bgImageRemoved = true;
    design.background.imagePath = '';
    $('#d-bg-image').value = '';
    $('#d-bg-image-name').textContent = 'Image removed — save to apply.';
    updatePreview();
  });
  /* ---- F10 Background audio: upload / remove (saves the sidecar too). ---- */
  async function saveSidecar() {
    var blob = new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' });
    var up = await window.fbClient.storage
      .from(window.fbConfig.BUCKET || 'pdfs')
      .upload(designPath(), blob, { upsert: true, contentType: 'application/json' });
    if (up.error) throw up.error;
  }
  $('#design-audio-upload').addEventListener('click', async function () {
    var file = $('#design-audio-file').files[0];
    var status = $('#design-audio-status');
    if (!file) { status.textContent = 'Choose an audio file first.'; return; }
    if (!file.type || file.type.indexOf('audio/') !== 0) { status.textContent = 'That file is not audio.'; return; }
    status.textContent = 'Uploading…';
    try {
      var ext = (file.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
      var path = audioPath(ext);
      var up = await window.fbClient.storage
        .from(window.fbConfig.BUCKET || 'pdfs')
        .upload(path, file, { upsert: true, contentType: file.type || 'audio/mpeg' });
      if (up.error) throw up.error;
      if (!design.backgroundAudio) design.backgroundAudio = {};
      design.backgroundAudio.path = path;
      design.backgroundAudio.enabled = $('#design-audio-enabled').checked;
      design.flipSound = $('#design-flip-sound').checked;
      await saveSidecar();
      updateAudioLabel();
      status.textContent = 'Audio uploaded.';
      showToast('Audio uploaded.', 'success');
    } catch (e) {
      status.textContent = 'Upload failed: ' + (e.message || e);
      showToast('Audio upload failed.', 'error');
    }
  });
  $('#design-audio-remove').addEventListener('click', async function () {
    var status = $('#design-audio-status');
    if (!design.backgroundAudio) design.backgroundAudio = {};
    var oldPath = design.backgroundAudio.path;
    design.backgroundAudio.path = '';
    design.backgroundAudio.enabled = false;
    $('#design-audio-enabled').checked = false;
    $('#design-audio-file').value = '';
    try {
      await saveSidecar();
      if (oldPath) {
        await window.fbClient.storage.from(window.fbConfig.BUCKET || 'pdfs').remove([oldPath]);
      }
      updateAudioLabel();
      status.textContent = 'Audio removed.';
      showToast('Audio removed.', 'success');
    } catch (e) {
      status.textContent = 'Remove failed: ' + (e.message || e);
      showToast('Audio remove failed.', 'error');
    }
  });
  $('#design-form').addEventListener('submit', save);
  $('#toc-add').addEventListener('click', function () {
    collectToc();
    if (!Array.isArray(design.toc)) design.toc = [];
    design.toc.push({ title: '', page: 1 });
    renderTocItems();
    var last = document.querySelector('#toc-items .toc-title:last-of-type');
    if (last) last.focus();
  });

  document.addEventListener('DOMContentLoaded', load);
})();
