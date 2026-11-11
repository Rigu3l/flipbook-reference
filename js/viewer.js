/* Reader core + navigation + viewer modes: PDF.js rendering, spreads,
   thumbnails, zoom, fullscreen, page slider, and five view modes —
   Magazine (page flip), Slider, Fade, Coverflow, One page.
   Cover shows alone; spreads show pairs on wide screens, one page at
   a time on narrow screens. */
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
  var mode = 'magazine';
  var turnDir = null;
  var coverBuilt = false;
  var coverCards = {};

  var titleEl = document.getElementById('viewer-title');
  var labelEl = document.getElementById('page-label');
  var loadingEl = document.getElementById('loading');
  var errorEl = document.getElementById('error');
  var errorTextEl = document.getElementById('error-text');
  var stageEl = document.getElementById('stage');
  var stageInnerEl = document.getElementById('stage-inner');
  var coverflowEl = document.getElementById('coverflow');
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
  var modeSelect = document.getElementById('mode-select');

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

  function isSpreadMode() {
    return (mode === 'magazine' || mode === 'fade') && !isSingleMode();
  }

  /* Views: cover alone, then pairs in spread modes; one page at a
     time in slider / coverflow / one-page modes. */
  function buildViews() {
    var list = [];
    if (!isSpreadMode()) {
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

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /* Render the current view. If a render is already running, remember
     that the newest view still needs drawing instead of dropping it. */
  async function renderView(fromIndex) {
    if (rendering) { pendingRender = true; return; }
    if (!pdf) return;
    rendering = true;
    try {
      if (mode === 'coverflow') {
        stageInnerEl.classList.add('hidden');
        coverflowEl.classList.remove('hidden');
        await renderCoverflow();
      } else if (mode === 'magazine' && turnDir) {
        coverflowEl.classList.add('hidden');
        stageInnerEl.classList.remove('hidden');
        var dir = turnDir; turnDir = null;
        var flipped = false;
        try { flipped = await flipTurn(dir, fromIndex); } catch (e) { flipped = false; }
        if (!flipped) {
          stageInnerEl.classList.add('fade-out');
          await sleep(180);
          await drawSpread();
          stageInnerEl.classList.remove('fade-out');
        }
      } else {
        coverflowEl.classList.add('hidden');
        stageInnerEl.classList.remove('hidden');
        /* Page-turn animation: the old view moves out, the new view
           is drawn underneath, then the stage eases back to rest. */
        var animClass = null;
        if (turnDir) {
          if (mode === 'slider') animClass = 'slide-' + turnDir;
          else if (mode === 'fade') animClass = 'fade-out';
        }
        if (animClass) {
          stageInnerEl.classList.add(animClass);
          await sleep(180);
        }
        await drawSpread();
        if (animClass) stageInnerEl.classList.remove(animClass);
      }
    } catch (err) {
      showError('Could not render this flipbook: ' + (err.message || 'unknown error'));
      return;
    } finally {
      rendering = false;
      turnDir = null;
      if (pendingRender) { pendingRender = false; renderView(); return; }
    }
    updateChrome();
  }

  /* Load page dimensions (no rendering yet). */
  async function loadPageInfos(pages) {
    var infos = [];
    for (var i = 0; i < pages.length; i++) {
      var pg = await pdf.getPage(pages[i]);
      var vp = pg.getViewport({ scale: 1 });
      infos.push({ page: pg, width: vp.width, height: vp.height });
    }
    return infos;
  }

  function fitScaleFor(infos, count) {
    var maxW = stageEl.clientWidth || window.innerWidth - 32;
    var maxH = window.innerHeight - 260;
    var totalW = 0, maxPageH = 0;
    for (var i = 0; i < infos.length; i++) {
      totalW += infos[i].width;
      if (infos[i].height > maxPageH) maxPageH = infos[i].height;
    }
    return Math.min(maxW / totalW, maxH / maxPageH, 2);
  }

  function renderPageCanvas(info, scale) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var canvas = document.createElement('canvas');
    canvas.className = 'bg-white shadow-md';
    canvas.width = Math.round(info.width * scale * dpr);
    canvas.height = Math.round(info.height * scale * dpr);
    canvas.style.width = Math.round(info.width * scale) + 'px';
    canvas.style.height = Math.round(info.height * scale) + 'px';
    return info.page.render({
      canvasContext: canvas.getContext('2d'),
      viewport: info.page.getViewport({ scale: scale * dpr })
    }).promise.then(function () { return canvas; });
  }

  function cloneResampled(src, cssW, cssH) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var c = document.createElement('canvas');
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    c.style.width = cssW + 'px';
    c.style.height = cssH + 'px';
    c.getContext('2d').drawImage(src, 0, 0, src.width, src.height, 0, 0, c.width, c.height);
    return c;
  }

  async function drawSpread() {
    var pages = currentPages();
    stageInnerEl.innerHTML = '';
    stageEl.classList.remove('hidden');
    var infos = await loadPageInfos(pages);
    var scale = fitScaleFor(infos, pages.length) * zoom;
    for (var j = 0; j < infos.length; j++) {
      var canvas = await renderPageCanvas(infos[j], scale);
      stageInnerEl.appendChild(canvas);
    }
    /* The two pages of a spread meet at the spine — no gap between
       them (the old 8px gap showed the background through the fold,
       so the gap opened, closed during the turn, and opened again).
       The spine shadow keeps the center fold readable. */
    if (pages.length > 1) {
      var spine = document.createElement('div');
      spine.className = 'flip-spine';
      spine.style.left = 'calc(50% - 13px)';
      spine.style.top = '0';
      spine.style.bottom = '0';
      stageInnerEl.appendChild(spine);
    }
  }

  /* ---- Realistic page turn (Magazine mode) ----
     The turning page is a card: its front is the page you are
     leaving, its back is the page you are turning to. It rotates
     around the spine with perspective, revealing the next spread
     underneath — the way a real page peels over. */
  async function flipTurn(dir, fromIndex) {
    var fromPages = views[fromIndex] || [];
    var toPages = currentPages();
    if (!fromPages.length || !toPages.length) return false;
    var isNext = dir === 'next';
    /* In single-page (narrow) mode, moving from an even page to the
       next odd page only crosses the spread — there is no page to
       turn, so let the caller fall back to a fade. */
    if (fromPages.length === 1) {
      var fp = fromPages[0];
      if (isNext && fp % 2 === 0) return false;
      if (!isNext && fp % 2 === 1) return false;
    }
    /* Odd pages are right pages, even pages are left pages. */
    function slots(pages) {
      if (pages.length === 2) return { left: pages[0], right: pages[1] };
      var n = pages[0];
      return n % 2 === 1 ? { left: null, right: n } : { left: n, right: null };
    }
    var from = slots(fromPages), to = slots(toPages);
    /* Base = [page staying on the left, page revealed on the right];
       card front = page leaving, card back = page arriving. */
    var cardFrontPage, cardBackPage, baseLeftPage, baseRightPage;
    if (isNext) {
      cardFrontPage = from.right; cardBackPage = to.left;
      baseLeftPage = from.left; baseRightPage = to.right;
    } else {
      cardFrontPage = to.right; cardBackPage = from.left;
      baseLeftPage = to.left; baseRightPage = from.right;
    }
    if (!cardFrontPage || !cardBackPage) return false;
    var toInfos = await loadPageInfos(toPages);
    var scale = fitScaleFor(toInfos, toPages.length) * zoom;
    var pw = Math.round(toInfos[0].width * scale);
    var ph = Math.round(toInfos[0].height * scale);
    /* A long perspective distance keeps the turn from stretching the
       page vertically mid-flight (a short one magnifies the near edge
       by 40%+ and the page looks taller than the book). */
    var persp = Math.round(pw * 12);
    function cardTF(rot, settlePx) {
      var t = 'perspective(' + persp + 'px) rotateY(' + rot + 'deg)';
      if (settlePx) t += ' translateX(' + settlePx + 'px)';
      return t;
    }
    /* Re-center the stage so the overlay lines up with the new view. */
    stageEl.scrollLeft = 0; stageEl.scrollTop = 0;
    var rect = stageEl.getBoundingClientRect();
    var SW = rect.width, SH = rect.height;
    var CX = SW / 2;
    var top = Math.max(0, Math.round((SH - ph) / 2));
    /* Fresh-render the arriving pages; clone the leaving pages from
       the stage (resampled to the new scale). */
    var toCanvas = {};
    await Promise.all(toPages.map(function (n) {
      var info = toInfos[toPages.indexOf(n)];
      return renderPageCanvas(info, scale).then(function (c) { toCanvas[n] = c; });
    }));
    var stageCanvases = stageInnerEl.querySelectorAll('canvas');
    async function canvasFor(pageNum, source) {
      if (!pageNum) return null;
      if (source === 'to') {
        if (toCanvas[pageNum]) return toCanvas[pageNum];
        var info = (await loadPageInfos([pageNum]))[0];
        var c = await renderPageCanvas(info, scale);
        toCanvas[pageNum] = c;
        return c;
      }
      var idx = fromPages.indexOf(pageNum);
      var src = stageCanvases[idx];
      if (src) return cloneResampled(src, pw, ph);
      var info2 = (await loadPageInfos([pageNum]))[0];
      return renderPageCanvas(info2, scale);
    }
    var cardFront, cardBack, baseLeft, baseRight;
    if (isNext) {
      cardFront = await canvasFor(from.right, 'from');
      cardBack = await canvasFor(to.left, 'to');
      baseLeft = await canvasFor(from.left, 'from');
      baseRight = await canvasFor(to.right, 'to');
    } else {
      cardFront = await canvasFor(to.right, 'to');
      cardBack = await canvasFor(from.left, 'from');
      baseLeft = await canvasFor(to.left, 'to');
      baseRight = await canvasFor(from.right, 'from');
    }
    if (!cardFront || !cardBack) return false;
    /* Overlay over the stage; the new view renders underneath it. */
    var overlay = document.createElement('div');
    overlay.className = 'flip-overlay';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = SW + 'px';
    overlay.style.height = SH + 'px';
    function place(canvas, x) {
      if (!canvas) return;
      canvas.classList.remove('bg-white', 'shadow-md');
      canvas.classList.add('flip-base-canvas');
      canvas.style.left = x + 'px';
      canvas.style.top = top + 'px';
      canvas.style.width = pw + 'px';
      canvas.style.height = ph + 'px';
      canvas.style.marginLeft = '0';
      overlay.appendChild(canvas);
    }
    place(baseLeft, CX - pw);
    place(baseRight, CX);
    var spine = document.createElement('div');
    spine.className = 'flip-spine';
    spine.style.left = (CX - 13) + 'px';
    spine.style.top = top + 'px';
    spine.style.height = ph + 'px';
    overlay.appendChild(spine);
    var card = document.createElement('div');
    card.className = 'flip-card';
    card.style.left = CX + 'px';
    card.style.top = top + 'px';
    card.style.width = pw + 'px';
    card.style.height = ph + 'px';
    cardFront.classList.remove('bg-white', 'shadow-md');
    cardBack.classList.remove('bg-white', 'shadow-md');
    cardFront.classList.add('flip-face');
    cardBack.classList.add('flip-face', 'flip-back');
    card.appendChild(cardFront);
    card.appendChild(cardBack);
    overlay.appendChild(card);
    var stageRender = drawSpread();
    document.body.appendChild(overlay);
    try {
      var startRot = isNext ? 0 : -180;
      var endRot = isNext ? -180 : 0;
      card.style.transform = cardTF(startRot);
      void overlay.offsetWidth;
      /* The label, slider and URL track the destination from the
         moment the turn starts, not after it lands. */
      updateChrome();
      card.style.transform = cardTF(endRot);
      await sleep(650);
      /* Settle: when the new view is a single page, slide the card to
         the centered position and fade out the old page it leaves. */
      if (toPages.length === 1) {
        var leaving = isNext ? baseLeft : baseRight;
        if (leaving) leaving.style.opacity = '0';
        card.style.transition = 'transform .15s ease';
        card.style.transform = cardTF(endRot, -pw / 2);
        await sleep(170);
      }
      await stageRender;
    } finally {
      overlay.remove();
    }
    return true;
  }

  /* Coverflow: every page rendered once at a fixed height, laid out
     as a strip with the current page centered, neighbors angled and
     smaller. Clicking a neighbor centers it. */
  async function renderCoverflow() {
    stageEl.classList.remove('hidden');
    if (!coverBuilt) {
      coverflowEl.innerHTML = '';
      coverCards = {};
      var jobs = [];
      for (var n = 1; n <= totalPages; n++) {
        jobs.push((function (pageNum) {
          return (async function () {
            var pg = await pdf.getPage(pageNum);
            var vp = pg.getViewport({ scale: 1 });
            var scale = 320 / vp.height;
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(vp.width * scale);
            canvas.height = Math.round(vp.height * scale);
            await pg.render({
              canvasContext: canvas.getContext('2d'),
              viewport: pg.getViewport({ scale: scale })
            }).promise;
            var card = document.createElement('div');
            card.className = 'cf-card';
            card.dataset.page = String(pageNum);
            card.appendChild(canvas);
            card.addEventListener('click', function () { goToPage(pageNum); });
            coverflowEl.appendChild(card);
            coverCards[pageNum] = card;
          })();
        })(n));
      }
      await Promise.all(jobs);
      coverBuilt = true;
    }
    updateCoverTransforms();
  }

  function updateCoverTransforms() {
    var current = (currentPages()[0] || 1);
    for (var n = 1; n <= totalPages; n++) {
      var card = coverCards[n];
      if (!card) continue;
      var off = n - current;
      var abs = Math.abs(off);
      var x = off * 170;
      var rot = off === 0 ? 0 : (off < 0 ? 38 : -38);
      var s = off === 0 ? 1 : (abs === 1 ? 0.75 : 0.55);
      card.style.transform =
        'translate(-50%, -50%) translateX(' + x + 'px) rotateY(' + rot + 'deg) scale(' + s + ')';
      card.style.opacity = abs > 2 ? '0' : (abs === 2 ? '0.6' : '1');
      card.style.pointerEvents = abs > 2 ? 'none' : 'auto';
      card.style.zIndex = String(10 - abs);
    }
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
    var cf = mode === 'coverflow';
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
    zoomOutBtn.disabled = cf || zoom <= 0.5;
    zoomInBtn.disabled = cf || zoom >= 3;
    zoomFitBtn.disabled = cf;
    var hash = '#page/' + first;
    if (window.location.hash !== hash) history.replaceState(null, '', hash);
    document.title = (book ? book.title + ' — ' : '') + 'Flipbook Reference';
    highlightThumb();
  }

  function goToView(index, dir) {
    if (index < 0 || index >= views.length || index === viewIndex) return;
    var from = viewIndex;
    turnDir = dir || (index > viewIndex ? 'next' : 'prev');
    viewIndex = index;
    renderView(from);
  }

  function goToPage(page) {
    goToView(viewForPage(Math.min(Math.max(page, 1), totalPages)));
  }

  function next() { goToView(viewIndex + 1, 'next'); }
  function prev() { goToView(viewIndex - 1, 'prev'); }

  /* ---- Viewer modes ---- */
  function loadMode() {
    try {
      var saved = localStorage.getItem('fb-mode-' + id);
      if (saved && modeSelect.querySelector('option[value="' + saved + '"]')) return saved;
    } catch (e) { /* storage unavailable; fall through */ }
    return 'magazine';
  }

  function setMode(nextMode) {
    if (nextMode === mode) return;
    var page = (currentPages()[0] || 1);
    mode = nextMode;
    modeSelect.value = nextMode;
    try { localStorage.setItem('fb-mode-' + id, nextMode); } catch (e) { /* ignore */ }
    if (mode === 'coverflow') zoom = 1;
    views = buildViews();
    viewIndex = viewForPage(page);
    turnDir = null;
    renderView();
  }
  modeSelect.addEventListener('change', function () { setMode(modeSelect.value); });

  /* ---- Zoom ---- */
  function setZoom(nextZoom) {
    if (mode === 'coverflow') return;
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
      mode = loadMode();
      modeSelect.value = mode;
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
