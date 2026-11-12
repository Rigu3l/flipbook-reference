/* Landing page: recent public flipbooks + hero PDF dropzone (uploads
   the PDF straight from the homepage, like Heyzine's Convert box). */
(function () {
  'use strict';

  var GREEN = '#19A975';

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
        cover.className = 'flex h-36 items-center justify-center text-5xl font-bold text-white';
        cover.style.background = GREEN;
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
        actions.className = 'mt-3';
        var open = document.createElement('a');
        open.className = 'inline-block rounded-lg px-3 py-1.5 text-sm font-medium text-white';
        open.style.background = GREEN;
        open.href = 'viewer.html?id=' + row.id;
        open.textContent = 'Open';
        actions.appendChild(open);
        body.appendChild(h3); body.appendChild(meta); body.appendChild(actions);
        card.appendChild(cover); card.appendChild(body);
        grid.appendChild(card);
      });
    } catch (err) {
      status.textContent = 'Could not load recent flipbooks: ' + (err.message || 'unknown error');
    }
  }

  /* ---- Hero dropzone upload (same flow as dashboard upload.js). ---- */
  var MAX_BYTES = (window.FLIPBOOK_CONFIG && window.FLIPBOOK_CONFIG.MAX_FILE_BYTES) || 30 * 1024 * 1024;
  var dropzone = document.getElementById('hero-dropzone');
  var fileInput = document.getElementById('hero-file-input');
  var fileNameEl = document.getElementById('hero-file-name');
  var uploadBtn = document.getElementById('hero-upload-btn');
  var errorEl = document.getElementById('hero-error');
  var progressWrap = document.getElementById('hero-progress-wrap');
  var progressBar = document.getElementById('hero-progress-bar');
  var progressText = document.getElementById('hero-progress-text');
  var signinNote = document.getElementById('hero-signin-note');
  var selectedFile = null;
  var pageCount = 0;

  function showHeroError(message) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }
  function setHeroProgress(percent, text) {
    progressWrap.classList.remove('hidden');
    progressBar.style.width = Math.min(100, Math.max(0, percent)) + '%';
    progressText.textContent = text || '';
  }

  async function chooseHeroFile(file) {
    errorEl.classList.add('hidden');
    if (!file) return;
    var user = await window.currentUser();
    if (!user) {
      signinNote.classList.remove('hidden');
      window.location.href = 'auth.html';
      return;
    }
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) { showHeroError('Please choose a PDF file.'); return; }
    if (file.size > MAX_BYTES) {
      showHeroError('That PDF is over 30 MB. Please choose a smaller file.');
      return;
    }
    selectedFile = file;
    fileNameEl.textContent = file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB) — counting pages…';
    fileNameEl.classList.remove('hidden');
    try {
      if (!window.pdfjsLib) throw new Error('PDF.js did not load. Check your connection and reload.');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
      var buffer = await file.arrayBuffer();
      var pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
      pageCount = pdf.numPages;
      fileNameEl.textContent = file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB, ' + pageCount + ' pages)';
    } catch (err) {
      selectedFile = null;
      showHeroError('Could not read that PDF: ' + (err.message || 'invalid file'));
      fileNameEl.classList.add('hidden');
    }
  }

  function uploadHeroWithProgress(session, filePath, file) {
    return new Promise(function (resolve, reject) {
      var cfg = window.FLIPBOOK_CONFIG;
      var xhr = new XMLHttpRequest();
      xhr.open('POST', cfg.SUPABASE_URL + '/storage/v1/object/' + cfg.BUCKET + '/' + filePath);
      xhr.setRequestHeader('apikey', cfg.SUPABASE_ANON_KEY);
      xhr.setRequestHeader('Authorization', 'Bearer ' + session.access_token);
      xhr.setRequestHeader('Content-Type', 'application/pdf');
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
          setHeroProgress(Math.round((e.loaded / e.total) * 90),
            'Uploading… ' + Math.round((e.loaded / e.total) * 100) + '%');
        }
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error('Storage upload failed (' + xhr.status + '). ' + xhr.responseText));
      };
      xhr.onerror = function () { reject(new Error('Network error during upload.')); };
      xhr.send(file);
    });
  }

  async function startHeroUpload() {
    errorEl.classList.add('hidden');
    if (!selectedFile) { fileInput.click(); return; }
    if (!window.fbClient) { showHeroError('Supabase is not configured yet.'); return; }
    uploadBtn.disabled = true;
    try {
      var sessionRes = await window.fbClient.auth.getSession();
      var session = sessionRes.data ? sessionRes.data.session : null;
      if (!session) throw new Error('Your session expired. Please sign in again.');
      var user = session.user;
      var title = selectedFile.name.replace(/\.pdf$/i, '');
      var flipbookId = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID() : ('fb-' + Date.now());
      var filePath = user.id + '/' + flipbookId + '.pdf';
      setHeroProgress(2, 'Uploading…');
      await uploadHeroWithProgress(session, filePath, selectedFile);
      setHeroProgress(94, 'Saving flipbook…');
      var insertRes = await window.fbClient.from('flipbooks').insert({
        id: flipbookId,
        user_id: user.id,
        title: title,
        file_path: filePath,
        page_count: pageCount,
        password_hash: null,
        is_public: true
      });
      if (insertRes.error) throw insertRes.error;
      setHeroProgress(100, 'Done.');
      window.location.href = 'viewer.html?id=' + flipbookId;
    } catch (err) {
      showHeroError(err && err.message ? err.message : 'Upload failed. Please try again.');
    } finally {
      uploadBtn.disabled = false;
    }
  }

  dropzone.addEventListener('click', function (e) {
    if (e.target === uploadBtn) return; /* the button has its own handler */
    fileInput.click();
  });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function () { chooseHeroFile(fileInput.files[0]); });
  uploadBtn.addEventListener('click', function (e) { e.stopPropagation(); startHeroUpload(); });
  ['dragenter', 'dragover'].forEach(function (type) {
    dropzone.addEventListener(type, function (e) {
      e.preventDefault();
      dropzone.classList.add('border-[#19A975]', 'bg-[#19A975]/5');
    });
  });
  ['dragleave', 'drop'].forEach(function (type) {
    dropzone.addEventListener(type, function (e) {
      e.preventDefault();
      dropzone.classList.remove('border-[#19A975]', 'bg-[#19A975]/5');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    var file = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
    chooseHeroFile(file);
  });

  document.addEventListener('DOMContentLoaded', loadRecent);
})();
