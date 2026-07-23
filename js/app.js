/* SK 항법지도 2.0 — 부트스트랩 */
(function () {
  'use strict';

  // Google Cloud Console에서 HTTP 리퍼러를 GitHub Pages 도메인으로 제한하세요.
  var GOOGLE_MAPS_API_KEY = 'AIzaSyAi9KTkybz2bDXoZbbHWHzMpzylOL6N_dg';

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

  function boot() {
    Promise.all([
      MapView.loadGoogleMaps(GOOGLE_MAPS_API_KEY),
      Data.loadDatabase()
    ])
      .then(function () {
        MapView.initMap(document.getElementById('map'));
        MapView.renderMarkers(UI.onMarkerClick);
        var kmz = Data.getKmzData();
        if (kmz) MapView.renderKmzLayer(kmz.items, Data.getLayerState().kmz);
        UI.init();
        hideLoading();
        if (Data.orphanedOverlay.length) {
          UI.toast('적용 안 된 로컬 수정사항 ' + Data.orphanedOverlay.length + '건 (자세한 내용은 콘솔 참고)');
        }
      })
      .catch(function (err) {
        showFatalError(err);
      });

    registerServiceWorker();
    setupInstallPrompt();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
