/* F12 Reset password: the reset email links here with a recovery token
   in the URL hash. Supabase Auth picks the token up on init and sets a
   recovery session, so updateUser() can set the new password. */
(function () {
  'use strict';

  var stateEl = document.getElementById('reset-state');
  var form = document.getElementById('reset-pw-form');
  var errorEl = document.getElementById('reset-pw-error');
  var submit = document.getElementById('reset-pw-submit');

  async function init() {
    if (!window.fbClient) { stateEl.textContent = 'Supabase is not configured yet.'; return; }
    /* Give the auth client a moment to read the recovery token from the
       URL hash and establish the session. */
    var user = null;
    for (var i = 0; i < 10; i++) {
      user = await window.currentUser();
      if (user) break;
      await new Promise(function (r) { setTimeout(r, 300); });
    }
    if (!user) {
      stateEl.textContent = 'This reset link is invalid or has expired. Request a new one from the sign-in page.';
      return;
    }
    stateEl.textContent = 'Resetting the password for ' + user.email + '.';
    form.classList.remove('hidden');
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    errorEl.classList.add('hidden');
    var pw = document.getElementById('new-password').value;
    var confirm = document.getElementById('confirm-password').value;
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
      showToast('Password updated. You are signed in.');
      window.location.href = 'dashboard.html';
    } catch (err) {
      errorEl.textContent = err && err.message ? err.message : 'Something went wrong.';
      errorEl.classList.remove('hidden');
    } finally {
      submit.disabled = false;
    }
  });

  document.addEventListener('DOMContentLoaded', init);
})();
