/* F12 Account page: who is signed in, change password, sign out. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  async function load() {
    var user = await window.currentUser();
    if (!user) { window.location.href = 'auth.html'; return; }
    $('#account-email').textContent = user.email || '';
    var created = user.created_at ? formatDate(user.created_at) : '';
    $('#account-meta').textContent = created ? ('Account created ' + created) : '';
    $('#account-loading').classList.add('hidden');
    $('#account-main').classList.remove('hidden');
  }

  $('#change-pw-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var errorEl = $('#change-pw-error');
    var status = $('#change-pw-status');
    var submit = $('#change-pw-submit');
    errorEl.classList.add('hidden');
    status.textContent = '';
    var pw = $('#change-new-password').value;
    var confirm = $('#change-confirm-password').value;
    if (!pw || pw.length < 6) {
      errorEl.textContent = 'Choose a password of at least 6 characters.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (pw !== confirm) {
      errorEl.textContent = 'The two passwords do not match.';
      errorEl.classList.remove('hidden');
      return;
    }
    submit.disabled = true;
    try {
      var result = await window.fbClient.auth.updateUser({ password: pw });
      if (result.error) throw result.error;
      $('#change-new-password').value = '';
      $('#change-confirm-password').value = '';
      status.textContent = 'Password changed.';
      showToast('Password changed.', 'success');
    } catch (err) {
      errorEl.textContent = err && err.message ? err.message : 'Something went wrong.';
      errorEl.classList.remove('hidden');
    } finally {
      submit.disabled = false;
    }
  });

  $('#account-signout').addEventListener('click', async function () {
    await window.fbClient.auth.signOut();
    window.location.href = 'index.html';
  });

  document.addEventListener('DOMContentLoaded', load);
})();
