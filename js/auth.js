/* Auth page: email + password sign-in / sign-up via Supabase Auth. */
(function () {
  'use strict';

  var mode = 'signin';
  var tabSignin = document.getElementById('tab-signin');
  var tabSignup = document.getElementById('tab-signup');
  var submit = document.getElementById('auth-submit');
  var form = document.getElementById('auth-form');
  var errorEl = document.getElementById('auth-error');

  function setMode(next) {
    mode = next;
    var isSignin = mode === 'signin';
    tabSignin.className = 'px-4 py-2 rounded-lg text-sm font-medium ' + (isSignin ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700');
    tabSignup.className = 'px-4 py-2 rounded-lg text-sm font-medium ' + (isSignin ? 'bg-slate-100 text-slate-700' : 'bg-emerald-600 text-white');
    submit.textContent = isSignin ? 'Sign in' : 'Sign up';
  }

  tabSignin.addEventListener('click', function () { setMode('signin'); });
  tabSignup.addEventListener('click', function () { setMode('signup'); });

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    errorEl.classList.add('hidden');
    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;
    if (!email || !password) {
      errorEl.textContent = 'Please enter your email and password.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!window.fbClient) {
      errorEl.textContent = 'Supabase is not configured yet.';
      errorEl.classList.remove('hidden');
      return;
    }
    submit.disabled = true;
    try {
      var result = mode === 'signin'
        ? await window.fbClient.auth.signInWithPassword({ email: email, password: password })
        : await window.fbClient.auth.signUp({ email: email, password: password });
      if (result.error) throw result.error;
      if (result.data && result.data.session) {
        showToast(mode === 'signin' ? 'Signed in. Welcome back.' : 'Account created.');
        window.location.href = 'dashboard.html';
      } else {
        showToast('Account created. Check your email to confirm it, then sign in.');
        setMode('signin');
      }
    } catch (err) {
      errorEl.textContent = err && err.message ? err.message : 'Something went wrong.';
      errorEl.classList.remove('hidden');
    } finally {
      submit.disabled = false;
    }
  });
})();
