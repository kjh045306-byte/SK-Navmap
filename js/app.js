/* SK 항법지도 2.0 — 부트스트랩 */
(function () {
  'use strict';

  // Google Cloud Console에서 HTTP 리퍼러를 GitHub Pages 도메인으로 제한하세요.
  var GOOGLE_MAPS_API_KEY = 'AIzaSyDUZbBFwxDGhv0eJG0r2rnweKhfX_xerPk';

  function hideLoading() {
    var el = document.getElementById('loading-screen');
    if (el) el.classList.add('hide');
  }

  function showFatalError(err) {
    console.error(err);
    var el = document.getElementById('loading-screen');
    if (!el) return;
    el.classList.remove('hide');
    el.innerHTML =
      '<div class="loading-inner">' +
      '<div class="loading-title">⚠️ 불러오기 실패</div>' +
      '<div class="loading-sub">' + (err && err.message ? err.message : '알 수 없는 오류') + '</div>' +
      '<button class="loading-retry" onclick="location.reload()">다시 시도</button>' +
      '</div>';
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').catch(function (e) {
          console.warn('서비스워커 등록 실패', e);
        });
      });
    }
  }

  // PWA 설치 배너
  function setupInstallPrompt() {
    var deferredPrompt = null;
    var banner = document.getElementById('install-banner');
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      if (localStorage.getItem('skn_install_dismissed') !== '1') {
        banner.style.display = 'flex';
      }
    });
    document.getElementById('install-btn').addEventListener('click', function () {
      banner.style.display = 'none';
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt = null;
      }
    });
    document.getElementById('install-dismiss').addEventListener('click', function () {
      banner.style.display = 'none';
      localStorage.setItem('skn_install_dismissed', '1');
    });
    window.addEventListener('appinstalled', function () {
      banner.style.display = 'none';
    });
  }

  // Firebase 로그인 상태에 따라 로그인폼 ↔ 지도화면 전환
  function setupAuthScreenSwitch() {
    window.addEventListener('sk-auth-changed', function (e) {
      var user = e.detail && e.detail.user;
      var overlay = document.getElementById('login-overlay');
      if (!overlay) return;
      if (user) {
        overlay.classList.remove('show');
      } else {
        overlay.classList.add('show');
      }
    });
  }

  // 로그인 성공 시(세션 복원 포함) 클라우드에서 사용자 추가 데이터를 한 번 받아온다.
  // Data.loadDatabase()가 아직 끝나지 않았으면(=baseCache 준비 전) boot() 완료 이후로 미룬다.
  function setupCloudSyncOnLogin() {
    var appReady = false;
    var pendingUser = null;

    function trigger(user) {
      if (!user) return;
      if (!appReady) { pendingUser = user; return; }
      UI.runCloudSync(true);
    }

    window.addEventListener('sk-auth-changed', function (e) {
      trigger(e.detail && e.detail.user);
    });

    return function onAppReady() {
      appReady = true;
      if (pendingUser) { trigger(pendingUser); pendingUser = null; }
      else if (window.firebaseAuth && window.firebaseAuth.currentUser) {
        trigger(window.firebaseAuth.currentUser);
      }
    };
  }

  function boot() {
    var onAppReady = setupCloudSyncOnLogin();

    Promise.all([
      MapView.loadGoogleMaps(GOOGLE_MAPS_API_KEY),
      Data.loadDatabase()
    ])
      .then(function () {
        MapView.initMap(document.getElementById('map'));
        MapView.renderMarkers(UI.onMarkerClick);
        UI.init();
        hideLoading();
        if (Data.orphanedOverlay.length) {
          UI.toast('적용 안 된 로컬 수정사항 ' + Data.orphanedOverlay.length + '건 (자세한 내용은 콘솔 참고)');
        }
        onAppReady();
      })
      .catch(function (err) {
        showFatalError(err);
      });

    registerServiceWorker();
    setupInstallPrompt();
  }

  setupAuthScreenSwitch();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
