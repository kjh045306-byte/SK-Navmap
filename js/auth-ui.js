/* SK 항법지도 2.0 — 로그인 화면 / 상단바 사용자 정보 (일반 스크립트) */
(function () {
  'use strict';

  var overlay = document.getElementById('login-overlay');
  var emailInput = document.getElementById('login-email');
  var passwordInput = document.getElementById('login-password');
  var errorEl = document.getElementById('login-error');
  var submitBtn = document.getElementById('login-submit-btn');
  var topUser = document.getElementById('top-user');
  var topUserEmail = document.getElementById('top-user-email');
  var logoutBtn = document.getElementById('logout-btn');

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }

  function clearError() {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  function setSubmitting(submitting) {
    submitBtn.disabled = submitting;
    submitBtn.textContent = submitting ? '로그인 중...' : '로그인';
  }

  function loginErrorMessage(err) {
    var code = err && err.code;
    if (code === 'auth/invalid-email') return '이메일 형식이 올바르지 않습니다.';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return '이메일 또는 비밀번호가 올바르지 않습니다.';
    }
    if (code === 'auth/too-many-requests') return '시도 횟수가 많습니다. 잠시 후 다시 시도하세요.';
    if (code === 'auth/network-request-failed') return '네트워크 오류입니다. 연결 상태를 확인하세요.';
    return '로그인에 실패했습니다. (' + (code || '알 수 없는 오류') + ')';
  }

  function doLogin() {
    var email = emailInput.value.trim();
    var password = passwordInput.value;
    if (!email || !password) {
      showError('이메일과 비밀번호를 입력하세요.');
      return;
    }
    if (!window.firebaseAuth || !window.firebaseSignIn) {
      showError('로그인 기능을 불러오는 중입니다. 잠시 후 다시 시도하세요.');
      return;
    }
    clearError();
    setSubmitting(true);
    window.firebaseSignIn(window.firebaseAuth, email, password)
      .catch(function (err) {
        showError(loginErrorMessage(err));
      })
      .finally(function () {
        setSubmitting(false);
      });
  }

  submitBtn.addEventListener('click', doLogin);
  [emailInput, passwordInput].forEach(function (el) {
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doLogin();
    });
  });

  logoutBtn.addEventListener('click', function () {
    var user = window.firebaseAuth && window.firebaseAuth.currentUser;
    var email = (user && user.email) || '현재 계정';
    if (!confirm(email + '님으로 로그인됨\n로그아웃 하시겠습니까?')) return;
    if (window.firebaseAuth && window.firebaseSignOut) {
      window.firebaseSignOut(window.firebaseAuth);
    }
  });

  window.addEventListener('sk-auth-changed', function (e) {
    var user = e.detail && e.detail.user;
    clearError();
    setSubmitting(false);
    passwordInput.value = '';
    if (user) {
      topUser.style.display = 'flex';
      topUserEmail.textContent = user.email || '';
    } else {
      topUser.style.display = 'none';
      topUserEmail.textContent = '—';
    }
  });
})();
