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
  var firstBtn = document.getElementById('btn-first');
  var lastBtn = document.getElementById('btn-last');
  var sliderEl = document.getElementById('page-slider');
  var thumbsBtn = document.getElementById('btn-thumbs');
  var thumbsPanel = document.getElementById('thumbs-panel');
  var thumbsList = document.getElementById('thumbs-list');
  var tocBtn = document.getElementById('btn-toc');
  var tocPanel = document.getElementById('toc-panel');
  var tocList = document.getElementById('toc-list');
  var bookmarksList = document.getElementById('bookmarks-list');
  var searchBtn = document.getElementById('btn-search');
  var searchPanel = document.getElementById('search-panel');
  var searchInput = document.getElementById('search-input');
  var searchResults = document.getElementById('search-results');
  var searchStatus = document.getElementById('search-status');
  var bookmarkBtn = document.getElementById('btn-bookmark');
  var zoomOutBtn = document.getElementById('btn-zoom-out');
  var zoomInBtn = document.getElementById('btn-zoom-in');
  var zoomFitBtn = document.getElementById('btn-zoom-fit');
  var zoomLabel = document.getElementById('zoom-label');
  var fullscreenBtn = document.getElementById('btn-fullscreen');
  var shareBtn = document.getElementById('btn-share');
  var modeSelect = document.getElementById('mode-select');
  var bgLayerEl = document.getElementById('bg-layer');
  var bookMetaEl = document.getElementById('book-meta');
  var bookSubtitleEl = document.getElementById('book-subtitle');
  var bookDescEl = document.getElementById('book-description');

  /* ---- F5 design (per-book settings, saved by the owner in the
     design editor). Stored as a JSON sidecar in Storage next to the
     PDF: {user_id}/{flipbook_id}.design.json — public read, so any
     viewer sees the owner's design; no table migration needed. */
  var design = null;
  function designDefaults() {
    return {
      subtitle: '', description: '', showTitles: true,
      toc: [],
      interactions: [],
      leadForm: { enabled: false },
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
        size: 'medium', accent: '#059669'
      }
    };
  }
  function designPath() {
    if (!book) return '';
    var userPart = (book.file_path || '').split('/')[0] || '';
    return userPart + '/' + book.id + '.design.json';
  }
  async function loadDesign() {
    design = designDefaults();
    if (!book) return;
    try {
      var url = window.publicPdfUrl(designPath());
      if (!url) return;
      var res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return; /* no design saved yet — defaults stand */
      var saved = await res.json();
      if (saved && typeof saved === 'object') {
        design.subtitle = saved.subtitle || '';
        design.description = saved.description || '';
        if (typeof saved.showTitles === 'boolean') design.showTitles = saved.showTitles;
        if (Array.isArray(saved.toc)) design.toc = saved.toc;
        if (Array.isArray(saved.interactions)) design.interactions = saved.interactions;
        if (saved.leadForm && typeof saved.leadForm === 'object') design.leadForm = saved.leadForm;
        if (saved.backgroundAudio && typeof saved.backgroundAudio === 'object') design.backgroundAudio = saved.backgroundAudio;
        if (typeof saved.flipSound === 'boolean') design.flipSound = saved.flipSound;
        if (saved.background) Object.assign(design.background, saved.background);
        if (saved.controls) {
          if (saved.controls.show) Object.assign(design.controls.show, saved.controls.show);
          if (saved.controls.size) design.controls.size = saved.controls.size;
          if (saved.controls.accent) design.controls.accent = saved.controls.accent;
        }
      }
    } catch (e) { /* unreadable design — defaults stand */ }
  }
  function applyDesign() {
    if (!design) design = designDefaults();
    var bg = design.background;
    var show = design.controls.show;
    /* Background layer behind the book. */
    if (bgLayerEl) {
      var bgCss = '';
      if (bg.type === 'image' && bg.imagePath) {
        bgCss = 'url("' + window.publicPdfUrl(bg.imagePath) + '")';
      } else if (bg.type === 'gradient' && bg.gradient) {
        bgCss = bg.gradient;
      } else {
        bgCss = bg.color || '#f1f5f9';
      }
      bgLayerEl.style.background = bgCss;
      bgLayerEl.style.backgroundSize = bg.type === 'image'
        ? (bg.size === 'stretch' ? '100% 100%' : bg.size) : '';
      bgLayerEl.style.backgroundPosition = bg.position || 'center';
      bgLayerEl.style.backgroundRepeat = 'no-repeat';
      bgLayerEl.style.opacity = String(Math.max(0, Math.min(100, bg.transparency || 100)) / 100);
      bgLayerEl.style.filter = (bg.blur ? 'blur(' + Math.max(0, Math.min(20, bg.blur)) + 'px)' : '');
      bgLayerEl.classList.remove('hidden');
    }
    /* Titles on the background. */
    if (bookMetaEl) {
      var showMeta = design.showTitles && (design.subtitle || design.description);
      bookMetaEl.classList.toggle('hidden', !showMeta);
      bookSubtitleEl.textContent = design.subtitle || '';
      bookSubtitleEl.classList.toggle('hidden', !design.subtitle);
      bookDescEl.textContent = design.description || '';
      bookDescEl.classList.toggle('hidden', !design.description);
    }
    /* Controls show / hide. */
    if (fullscreenBtn) fullscreenBtn.classList.toggle('hidden', !show.fullscreen);
    if (shareBtn) shareBtn.classList.toggle('hidden', show.share === false);
    var downloadTab = document.querySelector('[data-sharetab="download"]');
    if (downloadTab) downloadTab.classList.toggle('hidden', show.download === false);
    var printTab = document.querySelector('[data-sharetab="print"]');
    if (printTab) printTab.classList.toggle('hidden', show.print === false);
    var zoomVisible = show.zoom;
    if (zoomOutBtn) zoomOutBtn.classList.toggle('hidden', !zoomVisible);
    if (zoomInBtn) zoomInBtn.classList.toggle('hidden', !zoomVisible);
    if (zoomFitBtn) zoomFitBtn.classList.toggle('hidden', !zoomVisible);
    if (zoomLabel) zoomLabel.classList.toggle('hidden', !zoomVisible);
    if (thumbsBtn) thumbsBtn.classList.toggle('hidden', !show.thumbnails);
    if (tocBtn) tocBtn.classList.toggle('hidden', show.toc === false);
    if (searchBtn) searchBtn.classList.toggle('hidden', show.search === false);
    if (bookmarkBtn) bookmarkBtn.classList.toggle('hidden', show.bookmarks === false);
    if (prevBtn) prevBtn.classList.toggle('hidden', !show.prevNext);
    if (nextBtn) nextBtn.classList.toggle('hidden', !show.prevNext);
    if (firstBtn) firstBtn.classList.toggle('hidden', !show.firstPage);
    if (lastBtn) lastBtn.classList.toggle('hidden', !show.lastPage);
    /* Button size + accent color. */
    var sizeCls = design.controls.size === 'small' ? 'px-3 py-1.5 text-sm'
      : design.controls.size === 'large' ? 'px-6 py-3 text-base' : '';
    [prevBtn, nextBtn, firstBtn, lastBtn].forEach(function (b) {
      if (!b) return;
      b.classList.remove('px-3', 'py-1.5', 'text-sm', 'px-6', 'py-3', 'text-base');
      if (sizeCls) sizeCls.split(' ').forEach(function (c) { b.classList.add(c); });
    });
    if (nextBtn && design.controls.accent) {
      nextBtn.style.backgroundColor = design.controls.accent;
      nextBtn.style.borderColor = design.controls.accent;
    }
    if (sliderEl && design.controls.accent) sliderEl.style.accentColor = design.controls.accent;
    setupAudio();
  }

  /* ---- F10 Audio: background music (loop) + page-turn sound. ---- */
  var soundBtn = document.getElementById('btn-sound');
  var soundOn = false; /* user gesture required before any sound plays */
  var bgAudioEl = null;
  var flipCtx = null;
  function playFlipSound() {
    if (!soundOn || design.flipSound === false) return;
    try {
      if (!flipCtx) flipCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (flipCtx.state === 'suspended') flipCtx.resume();
      var dur = 0.15;
      var buf = flipCtx.createBuffer(1, Math.floor(flipCtx.sampleRate * dur), flipCtx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      var src = flipCtx.createBufferSource();
      src.buffer = buf;
      var filter = flipCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1200;
      filter.Q.value = 1;
      var gain = flipCtx.createGain();
      gain.gain.value = 0.12;
      src.connect(filter); filter.connect(gain); gain.connect(flipCtx.destination);
      src.start();
    } catch (e) { /* audio is best-effort */ }
  }
  function setupAudio() {
    var a = design.backgroundAudio || {};
    if (bgAudioEl) { bgAudioEl.pause(); bgAudioEl = null; }
    if (a.enabled && a.path) {
      bgAudioEl = new Audio(window.publicPdfUrl(a.path));
      bgAudioEl.loop = true;
      bgAudioEl.preload = 'auto';
      bgAudioEl.volume = 0.5;
    }
    updateSoundBtn();
  }
  function updateSoundBtn() {
    if (!soundBtn) return;
    soundBtn.textContent = soundOn ? 'Sound on' : 'Sound off';
    soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  }
  function setSound(on) {
    soundOn = on;
    if (bgAudioEl) {
      if (on) { bgAudioEl.play().catch(function () {}); }
      else bgAudioEl.pause();
    }
    updateSoundBtn();
  }
  if (soundBtn) {
    soundBtn.addEventListener('click', function () { setSound(!soundOn); });
  }
  /* Browsers block audio until the reader interacts — start the
     background music on the first click/tap anywhere in the viewer. */
  document.addEventListener('pointerdown', function onFirstGesture() {
    if (soundOn) return;
    var a = design.backgroundAudio || {};
    if (a.enabled && a.path && bgAudioEl) setSound(true);
    else if (design.flipSound !== false) { soundOn = true; updateSoundBtn(); }
    document.removeEventListener('pointerdown', onFirstGesture);
  });

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
     time in slider / coverflow / one-page modes.
     Magazine on desktop with an ODD total matches StPageFlip, which
     inserts a blank inside-cover page after the cover: page 2 sits
     alone (paired with the blank), then pairs from 3, and the last
     page sits alone. Without this the views drift one page behind
     the library — the label says "Pages 2–3" while only page 2
     shows, Next seems dead, and the last page lands in a spread
     instead of alone. Fade has no blank page, so it keeps the
     plain pairing. */
  function buildViews() {
    var list = [];
    if (!isSpreadMode()) {
      for (var p = 1; p <= totalPages; p++) list.push([p]);
      return list;
    }
    list.push([1]);
    if (mode === 'magazine' && !isSingleMode() && totalPages > 1 && totalPages % 2 === 1) {
      list.push([2]);
      for (var start = 3; start <= totalPages; start += 2) {
        if (start + 1 <= totalPages) list.push([start, start + 1]);
        else list.push([start]);
      }
      return list;
    }
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
    renderHotspots();
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
      /* Each page is wrapped so interaction hotspots can be positioned
         over it (percentages of the page). */
      var wrap = document.createElement('div');
      wrap.className = 'page-wrap relative shrink-0';
      wrap.dataset.page = String(pages[j]);
      wrap.appendChild(canvas);
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
      stageInnerEl.appendChild(wrap);
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
      renderHotspots();
      playFlipSound();
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
    if (firstBtn) firstBtn.disabled = viewIndex <= 0 || rendering;
    if (lastBtn) lastBtn.disabled = viewIndex >= views.length - 1 || rendering;
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
    updateBookmarkBtn();
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
    playFlipSound();
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
  function closeThumbs() {
    thumbsOpen = false;
    if (thumbsBtn) thumbsBtn.setAttribute('aria-expanded', 'false');
    thumbsPanel.classList.add('hidden');
  }
  function toggleThumbs() {
    thumbsOpen = !thumbsOpen;
    thumbsBtn.setAttribute('aria-expanded', String(thumbsOpen));
    thumbsPanel.classList.toggle('hidden', !thumbsOpen);
    if (thumbsOpen) { renderThumbs(); if (tocOpen) toggleToc(false); }
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

  /* ---- Prev / next / first / last / keys / resize ---- */
  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);
  firstBtn.addEventListener('click', function () { goToPage(1); });
  lastBtn.addEventListener('click', function () { goToPage(totalPages); });
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

  /* ---- F6 Share dialog: Link, Embed, Download, Print, QR code,
     Email, Social, Image (cover). ---- */
  var shareModal = document.getElementById('share-modal');
  var shareTabBtns = Array.prototype.slice.call(document.querySelectorAll('.share-tab'));
  var sharePanes = Array.prototype.slice.call(document.querySelectorAll('.share-pane'));

  function viewerUrl(page) {
    var base = window.location.href.split('#')[0];
    return base + '#page/' + (page || (currentPages()[0] || 1));
  }
  function copyText(text, statusEl, msg) {
    function done() { if (statusEl) statusEl.textContent = msg || 'Copied.'; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }
  function setShareTab(name) {
    shareTabBtns.forEach(function (b) {
      var on = b.dataset.sharetab === name;
      b.classList.toggle('bg-emerald-600', on);
      b.classList.toggle('text-white', on);
      b.classList.toggle('text-slate-700', !on);
    });
    sharePanes.forEach(function (p) {
      p.classList.toggle('hidden', p.id !== 'share-pane-' + name);
    });
    if (name === 'qr') renderQr();
    if (name === 'image') renderCoverImage();
    if (name === 'embed') buildEmbedCode();
  }
  function buildEmbedCode() {
    var w = parseInt(document.getElementById('embed-width').value, 10) || 330;
    var h = parseInt(document.getElementById('embed-height').value, 10) || 400;
    var responsive = document.getElementById('embed-responsive').checked;
    var border = document.getElementById('embed-border').checked;
    var openPage = parseInt(document.getElementById('embed-open-page').value, 10) || 1;
    var url = viewerUrl(openPage);
    var style = (responsive ? 'width:100%;' : 'width:' + w + 'px;') +
      'height:' + h + 'px;' + (border ? 'border:1px solid #ddd;' : 'border:0;');
    var code = '<iframe src="' + url + '" width="' + (responsive ? '100%' : w) +
      '" height="' + h + '" style="' + style + '" frameborder="0" allowfullscreen></iframe>';
    document.getElementById('embed-code').value = code;
    return code;
  }
  function renderQr() {
    var box = document.getElementById('share-qr');
    if (!box || !window.qrcode) return;
    try {
      var qr = window.qrcode(0, 'M');
      qr.addData(viewerUrl(1));
      qr.make();
      var dataUrl = qr.createDataURL(6, 8);
      box.innerHTML = '';
      var img = document.createElement('img');
      img.src = dataUrl;
      img.alt = 'QR code for this flipbook';
      img.className = 'h-48 w-48';
      box.appendChild(img);
      var dl = document.getElementById('share-qr-download');
      if (dl) dl.href = dataUrl;
    } catch (e) { box.textContent = 'Could not generate the QR code.'; }
  }
  async function renderCoverImage() {
    var img = document.getElementById('share-cover-img');
    var dl = document.getElementById('share-cover-download');
    if (!img || !pdf) return;
    try {
      var pg = await pdf.getPage(1);
      var vp = pg.getViewport({ scale: 1 });
      var scale = Math.min(2, 600 / vp.width);
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width * scale);
      canvas.height = Math.round(vp.height * scale);
      await pg.render({ canvasContext: canvas.getContext('2d'), viewport: pg.getViewport({ scale: scale }) }).promise;
      var dataUrl = canvas.toDataURL('image/png');
      img.src = dataUrl;
      if (dl) { dl.href = dataUrl; dl.download = (book ? book.title : 'flipbook') + '-cover.png'; }
    } catch (e) { /* leave the placeholder */ }
  }
  async function printBook() {
    if (!pdf) return;
    var pages = currentPages();
    var win = window.open('', '_blank');
    if (!win) { showToast('Allow pop-ups to print.', 'error'); return; }
    win.document.write('<html><head><title>' + escapeHtml(book ? book.title : 'Flipbook') +
      '</title><style>body{margin:0}img{width:100%;page-break-after:always;display:block}</style></head><body></body></html>');
    win.document.close();
    for (var i = 0; i < pages.length; i++) {
      try {
        var pg = await pdf.getPage(pages[i]);
        var vp = pg.getViewport({ scale: 1 });
        var scale = Math.min(2, 1000 / vp.width);
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width * scale);
        canvas.height = Math.round(vp.height * scale);
        await pg.render({ canvasContext: canvas.getContext('2d'), viewport: pg.getViewport({ scale: scale }) }).promise;
        var img = win.document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        win.document.body.appendChild(img);
      } catch (e) { /* skip a page that fails to render */ }
    }
    win.focus();
    setTimeout(function () { win.print(); }, 300);
  }
  function openShare() {
    if (!book) return;
    var url = viewerUrl(1);
    document.getElementById('share-link-input').value = url;
    document.getElementById('share-link-status').textContent = '';
    document.getElementById('embed-status').textContent = '';
    /* Embed "Open in" page list. */
    var sel = document.getElementById('embed-open-page');
    sel.innerHTML = '';
    for (var n = 1; n <= totalPages; n++) {
      var opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = n === 1 ? 'First page' : 'Page ' + n;
      sel.appendChild(opt);
    }
    sel.value = String(currentPages()[0] || 1);
    /* Download (original PDF). */
    var dl = document.getElementById('share-download-btn');
    dl.href = window.publicPdfUrl(book.file_path);
    dl.download = (book.title || 'flipbook') + '.pdf';
    /* Email + social. */
    var encUrl = encodeURIComponent(url);
    var encTitle = encodeURIComponent(book.title || 'Flipbook');
    document.getElementById('share-email-btn').href =
      'mailto:?subject=' + encTitle + '&body=' + encUrl;
    document.getElementById('share-fb').href = 'https://www.facebook.com/sharer/sharer.php?u=' + encUrl;
    document.getElementById('share-x').href = 'https://twitter.com/intent/tweet?url=' + encUrl + '&text=' + encTitle;
    document.getElementById('share-linkedin').href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encUrl;
    document.getElementById('share-whatsapp').href = 'https://wa.me/?text=' + encTitle + '%20' + encUrl;
    buildEmbedCode();
    /* Default to the first visible tab. */
    var firstVisible = shareTabBtns.find(function (b) { return !b.classList.contains('hidden'); });
    setShareTab(firstVisible ? firstVisible.dataset.sharetab : 'link');
    shareModal.classList.remove('hidden');
    shareModal.classList.add('flex');
  }
  function closeShare() {
    shareModal.classList.add('hidden');
    shareModal.classList.remove('flex');
  }
  if (shareBtn) shareBtn.addEventListener('click', openShare);
  var shareClose = document.getElementById('share-close');
  if (shareClose) shareClose.addEventListener('click', closeShare);
  shareModal.addEventListener('click', function (e) { if (e.target === shareModal) closeShare(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !shareModal.classList.contains('hidden')) closeShare();
  });
  shareTabBtns.forEach(function (b) {
    b.addEventListener('click', function () { setShareTab(b.dataset.sharetab); });
  });
  document.getElementById('share-link-copy').addEventListener('click', function () {
    copyText(document.getElementById('share-link-input').value,
      document.getElementById('share-link-status'), 'Link copied.');
  });
  ['embed-width', 'embed-height', 'embed-open-page'].forEach(function (idName) {
    document.getElementById(idName).addEventListener('input', buildEmbedCode);
    document.getElementById(idName).addEventListener('change', buildEmbedCode);
  });
  ['embed-responsive', 'embed-border'].forEach(function (idName) {
    document.getElementById(idName).addEventListener('change', buildEmbedCode);
  });
  document.getElementById('embed-copy').addEventListener('click', function () {
    copyText(buildEmbedCode(), document.getElementById('embed-status'), 'Embed code copied.');
  });
  document.getElementById('share-print-btn').addEventListener('click', printBook);

  /* ---- F7 TOC (index list), bookmarks, in-book search. ---- */
  var tocOpen = false;
  var searchOpen = false;
  var pageTextCache = {};
  var tocTab = 'contents';

  function bookmarkKey() { return 'fb-bookmarks-' + (book ? book.id : ''); }
  function loadBookmarks() {
    try { return JSON.parse(localStorage.getItem(bookmarkKey()) || '[]'); }
    catch (e) { return []; }
  }
  function saveBookmarks(list) {
    try { localStorage.setItem(bookmarkKey(), JSON.stringify(list)); } catch (e) {}
  }
  function updateBookmarkBtn() {
    if (!bookmarkBtn) return;
    var on = loadBookmarks().indexOf(currentPages()[0] || 1) !== -1;
    bookmarkBtn.setAttribute('aria-pressed', String(on));
    bookmarkBtn.classList.toggle('bg-amber-100', on);
    bookmarkBtn.classList.toggle('border-amber-400', on);
  }
  function renderToc() {
    var items = (design && Array.isArray(design.toc)) ? design.toc : [];
    tocList.innerHTML = '';
    if (!items.length) {
      tocList.innerHTML = '<p class="text-sm text-slate-500">No contents yet. The owner can add index items from the Design panel.</p>';
      return;
    }
    items.slice().sort(function (a, b) { return (a.page || 1) - (b.page || 1); }).forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100';
      var title = document.createElement('span');
      title.className = 'min-w-0 flex-1 truncate';
      title.textContent = item.title || ('Page ' + item.page);
      var pg = document.createElement('span');
      pg.className = 'shrink-0 text-xs text-slate-400';
      pg.textContent = 'p. ' + item.page;
      btn.appendChild(title);
      btn.appendChild(pg);
      btn.addEventListener('click', function () { goToPage(item.page || 1); toggleToc(false); });
      tocList.appendChild(btn);
    });
  }
  function renderBookmarks() {
    var list = loadBookmarks().slice().sort(function (a, b) { return a - b; });
    bookmarksList.innerHTML = '';
    if (!list.length) {
      bookmarksList.innerHTML = '<p class="text-sm text-slate-500">No bookmarks yet. Tap Bookmark on any page to save it here.</p>';
      return;
    }
    list.forEach(function (pageNum) {
      var row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'min-w-0 flex-1 truncate text-left';
      btn.textContent = 'Page ' + pageNum;
      btn.addEventListener('click', function () { goToPage(pageNum); toggleToc(false); });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'shrink-0 rounded px-2 py-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Remove bookmark for page ' + pageNum);
      del.addEventListener('click', function () {
        saveBookmarks(loadBookmarks().filter(function (n) { return n !== pageNum; }));
        renderBookmarks();
        updateBookmarkBtn();
      });
      row.appendChild(btn);
      row.appendChild(del);
      bookmarksList.appendChild(row);
    });
  }
  function setTocTab(tab) {
    tocTab = tab;
    document.getElementById('toc-tab-contents').classList.toggle('bg-emerald-600', tab === 'contents');
    document.getElementById('toc-tab-contents').classList.toggle('text-white', tab === 'contents');
    document.getElementById('toc-tab-bookmarks').classList.toggle('bg-emerald-600', tab === 'bookmarks');
    document.getElementById('toc-tab-bookmarks').classList.toggle('text-white', tab === 'bookmarks');
    tocList.classList.toggle('hidden', tab !== 'contents');
    bookmarksList.classList.toggle('hidden', tab !== 'bookmarks');
    if (tab === 'contents') renderToc(); else renderBookmarks();
  }
  function toggleToc(force) {
    tocOpen = (typeof force === 'boolean') ? force : !tocOpen;
    if (tocBtn) tocBtn.setAttribute('aria-expanded', String(tocOpen));
    tocPanel.classList.toggle('hidden', !tocOpen);
    if (tocOpen) { setTocTab(tocTab); closeThumbs(); }
  }
  function toggleBookmark() {
    var pageNum = currentPages()[0] || 1;
    var list = loadBookmarks();
    var idx = list.indexOf(pageNum);
    if (idx === -1) list.push(pageNum); else list.splice(idx, 1);
    saveBookmarks(list);
    updateBookmarkBtn();
    if (tocOpen && tocTab === 'bookmarks') renderBookmarks();
    showToast(idx === -1 ? 'Bookmarked page ' + pageNum + '.' : 'Bookmark removed.', 'success');
  }
  async function pageText(pageNum) {
    if (pageTextCache[pageNum]) return pageTextCache[pageNum];
    var pg = await pdf.getPage(pageNum);
    var tc = await pg.getTextContent();
    var text = tc.items.map(function (it) { return it.str; }).join(' ');
    pageTextCache[pageNum] = text;
    return text;
  }
  var searchTimer = null;
  function runSearch(query) {
    clearTimeout(searchTimer);
    var q = (query || '').trim();
    searchResults.innerHTML = '';
    if (!q) { searchStatus.textContent = ''; return; }
    searchStatus.textContent = 'Searching…';
    searchTimer = setTimeout(async function () {
      var lower = q.toLowerCase();
      var hits = [];
      for (var n = 1; n <= totalPages; n++) {
        try {
          var text = await pageText(n);
          var idx = text.toLowerCase().indexOf(lower);
          if (idx !== -1) {
            var start = Math.max(0, idx - 40);
            var end = Math.min(text.length, idx + q.length + 60);
            hits.push({ page: n, snippet: (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '') });
          }
        } catch (e) { /* skip a page that fails */ }
      }
      searchResults.innerHTML = '';
      if (!hits.length) {
        searchStatus.textContent = 'No matches for "' + q + '".';
        return;
      }
      searchStatus.textContent = hits.length + (hits.length === 1 ? ' match' : ' matches') + ' for "' + q + '".';
      hits.forEach(function (hit) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-emerald-500';
        var pg = document.createElement('span');
        pg.className = 'block text-xs font-semibold text-emerald-700';
        pg.textContent = 'Page ' + hit.page;
        var sn = document.createElement('span');
        sn.className = 'mt-0.5 block text-sm text-slate-600';
        sn.textContent = hit.snippet;
        btn.appendChild(pg);
        btn.appendChild(sn);
        btn.addEventListener('click', function () { goToPage(hit.page); toggleSearch(false); });
        searchResults.appendChild(btn);
      });
    }, 300);
  }
  function toggleSearch(force) {
    searchOpen = (typeof force === 'boolean') ? force : !searchOpen;
    if (searchBtn) searchBtn.setAttribute('aria-expanded', String(searchOpen));
    searchPanel.classList.toggle('hidden', !searchOpen);
    if (searchOpen) searchInput.focus();
  }
  if (tocBtn) tocBtn.addEventListener('click', function () { toggleToc(); });
  document.getElementById('toc-tab-contents').addEventListener('click', function () { setTocTab('contents'); });
  document.getElementById('toc-tab-bookmarks').addEventListener('click', function () { setTocTab('bookmarks'); });
  if (bookmarkBtn) bookmarkBtn.addEventListener('click', toggleBookmark);
  if (searchBtn) searchBtn.addEventListener('click', function () { toggleSearch(); });
  document.getElementById('search-close').addEventListener('click', function () { toggleSearch(false); });
  searchInput.addEventListener('input', function () { runSearch(searchInput.value); });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && searchResults.firstChild) searchResults.firstChild.click();
    if (e.key === 'Escape') toggleSearch(false);
  });

  /* ---- F8 Interactions: hotspots on the current view + popup actions. ---- */
  var hotspotLayer = document.getElementById('hotspot-layer');
  var iaModal = document.getElementById('ia-modal');
  var iaModalTitle = document.getElementById('ia-modal-title');
  var iaModalBody = document.getElementById('ia-modal-body');

  function hotspotDiv(it) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'hotspot';
    el.style.left = (it.x * 100) + '%';
    el.style.top = (it.y * 100) + '%';
    el.style.width = (it.w * 100) + '%';
    el.style.height = (it.h * 100) + '%';
    el.setAttribute('aria-label', 'Interaction: ' + it.type);
    if (it.highlight || (it.type === 'link' && it.highlight)) el.classList.add('hotspot-highlight');
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      runInteraction(it);
    });
    return el;
  }
  function renderHotspots() {
    /* Clear old hotspots (both the page wraps and the magazine layer). */
    Array.prototype.slice.call(document.querySelectorAll('.hotspot')).forEach(function (el) { el.remove(); });
    if (!design || !Array.isArray(design.interactions) || !design.interactions.length) return;
    var pages = currentPages();
    var list = design.interactions.filter(function (it) { return pages.indexOf(it.page) !== -1; });
    if (!list.length) return;
    if (mode === 'magazine') {
      /* Hotspots live in the layer over #book-wrap. Single page: the
         visible page fills the wrap. Spread: first page left, second
         page right (each singleWidth wide). */
      if (!bookWrapEl || !bookSingleWidth) return;
      var wrapW = bookWrapEl.offsetWidth;
      var wrapH = bookWrapEl.offsetHeight;
      list.forEach(function (it) {
        var idx = pages.indexOf(it.page);
        var x0 = (pages.length === 1) ? 0 : (idx === 0 ? 0 : bookSingleWidth);
        var el = hotspotDiv(it);
        el.style.left = (x0 + it.x * bookSingleWidth) + 'px';
        el.style.top = (it.y * wrapH) + 'px';
        el.style.width = (it.w * bookSingleWidth) + 'px';
        el.style.height = (it.h * wrapH) + 'px';
        el.style.position = 'absolute';
        hotspotLayer.appendChild(el);
      });
    } else if (mode === 'coverflow') {
      /* Hotspots only on the centered (current) page's card. */
      var card = document.querySelector('.cf-card[data-page="' + (currentPages()[0] || 1) + '"]');
      if (!card) return;
      list.forEach(function (it) {
        if (it.page !== (currentPages()[0] || 1)) return;
        card.appendChild(hotspotDiv(it));
      });
    } else {
      /* Slider / Fade / One page: hotspots inside each page's wrap,
         positioned by percentage of the page. */
      list.forEach(function (it) {
        var wrap = stageInnerEl.querySelector('.page-wrap[data-page="' + it.page + '"]');
        if (wrap) wrap.appendChild(hotspotDiv(it));
      });
    }
  }
  function youtubeEmbed(url) {
    var m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
    return m ? 'https://www.youtube.com/embed/' + m[1] : null;
  }
  function openIaModal(title, node) {
    iaModalTitle.textContent = title || 'Interaction';
    iaModalBody.innerHTML = '';
    iaModalBody.appendChild(node);
    iaModal.classList.remove('hidden');
    iaModal.classList.add('flex');
  }
  function closeIaModal() {
    iaModal.classList.add('hidden');
    iaModal.classList.remove('flex');
    iaModalBody.innerHTML = ''; /* stops any playing media */
  }
  document.getElementById('ia-modal-close').addEventListener('click', closeIaModal);
  iaModal.addEventListener('click', function (e) { if (e.target === iaModal) closeIaModal(); });
  function runInteraction(it) {
    if (it.type === 'link') {
      if (it.action === 'page') { goToPage(it.targetPage || 1); return; }
      if (it.action === 'url' && it.url) {
        if (it.newTab !== false) window.open(it.url, '_blank', 'noopener');
        else window.location.href = it.url;
        return;
      }
      if (it.action === 'zoom') { setZoom(it.zoom || 1.5); return; }
      if (it.action === 'popup') {
        if (it.popupType === 'image' && it.popupUrl) {
          var img = document.createElement('img');
          img.src = it.popupUrl;
          img.alt = '';
          img.className = 'mx-auto max-h-[60vh] rounded';
          openIaModal('Image', img);
        } else if (it.popupType === 'video' && it.popupUrl) {
          var emb = youtubeEmbed(it.popupUrl);
          if (emb) {
            var fr = document.createElement('iframe');
            fr.src = emb;
            fr.className = 'aspect-video w-full rounded';
            fr.allowFullscreen = true;
            openIaModal('Video', fr);
          } else {
            var vid = document.createElement('video');
            vid.src = it.popupUrl;
            vid.controls = true;
            vid.autoplay = true;
            vid.className = 'w-full rounded';
            openIaModal('Video', vid);
          }
        } else if (it.popupType === 'web' && it.popupUrl) {
          var wfr = document.createElement('iframe');
          wfr.src = it.popupUrl;
          wfr.className = 'h-[60vh] w-full rounded border border-slate-200';
          openIaModal('Web page', wfr);
        }
        return;
      }
      return;
    }
    if (it.type === 'image' && it.imageUrl) {
      var img2 = document.createElement('img');
      img2.src = it.imageUrl;
      img2.alt = '';
      img2.className = 'mx-auto max-h-[60vh] rounded';
      openIaModal('Image', img2);
      return;
    }
    if (it.type === 'video' && it.videoUrl) {
      var emb2 = youtubeEmbed(it.videoUrl);
      if (emb2) {
        var fr2 = document.createElement('iframe');
        fr2.src = emb2 + (it.autoplay ? '?autoplay=1' : '') + (it.muted ? (it.autoplay ? '&mute=1' : '?mute=1') : '');
        fr2.className = 'aspect-video w-full rounded';
        fr2.allowFullscreen = true;
        openIaModal('Video', fr2);
      } else {
        var vid2 = document.createElement('video');
        vid2.src = it.videoUrl;
        vid2.controls = it.controls !== false;
        vid2.muted = !!it.muted;
        vid2.autoplay = !!it.autoplay;
        vid2.className = 'w-full rounded';
        openIaModal('Video', vid2);
      }
      return;
    }
    if (it.type === 'audio' && it.audioUrl) {
      var wrap = document.createElement('div');
      wrap.className = 'text-center';
      if (it.title) {
        var t = document.createElement('p');
        t.className = 'mb-3 font-medium';
        t.textContent = it.title;
        wrap.appendChild(t);
      }
      var aud = document.createElement('audio');
      aud.src = it.audioUrl;
      aud.controls = true;
      aud.autoplay = true;
      aud.className = 'w-full';
      wrap.appendChild(aud);
      openIaModal(it.title || 'Audio', wrap);
      return;
    }
    if (it.type === 'web' && it.webUrl) {
      var wfr2 = document.createElement('iframe');
      if (it.webUrl.trim().toLowerCase().indexOf('<iframe') === 0) {
        wfr2.srcdoc = it.webUrl;
      } else {
        wfr2.src = it.webUrl;
      }
      wfr2.className = 'h-[60vh] w-full rounded border border-slate-200';
      if (it.noScrollbars) wfr2.setAttribute('scrolling', 'no');
      openIaModal('Web page', wfr2);
      return;
    }
  }

  /* ---- F9 Gates: password (verify_flipbook_password RPC) and lead
     form (submit_lead RPC). Each returns a Promise that resolves when
     the reader passes the gate. ---- */
  function leadKey() { return 'fb-lead-' + (book ? book.id : ''); }
  function askPassword() {
    return new Promise(function (resolve) {
      var gate = document.getElementById('pw-gate');
      var form = document.getElementById('pw-form');
      var input = document.getElementById('pw-input');
      var err = document.getElementById('pw-error');
      gate.classList.remove('hidden');
      gate.classList.add('flex');
      input.focus();
      form.onsubmit = async function (e) {
        e.preventDefault();
        var pw = input.value;
        if (!pw) return;
        try {
          var hash = await window.sha256Hex(pw);
          var res = await window.fbClient.rpc('verify_flipbook_password',
            { p_flipbook_id: book.id, p_password_hash: hash });
          if (res.error) throw res.error;
          if (res.data === true) {
            gate.classList.add('hidden');
            gate.classList.remove('flex');
            resolve();
          } else {
            err.classList.remove('hidden');
            input.select();
          }
        } catch (e2) {
          err.textContent = 'Could not check the password. Try again.';
          err.classList.remove('hidden');
        }
      };
    });
  }
  function askLead() {
    /* Already submitted for this book on this browser — don't ask again. */
    try { if (localStorage.getItem(leadKey())) return Promise.resolve(); } catch (e) {}
    return new Promise(function (resolve) {
      var gate = document.getElementById('lead-gate');
      var form = document.getElementById('lead-form');
      var nameEl = document.getElementById('lead-name');
      var emailEl = document.getElementById('lead-email');
      var err = document.getElementById('lead-error');
      var skip = document.getElementById('lead-skip');
      gate.classList.remove('hidden');
      gate.classList.add('flex');
      nameEl.focus();
      function done() {
        gate.classList.add('hidden');
        gate.classList.remove('flex');
        try { localStorage.setItem(leadKey(), '1'); } catch (e) {}
        resolve();
      }
      skip.addEventListener('click', done);
      form.onsubmit = async function (e) {
        e.preventDefault();
        var name = nameEl.value.trim();
        var email = emailEl.value.trim();
        if (!name || !email || email.indexOf('@') === -1) {
          err.textContent = 'Enter your name and a valid email.';
          err.classList.remove('hidden');
          return;
        }
        try {
          var res = await window.fbClient.rpc('submit_lead',
            { p_flipbook_id: book.id, p_name: name, p_email: email });
          if (res.error) throw res.error;
          done();
        } catch (e2) {
          /* The leads table / RPC is a one-time setup (sql/leads.sql).
             Never block the reader — offer to continue without saving. */
          err.textContent = 'Could not save your details (the lead form needs a one-time setup). You can still read the book.';
          err.classList.remove('hidden');
          skip.classList.remove('hidden');
        }
      };
    });
  }

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
      titleEl.textContent = book.title;
      mode = loadMode();
      modeSelect.value = mode;
      await loadDesign();
      applyDesign();
      /* Password gate first, then the lead form gate. */
      if (book.has_password) await askPassword();
      if (design.leadForm && design.leadForm.enabled) await askLead();
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
