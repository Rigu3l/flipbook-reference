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
  var dragState = { active: false, startX: 0, dir: null };
  var coverBuilt = false;
  var coverCards = {};
  /* StPageFlip book (Magazine mode, same library + config as Manuazine). */
  var pageFlip = null;
  var pageImages = [];
  var pageRendered = [];
  var pdfAspect = 733 / 550;
  var bookUsesBlank = false;
  var blankImage = null;
  var bookSingleWidth = 0;
  var bookIsDesktop = false;
  var allRendered = false;
  var restRendering = false;

  var titleEl = document.getElementById('viewer-title');
  var labelEl = document.getElementById('page-label');
  var loadingEl = document.getElementById('loading');
  var errorEl = document.getElementById('error');
  var errorTextEl = document.getElementById('error-text');
  var stageEl = document.getElementById('stage');
  var stageInnerEl = document.getElementById('stage-inner');
  var bookWrapEl = document.getElementById('book-wrap');
  var bookEl = document.getElementById('book');
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
        bookWrapEl.classList.add('hidden');
        stageInnerEl.classList.add('hidden');
        coverflowEl.classList.remove('hidden');
        await renderCoverflow();
      } else if (mode === 'magazine') {
        /* StPageFlip book (same as Manuazine). Turns are driven by
           the library; its 'flip' event keeps the label in sync. */
        stageEl.classList.remove('hidden');
        stageInnerEl.classList.add('hidden');
        coverflowEl.classList.add('hidden');
        bookWrapEl.classList.remove('hidden');
        turnDir = null;
        await initStPageFlip();
        var target = (currentPages()[0] || 1);
        var shown = stCurrentPage();
        if (shown !== target) {
          try { pageFlip.turnToPage(libraryIndexForPage(target)); } catch (e) {}
        }
        applyCoverMode();
      } else {
        bookWrapEl.classList.add('hidden');
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
      /* Hover hint + tap/slide to turn: a right (odd) page turns forward,
         a left (even) page turns back — only when a view exists that way.
         A tap turns in the page's direction; a slide over 30px turns in
         the slide direction (slide left = forward, slide right = back). */
      var n = pages[j];
      var turnDir = null;
      if (n % 2 === 1 && viewIndex < views.length - 1) turnDir = 'next';
      else if (n % 2 === 0 && viewIndex > 0) turnDir = 'prev';
      if (turnDir) {
        canvas.classList.add(turnDir === 'next' ? 'page-turn-next' : 'page-turn-prev');
        /* pointerdown only records the grab; the window-level pointerup
           finishes it, so a slide that ends off the page still turns. */
        (function (dir) {
          canvas.addEventListener('pointerdown', function (e) {
            dragState.active = true; dragState.startX = e.clientX; dragState.dir = dir;
            e.preventDefault();
          });
        })(turnDir);
      }
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

  /* ---- StPageFlip book (Magazine mode, same library + config as
     Manuazine) ----
     The book is built from page images (data URLs) rendered by PDF.js.
     Pages render progressively: the current spread first, the rest in
     the background; unrendered pages show a white placeholder so the
     book can open before every page is ready. */

  function placeholderImage() {
    var canvas = document.createElement('canvas');
    canvas.width = 550;
    canvas.height = Math.round(550 * pdfAspect);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  async function renderPageImage(pageNum) {
    if (pageRendered[pageNum - 1] || !pdf) return pageImages[pageNum - 1];
    try {
      var pg = await pdf.getPage(pageNum);
      var vp = pg.getViewport({ scale: 1 });
      var scale = Math.min(2, 1100 / vp.width);
      var scaled = pg.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(scaled.width);
      canvas.height = Math.round(scaled.height);
      await pg.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;
      pageImages[pageNum - 1] = canvas.toDataURL('image/png');
      pageRendered[pageNum - 1] = true;
      return pageImages[pageNum - 1];
    } catch (err) {
      return pageImages[pageNum - 1];
    }
  }

  async function renderAround(center) {
    var order = [];
    for (var d = 0; d <= 2; d++) {
      if (center + d <= totalPages) order.push(center + d);
      if (d > 0 && center - d >= 1) order.push(center - d);
    }
    for (var i = 0; i < order.length; i++) await renderPageImage(order[i]);
    if (!allRendered) renderRestInBackground();
  }

  async function renderRestInBackground() {
    if (restRendering || allRendered) return;
    restRendering = true;
    for (var i = 1; i <= totalPages; i++) {
      if (!pageRendered[i - 1]) await renderPageImage(i);
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    if (!allRendered) {
      allRendered = true;
      if (pageFlip) {
        try { pageFlip.updateFromImages(libraryImages()); } catch (e) {}
      }
    }
    restRendering = false;
  }

  /* First and last page shown alone (cover / back cover), spreads in
     between. StPageFlip's showCover does the first page alone, and the
     last page alone only when the total is even. For an odd total we
     insert one blank "inside cover" page after the cover (desktop
     only); the mapping helpers translate between real PDF pages and
     the library's image list. On mobile every page is already single
     (portrait), so no blank is inserted. */
  function libraryImages() {
    if (!bookUsesBlank) return pageImages.slice();
    if (!blankImage) blankImage = placeholderImage();
    var out = pageImages.slice();
    out.splice(1, 0, blankImage);
    return out;
  }
  function libraryIndexForPage(realPage) {
    if (!bookUsesBlank) return realPage - 1;
    return realPage === 1 ? 0 : realPage;
  }
  function realPageForLibraryIndex(idx) {
    if (!bookUsesBlank) return idx + 1;
    if (idx === 0) return 1;
    if (idx === 1) return 2;
    return idx;
  }

  /* Hide the empty half of a single-page spread. The library always
     draws a double-width book, so a cover spread is cover-on-the-right
     + white-on-the-left, and a back-cover spread is back-on-the-left +
     white-on-the-right. Clip the wrapper to one page wide and slide
     the book inside it: cover -> right half only, back page -> left
     half only. The wrapper stays centered, so the single page ends up
     centered with no white half. */
  function applyCoverMode() {
    if (!bookWrapEl || !bookEl || !pageFlip || !bookIsDesktop || !bookSingleWidth) return;
    var current = (currentPages()[0] || 1);
    if (current === 1 && totalPages > 1) {
      bookWrapEl.style.width = bookSingleWidth + 'px';
      bookWrapEl.style.overflow = 'hidden';
      bookEl.style.marginLeft = (-bookSingleWidth) + 'px';
    } else if (current === totalPages && totalPages > 1) {
      bookWrapEl.style.width = bookSingleWidth + 'px';
      bookWrapEl.style.overflow = 'hidden';
      bookEl.style.marginLeft = '0px';
    } else {
      bookWrapEl.style.width = (bookSingleWidth * 2) + 'px';
      bookWrapEl.style.overflow = '';
      bookEl.style.marginLeft = '0px';
    }
  }

  function getPageFlipConstructor() {
    if (window.St && window.St.PageFlip) return window.St.PageFlip;
    if (window.StPageFlip && window.StPageFlip.PageFlip) return window.StPageFlip.PageFlip;
    return null;
  }

  function stCurrentPage() {
    if (!pageFlip) return (currentPages()[0] || 1);
    try { return realPageForLibraryIndex(pageFlip.getCurrentPageIndex()); }
    catch (e) { return (currentPages()[0] || 1); }
  }

  async function initStPageFlip() {
    /* Already created: just swap in the rendered images. */
    if (pageFlip) {
      try { pageFlip.updateFromImages(libraryImages()); } catch (err) {}
      applyCoverMode();
      return;
    }
    var PageFlipCtor = getPageFlipConstructor();
    if (!PageFlipCtor) {
      showError('Page-flip library did not load. Reload the page.');
      return;
    }
    /* Read the PDF's true page shape from page 1 so pages are not
       stretched (an A4 page is 1.414, not 1.333). */
    try {
      var pg1 = await pdf.getPage(1);
      var vp1 = pg1.getViewport({ scale: 1 });
      if (vp1.width) pdfAspect = vp1.height / vp1.width;
    } catch (e) {}
    var isMobile = window.innerWidth < 768;
    bookUsesBlank = !isMobile && totalPages > 1 && totalPages % 2 === 1;
    var stageWidth = Math.min(1200, stageEl.clientWidth || 900);
    var maxH = window.innerHeight - 260;
    var singleWidth = isMobile
      ? Math.min(stageWidth, window.innerWidth - 24)
      : Math.floor(stageWidth / 2);
    /* Fit the stage height too, so the whole page shows without
       scrolling (the canvas modes cap by height the same way). */
    var singleHeight = Math.round(singleWidth * pdfAspect);
    if (singleHeight > maxH) {
      singleHeight = maxH;
      singleWidth = Math.round(singleHeight / pdfAspect);
    }
    singleWidth = Math.round(singleWidth * zoom);
    singleHeight = Math.round(singleWidth * pdfAspect);
    bookSingleWidth = singleWidth;
    bookIsDesktop = !isMobile;
    /* Render the current spread first so the book opens on real pages,
       not placeholders; the rest render in the background. */
    var start = (currentPages()[0] || 1);
    await renderAround(start);
    /* Make sure #book exists (destroy() removes it from the DOM). */
    bookEl = document.getElementById('book');
    if (!bookEl || !bookEl.isConnected) {
      bookEl = document.createElement('div');
      bookEl.id = 'book';
      bookWrapEl.appendChild(bookEl);
    }
    bookEl.style.width = (isMobile ? singleWidth : singleWidth * 2) + 'px';
    bookEl.style.height = singleHeight + 'px';
    pageFlip = new PageFlipCtor(bookEl, {
      width: singleWidth,
      height: singleHeight,
      size: 'fixed',
      minWidth: 280,
      maxWidth: 1200,
      minHeight: 360,
      maxHeight: 1400,
      drawShadow: true,
      flippingTime: 700,
      usePortrait: isMobile,
      startPage: 0,
      autoSize: true,
      showCover: true,
      mobileScrollSupport: true,
      swipeDistance: 30,
      clickEventForward: true,
      useMouseEvents: true,
      showPageCorners: true,
      disableFlipByClick: false
    });
    pageFlip.loadFromImages(libraryImages());
    pageFlip.on('flip', function (e) {
      /* The library reports a 0-based library index; translate to a
         real PDF page (the blank inside-cover page is not a page). */
      var realPage = realPageForLibraryIndex(e.data || 0);
      viewIndex = viewForPage(realPage);
      renderAround(realPage);
      applyCoverMode();
      updateChrome();
    });
    /* Start on the current page (deep link / mode switch). */
    if (start > 1) {
      try { pageFlip.turnToPage(libraryIndexForPage(start)); } catch (err) {}
    }
    applyCoverMode();
  }

  /* Rebuild the book at the current size (zoom / resize / mode switch).
     Destroy is safe only here: destroy() removes the #book element, so
     we immediately create a fresh one and build on that. */
  function rebuildStPageFlip() {
    if (!pageFlip) return;
    var savedPage = stCurrentPage();
    try { pageFlip.destroy(); } catch (err) {}
    pageFlip = null;
    var fresh = document.createElement('div');
    fresh.id = 'book';
    bookWrapEl.appendChild(fresh);
    bookEl = fresh;
    viewIndex = viewForPage(savedPage);
    initStPageFlip();
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
    if (mode === 'magazine' && pageFlip) {
      /* StPageFlip turns the book; its 'flip' event updates the view. */
      var target = views[index][0];
      try { pageFlip.turnToPage(libraryIndexForPage(target)); } catch (e) {}
      return;
    }
    var from = viewIndex;
    turnDir = dir || (index > viewIndex ? 'next' : 'prev');
    viewIndex = index;
    renderView(from);
  }

  function goToPage(page) {
    goToView(viewForPage(Math.min(Math.max(page, 1), totalPages)));
  }

  function next() {
    /* Magazine: the library's animated flip (turnToPage jumps
       instantly with no animation — that was the dead buttons). */
    if (mode === 'magazine' && pageFlip) {
      try { pageFlip.flipNext(); } catch (e) {}
      return;
    }
    goToView(viewIndex + 1, 'next');
  }
  function prev() {
    if (mode === 'magazine' && pageFlip) {
      try { pageFlip.flipPrev(); } catch (e) {}
      return;
    }
    goToView(viewIndex - 1, 'prev');
  }

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
    if (nextMode === 'magazine' && pageFlip) rebuildStPageFlip();
    renderView();
  }
  modeSelect.addEventListener('change', function () { setMode(modeSelect.value); });

  /* ---- Zoom ---- */
  function setZoom(nextZoom) {
    if (mode === 'coverflow') return;
    zoom = Math.min(3, Math.max(0.5, nextZoom));
    if (mode === 'magazine') {
      rebuildStPageFlip();
      updateChrome();
      return;
    }
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
      if (mode === 'magazine') { rebuildStPageFlip(); return; }
      renderView();
    }, 200);
  });

  /* ---- Slide / tap to turn (finishes a grab started on a page) ---- */
  function endDrag(e) {
    if (!dragState.active) return;
    dragState.active = false;
    var dx = e.clientX - dragState.startX;
    if (Math.abs(dx) > 30) {
      if (dx < 0 && viewIndex < views.length - 1) goToView(viewIndex + 1, 'next');
      else if (dx > 0 && viewIndex > 0) goToView(viewIndex - 1, 'prev');
    } else if (dragState.dir === 'next') {
      goToView(viewIndex + 1, 'next');
    } else if (dragState.dir === 'prev') {
      goToView(viewIndex - 1, 'prev');
    }
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', function () { dragState.active = false; });

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
