/* Reader core: load a public flipbook, render it with PDF.js, and
   turn pages. Cover shows alone; the rest shows as two-page spreads
   on wide screens and one page at a time on narrow screens. */
(function () {
  'use strict';

  var id = getQueryParam('id');
  var book = null;
  var pdf = null;
  var totalPages = 0;
  var viewIndex = 0;
  var views = [];
  var rendering = false;
  var resizeTimer = null;

  var titleEl = document.getElementById('viewer-title');
  var labelEl = document.getElementById('page-label');
  var loadingEl = document.getElementById('loading');
  var errorEl = document.getElementById('error');
  var errorTextEl = document.getElementById('error-text');
  var stageEl = document.getElementById('stage');
  var controlsEl = document.getElementById('controls');
  var hintEl = document.getElementById('hint');
  var prevBtn = document.getElementById('btn-prev');
  var nextBtn = document.getElementById('btn-next');

  function showError(message) {
    loadingEl.classList.add('hidden');
    stageEl.classList.add('hidden');
    controlsEl.classList.add('hidden');
    hintEl.classList.add('hidden');
    errorTextEl.textContent = message;
    errorEl.classList.remove('hidden');
    titleEl.textContent = 'Flipbook unavailable';
  }

  /* Narrow screens read one page at a time; wide screens read spreads. */
  function isSingleMode() {
    return window.innerWidth < 768;
  }

  /* Views: cover alone, then pairs. A leftover last page shows alone. */
  function buildViews() {
    var list = [];
    if (isSingleMode()) {
      for (var p = 1; p <= totalPages; p++) list.push([p]);
      return list;
    }
    list.push([1]);
    for (var start = 2; start <= totalPages; start += 2) {
      if (start + 1 <= totalPages) list.push([start, start + 1]);
      else list.push([start]);
    }
    return list;
  }

  function currentPages() {
    return views[viewIndex] || [];
  }

  function viewForPage(page) {
    for (var i = 0; i < views.length; i++) {
      if (views[i].indexOf(page) !== -1) return i;
    }
    return 0;
  }

  async function renderView() {
    if (rendering || !pdf) return;
    rendering = true;
    var pages = currentPages();
    stageEl.innerHTML = '';
    stageEl.classList.remove('hidden');
    stageEl.classList.add('flex');
    try {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var gap = pages.length > 1 ? 8 : 0;
      var maxW = stageEl.clientWidth || window.innerWidth - 32;
      var maxH = window.innerHeight - 220;
      var infos = [];
      var totalW = 0;
      var maxPageH = 0;
      for (var i = 0; i < pages.length; i++) {
        var pg = await pdf.getPage(pages[i]);
        var vp = pg.getViewport({ scale: 1 });
        infos.push({ page: pg, width: vp.width, height: vp.height });
        totalW += vp.width;
        if (vp.height > maxPageH) maxPageH = vp.height;
      }
      totalW += gap * (pages.length - 1);
      var scale = Math.min(maxW / totalW, maxH / maxPageH, 2);
      for (var j = 0; j < infos.length; j++) {
        var info = infos[j];
        var canvas = document.createElement('canvas');
        canvas.className = 'bg-white shadow-md';
        canvas.width = Math.round(info.width * scale * dpr);
        canvas.height = Math.round(info.height * scale * dpr);
        canvas.style.width = Math.round(info.width * scale) + 'px';
        canvas.style.height = Math.round(info.height * scale) + 'px';
        if (j > 0) canvas.style.marginLeft = gap + 'px';
        stageEl.appendChild(canvas);
        var ctx = canvas.getContext('2d');
        await info.page.render({
          canvasContext: ctx,
          viewport: info.page.getViewport({ scale: scale * dpr })
        }).promise;
      }
    } catch (err) {
      showError('Could not render this flipbook: ' + (err.message || 'unknown error'));
      return;
    } finally {
      rendering = false;
    }
    updateChrome();
  }

  function updateChrome() {
    var pages = currentPages();
    var first = pages[0];
    var last = pages[pages.length - 1];
    labelEl.textContent = first === last
      ? 'Page ' + first + ' of ' + totalPages
      : 'Pages ' + first + '–' + last + ' of ' + totalPages;
    prevBtn.disabled = viewIndex <= 0 || rendering;
    nextBtn.disabled = viewIndex >= views.length - 1 || rendering;
    var hash = '#page/' + first;
    if (window.location.hash !== hash) history.replaceState(null, '', hash);
    document.title = (book ? book.title + ' — ' : '') + 'Flipbook Reference';
  }

  function goToView(index) {
    if (index < 0 || index >= views.length || index === viewIndex) return;
    viewIndex = index;
    renderView();
  }

  function next() { goToView(viewIndex + 1); }
  function prev() { goToView(viewIndex - 1); }

  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  });
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var page = currentPages()[0] || 1;
      views = buildViews();
      viewIndex = viewForPage(page);
      renderView();
    }, 200);
  });

  async function loadBook() {
    if (!id) { showError('No flipbook selected.'); return; }
    if (!window.fbClient) { showError('Supabase is not configured yet.'); return; }
    try {
      if (!window.pdfjsLib) throw new Error('PDF.js did not load. Check your connection and reload.');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
      var res = await window.fbClient
        .from('public_flipbooks')
        .select('id,title,file_path,page_count,views,has_password')
        .eq('id', id)
        .maybeSingle();
      if (res.error) throw res.error;
      book = res.data;
      if (!book) { showError('This flipbook does not exist or is not public.'); return; }
      if (book.has_password) {
        showError('This flipbook is password protected. Password entry arrives in F9.');
        return;
      }
      titleEl.textContent = book.title;
      var url = window.publicPdfUrl(book.file_path);
      pdf = await window.pdfjsLib.getDocument({ url: url }).promise;
      totalPages = pdf.numPages;
      views = buildViews();
      var startPage = 1;
      var m = (window.location.hash || '').match(/#page\/(\d+)/);
      if (m) startPage = Math.min(Math.max(parseInt(m[1], 10) || 1, 1), totalPages);
      viewIndex = viewForPage(startPage);
      loadingEl.classList.add('hidden');
      controlsEl.classList.remove('hidden');
      controlsEl.classList.add('flex');
      hintEl.classList.remove('hidden');
      renderView();
      /* Count the view. Fire and forget — a failure here must not
         block reading. */
      window.fbClient.rpc('increment_flipbook_views', { p_flipbook_id: id })
        .then(function () {}, function () {});
    } catch (err) {
      showError('Could not load this flipbook: ' + (err.message || 'unknown error'));
    }
  }

  document.addEventListener('DOMContentLoaded', loadBook);
})();
