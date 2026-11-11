/* Reader core + navigation: PDF.js rendering, spreads, thumbnails,
   zoom, fullscreen, and a page slider. Cover shows alone; the rest
   shows as two-page spreads on wide screens, one page at a time on
   narrow screens. */
(function () {
  'use strict';

  var id = getQueryParam('id');
  var book = null;
  var pdf = null;
  var totalPages = 0;
  var viewIndex = 0;
  var views = [];
  var rendering = false;
  var pendingRender = false;
  var resizeTimer = null;
  var sliderTimer = null;
  var zoom = 1;
  var thumbsOpen = false;
  var thumbCache = {};

  var titleEl = document.getElementById('viewer-title');
  var labelEl = document.getElementById('page-label');
  var loadingEl = document.getElementById('loading');
  var errorEl = document.getElementById('error');
  var errorTextEl = document.getElementById('error-text');
  var stageEl = document.getElementById('stage');
  var stageInnerEl = document.getElementById('stage-inner');
  var toolbarEl = document.getElementById('toolbar');
  var controlsEl = document.getElementById('controls');
  var hintEl = document.getElementById('hint');
  var prevBtn = document.getElementById('btn-prev');
  var nextBtn = document.getElementById('btn-next');
  var sliderEl = document.getElementById('page-slider');
  var thumbsBtn = document.getElementById('btn-thumbs');
  var thumbsPanel = document.getElementById('thumbs-panel');
  var thumbsList = document.getElementById('thumbs-list');
  var zoomOutBtn = document.getElementById('btn-zoom-out');
  var zoomInBtn = document.getElementById('btn-zoom-in');
  var zoomFitBtn = document.getElementById('btn-zoom-fit');
  var zoomLabel = document.getElementById('zoom-label');
  var fullscreenBtn = document.getElementById('btn-fullscreen');

  function showError(message) {
    loadingEl.classList.add('hidden');
    stageEl.classList.add('hidden');
    toolbarEl.classList.add('hidden');
    controlsEl.classList.add('hidden');
    hintEl.classList.add('hidden');
    thumbsPanel.classList.add('hidden');
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

  /* Render the current view. If a render is already running, remember
     that the newest view still needs drawing instead of dropping it. */
  async function renderView() {
    if (rendering) { pendingRender = true; return; }
    if (!pdf) return;
    rendering = true;
    var pages = currentPages();
    stageInnerEl.innerHTML = '';
    stageEl.classList.remove('hidden');
    try {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var gap = pages.length > 1 ? 8 : 0;
      var maxW = stageEl.clientWidth || window.innerWidth - 32;
      var maxH = window.innerHeight - 260;
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
      var fit = Math.min(maxW / totalW, maxH / maxPageH, 2);
      var scale = fit * zoom;
      for (var j = 0; j < infos.length; j++) {
        var info = infos[j];
        var canvas = document.createElement('canvas');
        canvas.className = 'bg-white shadow-md';
        canvas.width = Math.round(info.width * scale * dpr);
        canvas.height = Math.round(info.height * scale * dpr);
        canvas.style.width = Math.round(info.width * scale) + 'px';
        canvas.style.height = Math.round(info.height * scale) + 'px';
        if (j > 0) canvas.style.marginLeft = gap + 'px';
        stageInnerEl.appendChild(canvas);
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
      if (pendingRender) { pendingRender = false; renderView(); return; }
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
    sliderEl.value = String(first);
    sliderEl.max = String(totalPages);
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
    zoomOutBtn.disabled = zoom <= 0.5;
    zoomInBtn.disabled = zoom >= 3;
    var hash = '#page/' + first;
    if (window.location.hash !== hash) history.replaceState(null, '', hash);
    document.title = (book ? book.title + ' — ' : '') + 'Flipbook Reference';
    highlightThumb();
  }

  function goToView(index) {
    if (index < 0 || index >= views.length || index === viewIndex) return;
    viewIndex = index;
    renderView();
  }

  function goToPage(page) {
    goToView(viewForPage(Math.min(Math.max(page, 1), totalPages)));
  }

  function next() { goToView(viewIndex + 1); }
  function prev() { goToView(viewIndex - 1); }

  /* ---- Zoom ---- */
  function setZoom(nextZoom) {
    zoom = Math.min(3, Math.max(0.5, nextZoom));
    renderView();
  }
  zoomOutBtn.addEventListener('click', function () { setZoom(zoom - 0.25); });
  zoomInBtn.addEventListener('click', function () { setZoom(zoom + 0.25); });
  zoomFitBtn.addEventListener('click', function () { setZoom(1); });

  /* ---- Fullscreen ---- */
  function updateFullscreenBtn() {
    fullscreenBtn.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  }
  fullscreenBtn.addEventListener('click', function () {
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    }
  });
  document.addEventListener('fullscreenchange', function () {
    updateFullscreenBtn();
    setTimeout(renderView, 100);
  });

  /* ---- Thumbnails ---- */
  function toggleThumbs() {
    thumbsOpen = !thumbsOpen;
    thumbsBtn.setAttribute('aria-expanded', String(thumbsOpen));
    thumbsPanel.classList.toggle('hidden', !thumbsOpen);
    if (thumbsOpen) renderThumbs();
  }
  thumbsBtn.addEventListener('click', toggleThumbs);

  async function renderThumbs() {
    if (!pdf) return;
    thumbsList.innerHTML = '';
    var jobs = [];
    for (var n = 1; n <= totalPages; n++) {
      jobs.push((function (pageNum) {
        return thumbFor(pageNum).then(function (src) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'thumb-btn group rounded-lg border border-slate-200 bg-white p-1 text-left hover:border-emerald-500';
          btn.dataset.page = String(pageNum);
          btn.setAttribute('aria-label', 'Go to page ' + pageNum);
          var img = document.createElement('img');
          img.src = src;
          img.alt = 'Page ' + pageNum;
          img.className = 'w-full rounded';
          var cap = document.createElement('span');
          cap.className = 'mt-1 block text-center text-xs text-slate-500';
          cap.textContent = 'Page ' + pageNum;
          btn.appendChild(img); btn.appendChild(cap);
          btn.addEventListener('click', function () { goToPage(pageNum); });
          return btn;
        });
      })(n));
    }
    var buttons = await Promise.all(jobs);
    buttons.forEach(function (b) { thumbsList.appendChild(b); });
    highlightThumb();
  }

  async function thumbFor(pageNum) {
    if (thumbCache[pageNum]) return thumbCache[pageNum];
    var pg = await pdf.getPage(pageNum);
    var vp = pg.getViewport({ scale: 1 });
    var scale = 140 / vp.width;
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width * scale);
    canvas.height = Math.round(vp.height * scale);
    await pg.render({
      canvasContext: canvas.getContext('2d'),
      viewport: pg.getViewport({ scale: scale })
    }).promise;
    thumbCache[pageNum] = canvas.toDataURL('image/png');
    return thumbCache[pageNum];
  }

  function highlightThumb() {
    var pages = currentPages();
    var btns = thumbsList.querySelectorAll('.thumb-btn');
    btns.forEach(function (btn) {
      var on = pages.indexOf(parseInt(btn.dataset.page, 10)) !== -1;
      btn.classList.toggle('ring-2', on);
      btn.classList.toggle('ring-emerald-500', on);
      btn.classList.toggle('border-emerald-500', on);
    });
  }

  /* ---- Slider ---- */
  sliderEl.addEventListener('input', function () {
    var target = parseInt(sliderEl.value, 10) || 1;
    labelEl.textContent = 'Page ' + target + ' of ' + totalPages;
    clearTimeout(sliderTimer);
    sliderTimer = setTimeout(function () { goToPage(target); }, 120);
  });

  /* ---- Prev / next / keys / resize ---- */
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
      toolbarEl.classList.remove('hidden');
      controlsEl.classList.remove('hidden');
      controlsEl.classList.add('flex');
      hintEl.classList.remove('hidden');
      sliderEl.max = String(totalPages);
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
