/* Upload: validate a PDF, count its pages with PDF.js, upload it to
   Supabase Storage with a real progress bar, then save its row.
   Only signed-in users can upload (enforced by Storage + table RLS). */
(function () {
  'use strict';

  var MAX_BYTES = (window.FLIPBOOK_CONFIG && window.FLIPBOOK_CONFIG.MAX_FILE_BYTES) || 30 * 1024 * 1024;
  var selectedFile = null;
  var pageCount = 0;

  var form = document.getElementById('upload-form');
  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('file-input');
  var fileNameEl = document.getElementById('file-name');
  var errorEl = document.getElementById('upload-error');
  var progressWrap = document.getElementById('progress-wrap');
  var progressBar = document.getElementById('progress-bar');
  var progressText = document.getElementById('progress-text');
  var uploadBtn = document.getElementById('upload-btn');
  var resultBox = document.getElementById('upload-result');

  function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  function setProgress(percent, text) {
    progressWrap.classList.remove('hidden');
    progressBar.style.width = Math.min(100, Math.max(0, percent)) + '%';
    progressText.textContent = text || '';
  }

  /* Validate type + size, then count pages with PDF.js. Counting also
     proves the file is a readable PDF before we spend time uploading. */
  async function chooseFile(file) {
    errorEl.classList.add('hidden');
    if (!file) return;
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) { showError('Please choose a PDF file.'); return; }
    if (file.size > MAX_BYTES) {
      showError('That PDF is over 30 MB. Please choose a smaller file.');
      return;
    }
    selectedFile = file;
    fileNameEl.textContent = file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB) — counting pages…';
    try {
      if (!window.pdfjsLib) throw new Error('PDF.js did not load. Check your connection and reload.');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'js/vendor/pdf.worker.min.js';
      var buffer = await file.arrayBuffer();
      var pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
      pageCount = pdf.numPages;
      fileNameEl.textContent = file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB, ' + pageCount + ' pages)';
    } catch (err) {
      selectedFile = null;
      showError('Could not read that PDF: ' + (err.message || 'invalid file'));
      fileNameEl.textContent = 'No file chosen yet. Max 30 MB.';
    }
  }

  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function () { chooseFile(fileInput.files[0]); });
  ['dragenter', 'dragover'].forEach(function (type) {
    dropzone.addEventListener(type, function (e) {
      e.preventDefault();
      dropzone.classList.add('border-emerald-500', 'bg-emerald-50');
    });
  });
  ['dragleave', 'drop'].forEach(function (type) {
    dropzone.addEventListener(type, function (e) {
      e.preventDefault();
      dropzone.classList.remove('border-emerald-500', 'bg-emerald-50');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    var file = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
    chooseFile(file);
  });

  /* Supabase Storage's JS upload() has no progress callback, so the
     file goes up with a plain XHR to the Storage API instead. Auth is
     the signed-in user's access token, never the service key. */
  function uploadWithProgress(session, filePath, file) {
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
          setProgress(Math.round((e.loaded / e.total) * 90),
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

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    errorEl.classList.add('hidden');
    resultBox.classList.add('hidden');
    var title = document.getElementById('title').value.trim();
    if (!title) { showError('Please enter a title.'); return; }
    if (!selectedFile) { showError('Please choose a PDF file first.'); return; }
    if (!window.fbClient) { showError('Supabase is not configured yet.'); return; }
    uploadBtn.disabled = true;
    try {
      var sessionRes = await window.fbClient.auth.getSession();
      var session = sessionRes.data ? sessionRes.data.session : null;
      if (!session) throw new Error('Your session expired. Please sign in again.');
      var user = session.user;
      var flipbookId = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID() : ('fb-' + Date.now());
      var filePath = user.id + '/' + flipbookId + '.pdf';

      setProgress(2, 'Uploading…');
      await uploadWithProgress(session, filePath, selectedFile);
      setProgress(94, 'Saving flipbook…');

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
      setProgress(100, 'Done.');

      document.getElementById('result-title').textContent = title + ' — ' + pageCount + ' pages';
      resultBox.classList.remove('hidden');
      showToast('Flipbook created.');
      form.reset();
      selectedFile = null; pageCount = 0;
      fileNameEl.textContent = 'No file chosen yet. Max 30 MB.';
      window.dispatchEvent(new CustomEvent('flipbook-created'));
    } catch (err) {
      showError(err && err.message ? err.message : 'Upload failed. Please try again.');
    } finally {
      uploadBtn.disabled = false;
    }
  });

  /* Show the form only to signed-in users. Signed-out visitors are
     sent to auth.html by dashboard.js, so there is no gate here. */
  async function initAuth() {
    var user = await window.currentUser();
    if (user) { form.classList.remove('hidden'); }
  }

  document.addEventListener('DOMContentLoaded', initAuth);
})();
