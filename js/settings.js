/* F9 settings: password protect, lead form, replace PDF, copy flipbook
   (owner-only page). Password is stored as a SHA-256 hash in
   flipbooks.password_hash; the viewer checks it with the
   verify_flipbook_password RPC. The lead form setting lives in the
   design sidecar; leads go through the submit_lead RPC (see sql/leads.sql). */
(function () {
  'use strict';

  var id = getQueryParam('id');
  var book = null;
  var user = null;
  var design = null;

  var $ = function (s) { return document.querySelector(s); };

  function showError(msg) {
    var el = $('#st-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function designPath() { return user.id + '/' + book.id + '.design.json'; }

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
    $('#settings-title').textContent = 'Settings — ' + (book.title || 'Untitled');
    $('#settings-view').href = 'viewer.html?id=' + book.id;
    /* Password state (has_password is not exposed to the owner row, so
       check the hash column directly — the owner can read their own row). */
    var pwRes = await window.fbClient.from('flipbooks')
      .select('password_hash').eq('id', id).eq('user_id', user.id).maybeSingle();
    var hasPw = !!(pwRes.data && pwRes.data.password_hash);
    $('#st-pw-enabled').checked = hasPw;
    $('#st-pw-fields').classList.toggle('hidden', !hasPw);
    /* Design sidecar (lead form setting). */
    design = {};
    try {
      var url = window.publicPdfUrl(designPath());
      if (url) {
        var r = await fetch(url, { cache: 'no-store' });
        if (r.ok) {
          var saved = await r.json();
          if (saved && typeof saved === 'object') design = saved;
        }
      }
    } catch (e) { /* no design yet */ }
    $('#st-lead-enabled').checked = !!(design.leadForm && design.leadForm.enabled);
    $('#st-loading').classList.add('hidden');
    $('#st-main').classList.remove('hidden');
    loadLeads();
  }

  /* ---- Password protect. ---- */
  $('#st-pw-enabled').addEventListener('change', function () {
    $('#st-pw-fields').classList.toggle('hidden', !$('#st-pw-enabled').checked);
  });
  $('#st-pw-save').addEventListener('click', async function () {
    var btn = $('#st-pw-save');
    var status = $('#st-pw-status');
    var enabled = $('#st-pw-enabled').checked;
    var pw = $('#st-pw-new').value;
    if (enabled && !pw) { status.textContent = 'Enter a password first.'; return; }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      var hash = null;
      if (enabled) hash = await window.sha256Hex(pw);
      var upd = await window.fbClient.from('flipbooks')
        .update({ password_hash: hash }).eq('id', book.id).eq('user_id', user.id);
      if (upd.error) throw upd.error;
      $('#st-pw-new').value = '';
      status.textContent = enabled ? 'Password protection is on.' : 'Password protection is off.';
      showToast(enabled ? 'Password protection is on.' : 'Password protection is off.', 'success');
    } catch (e) {
      status.textContent = 'Could not save: ' + (e.message || e);
      showToast('Could not save the password setting.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save password setting';
    }
  });

  /* ---- Lead form. ---- */
  async function saveDesignSidecar() {
    var blob = new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' });
    var up = await window.fbClient.storage
      .from(window.fbConfig.BUCKET || 'pdfs')
      .upload(designPath(), blob, { upsert: true, contentType: 'application/json' });
    if (up.error) throw up.error;
  }
  $('#st-lead-save').addEventListener('click', async function () {
    var btn = $('#st-lead-save');
    var status = $('#st-lead-status');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      if (!design.leadForm) design.leadForm = {};
      design.leadForm.enabled = $('#st-lead-enabled').checked;
      await saveDesignSidecar();
      status.textContent = design.leadForm.enabled
        ? 'Lead form is on — readers will enter their name and email first.'
        : 'Lead form is off.';
      showToast('Lead form setting saved.', 'success');
    } catch (e) {
      status.textContent = 'Could not save: ' + (e.message || e);
      showToast('Could not save the lead form setting.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save lead form setting';
    }
  });
  async function loadLeads() {
    var box = $('#st-leads-list');
    try {
      var res = await window.fbClient.from('leads')
        .select('name,email,created_at').eq('flipbook_id', book.id)
        .order('created_at', { ascending: false }).limit(50);
      if (res.error) throw res.error;
      var leads = res.data || [];
      if (!leads.length) { box.innerHTML = '<p class="text-sm text-slate-500">No leads yet.</p>'; return; }
      box.innerHTML = '';
      leads.forEach(function (lead) {
        var row = document.createElement('div');
        row.className = 'flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm';
        var who = document.createElement('span');
        who.className = 'font-medium text-slate-800';
        who.textContent = lead.name;
        var mail = document.createElement('span');
        mail.className = 'text-slate-500';
        mail.textContent = lead.email;
        var when = document.createElement('span');
        when.className = 'shrink-0 text-xs text-slate-400';
        when.textContent = formatDate(lead.created_at);
        row.appendChild(who); row.appendChild(mail); row.appendChild(when);
        box.appendChild(row);
      });
    } catch (e) {
      box.innerHTML = '<p class="text-sm text-slate-500">Leads need a one-time setup — run sql/leads.sql in the Supabase SQL editor first.</p>';
    }
  }

  /* ---- Replace PDF (same Storage path, new page count). ---- */
  $('#st-replace-btn').addEventListener('click', async function () {
    var file = $('#st-replace-file').files[0];
    var status = $('#st-replace-status');
    if (!file) { status.textContent = 'Choose a PDF file first.'; return; }
    if (file.type !== 'application/pdf') { status.textContent = 'That file is not a PDF.'; return; }
    var btn = $('#st-replace-btn');
    btn.disabled = true;
    var prog = $('#st-replace-progress');
    var bar = $('#st-replace-bar');
    var pct = $('#st-replace-pct');
    prog.classList.remove('hidden');
    try {
      /* Page count of the new PDF (before uploading). */
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
      var buf = await file.arrayBuffer();
      var newPdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      var newCount = newPdf.numPages;
      /* Upload (XHR for progress), same path as the old PDF. */
      var supabaseUrl = window.fbConfig.SUPABASE_URL;
      var anonKey = window.fbConfig.SUPABASE_ANON_KEY;
      var session = (await window.fbClient.auth.getSession()).data.session;
      await new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', supabaseUrl + '/storage/v1/object/pdfs/' + book.file_path);
        xhr.setRequestHeader('apikey', anonKey);
        xhr.setRequestHeader('Authorization', 'Bearer ' + session.access_token);
        xhr.setRequestHeader('x-upsert', 'true');
        xhr.setRequestHeader('Content-Type', 'application/pdf');
        xhr.upload.onprogress = function (e) {
          if (!e.lengthComputable) return;
          var p = Math.round(e.loaded / e.total * 100);
          bar.style.width = p + '%';
          pct.textContent = p + '%';
        };
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error('Upload failed (' + xhr.status + ')'));
        };
        xhr.onerror = function () { reject(new Error('Upload failed (network)')); };
        xhr.send(file);
      });
      /* Update the row's page count. */
      var upd = await window.fbClient.from('flipbooks')
        .update({ page_count: newCount }).eq('id', book.id).eq('user_id', user.id);
      if (upd.error) throw upd.error;
      book.page_count = newCount;
      status.textContent = 'PDF replaced — now ' + newCount + ' pages.';
      showToast('PDF replaced.', 'success');
    } catch (e) {
      status.textContent = 'Could not replace the PDF: ' + (e.message || e);
      showToast('Could not replace the PDF.', 'error');
    } finally {
      btn.disabled = false;
      prog.classList.add('hidden');
    }
  });

  /* ---- Copy flipbook (new row + copied PDF + copied design). ---- */
  $('#st-copy-btn').addEventListener('click', async function () {
    var btn = $('#st-copy-btn');
    var status = $('#st-copy-status');
    btn.disabled = true;
    btn.textContent = 'Copying…';
    try {
      var newId = window.crypto.randomUUID();
      var newPath = user.id + '/' + newId + '.pdf';
      /* Copy the PDF file in Storage. */
      var cp = await window.fbClient.storage
        .from(window.fbConfig.BUCKET || 'pdfs')
        .copy(book.file_path, newPath);
      if (cp.error) throw cp.error;
      /* New row. */
      var ins = await window.fbClient.from('flipbooks').insert({
        id: newId,
        user_id: user.id,
        title: 'Copy of ' + (book.title || 'Untitled'),
        file_path: newPath,
        page_count: book.page_count,
        is_public: true
      }).select('id').single();
      if (ins.error) throw ins.error;
      /* Copy the design sidecar (same content, new path). */
      if (design && Object.keys(design).length) {
        var blob = new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' });
        var up = await window.fbClient.storage
          .from(window.fbConfig.BUCKET || 'pdfs')
          .upload(user.id + '/' + newId + '.design.json', blob, { upsert: true, contentType: 'application/json' });
        if (up.error) throw up.error;
      }
      status.textContent = 'Copied — find it on the dashboard as "Copy of ' + (book.title || 'Untitled') + '".';
      showToast('Flipbook copied.', 'success');
    } catch (e) {
      status.textContent = 'Could not copy: ' + (e.message || e);
      showToast('Could not copy the flipbook.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Copy flipbook';
    }
  });

  document.addEventListener('DOMContentLoaded', load);
})();
