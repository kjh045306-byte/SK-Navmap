/* SK 항법지도 2.0 — 바텀시트 / 검색 / 폼 인터랙션 */
(function (global) {
  'use strict';

  var currentTab = 'all';
  var searchQuery = '';
  var toastTimer = null;
  var viaPoints = [];
  var pickDoneFn = null;
  var pickCancelFn = null;
  var TYPE_MAP = { sk: 'sk_landings', land: 'landings', wp: 'waypoints' };

  function $(sel) { return document.querySelector(sel); }
  function $id(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ── 시트 열기/닫기 ── */
  function openSheet(id) {
    $id(id).classList.add('open');
    document.body.classList.add('sheet-open');
  }
  function closeSheet(id) {
    $id(id).classList.remove('open');
    if (!document.querySelector('.sheet.open')) document.body.classList.remove('sheet-open');
  }

  /* ── 토스트 ── */
  function toast(msg) {
    var t = $id('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ── 지도 위치 선택 모드 ── */
  function showPickHint(text, showDone) {
    $id('pick-hint').classList.add('show');
    $id('pick-hint-text').textContent = text;
    $id('pick-hint-done').style.display = showDone ? 'inline-block' : 'none';
  }
  function hidePickHint() {
    $id('pick-hint').classList.remove('show');
  }

  // 단일 좌표 선택 (착륙장/WP 좌표 입력용)
  function pickLocation(onDone) {
    var activeSheet = document.querySelector('.sheet.open');
    var activeSheetId = activeSheet ? activeSheet.id : null;
    if (activeSheetId) closeSheet(activeSheetId);
    showPickHint('지도를 탭하여 위치를 선택하세요', false);
    pickCancelFn = function () {
      hidePickHint();
      MapView.clearMapClickHandler();
      if (activeSheetId) openSheet(activeSheetId);
    };
    MapView.setMapClickHandler(function (latlng) {
      hidePickHint();
      MapView.clearMapClickHandler();
      if (activeSheetId) openSheet(activeSheetId);
      onDone(latlng);
    });
  }

  // 다중 좌표 선택 (경로 경유점용)
  function pickViaPoints() {
    viaPoints = [];
    closeSheet('add-route-sheet');
    showPickHint('경유점을 순서대로 탭하세요 (0개 선택됨)', true);
    MapView.setMapClickHandler(function (latlng) {
      viaPoints.push(latlng);
      $id('pick-hint-text').textContent = '경유점을 순서대로 탭하세요 (' + viaPoints.length + '개 선택됨)';
    });
    pickDoneFn = function () {
      hidePickHint();
      MapView.clearMapClickHandler();
      openSheet('add-route-sheet');
      renderViaList();
    };
    pickCancelFn = function () {
      viaPoints = [];
      hidePickHint();
      MapView.clearMapClickHandler();
      openSheet('add-route-sheet');
      renderViaList();
    };
  }

  function renderViaList() {
    $id('ar-via-count').textContent = viaPoints.length + '개 선택됨';
  }

  /* ── 마커 클릭 → 정보 시트 ── */
  function onMarkerClick(point, kind) {
    var typeLabel = kind === 'sk' ? 'SK착륙장' : (kind === 'land' ? '착륙장' : 'WayPoint');
    $id('m-name').textContent = point.name;
    $id('m-type').textContent = typeLabel;
    var fms = Calc.toFMS(point.lat, point.lng);
    $id('m-lat').textContent = fms.lat;
    $id('m-lng').textContent = fms.lng;

    var related = Data.ROUTES.filter(function (r) {
      return r.depName === point.name || r.arrName === point.name;
    });
    var wrap = $id('related-routes');
    wrap.innerHTML = '';
    if (related.length === 0) {
      wrap.appendChild(el('div', 'empty-hint', '등록된 경로 없음'));
    } else {
      related.forEach(function (r) {
        var isDep = r.depName === point.name;
        var other = isDep ? r.arrName : r.depName;
        var dir = isDep ? '→' : '←';
        var chip = el('div', 'related-chip');
        chip.appendChild(el('div', 'related-dir', dir));
        chip.appendChild(el('div', 'related-dest', other));
        chip.appendChild(el('div', 'related-time', r.t130.toFixed(1) + '분 / ' + Math.round(r.fuel) + 'LBS'));
        chip.addEventListener('click', function () {
          selectRouteAndShow(r);
          closeSheet('marker-sheet');
        });
        wrap.appendChild(chip);
      });
    }

    var delBtn = $id('marker-delete-btn');
    var typeKey = TYPE_MAP[kind];
    if (Data.isUserItem(typeKey, point.name)) {
      delBtn.style.display = 'flex';
      delBtn.onclick = function () {
        if (!confirm(point.name + '을(를) 삭제할까요?')) return;
        Data.deleteUserItem(typeKey, point.name);
        Data.refreshFromLocal();
        MapView.renderMarkers(onMarkerClick);
        closeSheet('marker-sheet');
        toast('삭제되었습니다');
      };
    } else {
      delBtn.style.display = 'none';
      delBtn.onclick = null;
    }
    openSheet('marker-sheet');
  }

  /* ── 경로 선택/표시 ── */
  function selectRouteAndShow(r) {
    MapView.selectRoute(r);
    $id('r-dist').textContent = r.distNm.toFixed(1);
    $id('r-130').textContent = r.t130.toFixed(1);
    $id('r-140').textContent = r.t140.toFixed(1);
    $id('r-fuel').textContent = Math.round(r.fuel);
    $id('result-bar').classList.add('show');
    $id('route-display').textContent = r.depName + ' → ' + r.arrName;
    $id('route-sub').textContent = r.distNm.toFixed(1) + 'NM · ' + r.t130.toFixed(1) + '분 · 연료 ' + Math.round(r.fuel) + 'LBS';
    $id('route-clear-btn').style.display = 'flex';
    closeSheet('route-sheet');
  }

  function clearRouteSelection() {
    MapView.clearSelectedRoute();
    $id('result-bar').classList.remove('show');
    $id('route-display').textContent = '항법경로 선택';
    $id('route-sub').textContent = '출발지 · 도착지를 선택하세요';
    $id('route-clear-btn').style.display = 'none';
  }

  /* ── 경로 검색 시트 ── */
  function computeTopDepartures(n) {
    var counts = {};
    Data.ROUTES.forEach(function (r) { counts[r.depName] = (counts[r.depName] || 0) + 1; });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, n);
  }

  function renderRouteTabs() {
    var tabRow = $id('route-tabs');
    tabRow.innerHTML = '';
    var tabs = [{ v: 'all', label: '전체' }, { v: 'fav', label: '⭐ 즐겨찾기' }];
    computeTopDepartures(3).forEach(function (dep) { tabs.push({ v: dep, label: dep + ' 출발' }); });
    tabs.forEach(function (t) {
      var btn = el('button', 'tab-pill' + (currentTab === t.v ? ' active' : ''), t.label);
      btn.addEventListener('click', function () {
        currentTab = t.v;
        renderRouteTabs();
        renderRouteList();
      });
      tabRow.appendChild(btn);
    });
  }

  function buildRouteCard(r) {
    var card = el('div', 'route-card');
    var icon = el('div', 'rc-icon', '✈️');
    var info = el('div', 'rc-info');
    info.appendChild(el('div', 'rc-name', r.name + (r.isUser ? ' 🆕' : '')));
    var da = el('div', 'rc-dep-arr');
    var depSpan = el('span', null, r.depName);
    var arrSpan = el('span', null, r.arrName);
    da.appendChild(depSpan);
    da.appendChild(document.createTextNode(' → '));
    da.appendChild(arrSpan);
    info.appendChild(da);
    var stats = el('div', 'rc-stats');
    stats.appendChild(el('div', 'rc-dist', r.distNm.toFixed(1) + 'NM'));
    stats.appendChild(el('div', 'rc-time', r.t130.toFixed(1) + '분'));
    var isFav = Data.isFavorite(r.name);
    var favBtn = el('button', 'rc-fav' + (isFav ? ' on' : ''), isFav ? '⭐' : '☆');
    favBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var on = Data.toggleFavorite(r.name);
      if (currentTab === 'fav' && !on) { renderRouteList(); return; }
      favBtn.classList.toggle('on', on);
      favBtn.textContent = on ? '⭐' : '☆';
    });
    card.appendChild(icon);
    card.appendChild(info);
    card.appendChild(stats);
    card.appendChild(favBtn);
    card.addEventListener('click', function () { selectRouteAndShow(r); });
    return card;
  }

  function renderRouteList() {
    var q = searchQuery.trim().toLowerCase();
    var list = Data.ROUTES.filter(function (r) {
      var matchTab = currentTab === 'all' ||
        (currentTab === 'fav' && Data.isFavorite(r.name)) ||
        (r.depName === currentTab);
      var matchQ = !q ||
        r.name.toLowerCase().indexOf(q) >= 0 ||
        r.depName.toLowerCase().indexOf(q) >= 0 ||
        r.arrName.toLowerCase().indexOf(q) >= 0;
      return matchTab && matchQ;
    });
    var wrap = $id('route-list');
    wrap.innerHTML = '';
    if (list.length === 0) {
      wrap.appendChild(el('div', 'empty-hint', '검색 결과가 없습니다'));
      return;
    }
    list.forEach(function (r) { wrap.appendChild(buildRouteCard(r)); });
  }

  /* ── 레이어 시트 ── */
  function syncLayerSheetUI() {
    var state = Data.getLayerState();
    $id('layer-sk').checked = state.sk;
    $id('layer-land').checked = state.land;
    $id('layer-wp').checked = state.wp;
    $id('layer-routes').checked = state.routesAll;
    $id('maptype-select').value = localStorage.getItem('skn_maptype') || 'hybrid';
  }

  /* ── 착륙장/WP/경로 추가 폼 ── */
  function populatePointSelects() {
    var points = Data.DB.sk_landings.concat(Data.DB.landings).slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, 'ko');
    });
    [$id('ar-dep-select'), $id('ar-arr-select')].forEach(function (sel) {
      var current = sel.value;
      sel.innerHTML = '<option value="">선택하세요</option>';
      points.forEach(function (p) {
        var opt = el('option', null, p.name);
        opt.value = p.name;
        sel.appendChild(opt);
      });
      if (current) sel.value = current;
    });
  }

  function resetLandingForm() {
    $id('al-name').value = '';
    $id('al-lat').value = '';
    $id('al-lng').value = '';
    $id('al-memo').value = '';
    $id('al-kind').value = 'landings';
  }
  function resetWaypointForm() {
    $id('aw-name').value = '';
    $id('aw-lat').value = '';
    $id('aw-lng').value = '';
    $id('aw-memo').value = '';
  }
  function resetRouteForm() {
    $id('ar-name').value = '';
    $id('ar-dep-select').value = '';
    $id('ar-arr-select').value = '';
    $id('ar-memo').value = '';
    viaPoints = [];
    renderViaList();
  }

  function saveNewLanding() {
    var name = $id('al-name').value.trim();
    var kind = $id('al-kind').value;
    var lat = parseFloat($id('al-lat').value);
    var lng = parseFloat($id('al-lng').value);
    if (!name || isNaN(lat) || isNaN(lng)) { toast('이름과 좌표를 입력하세요'); return; }
    if (lat < 30 || lat > 43 || lng < 122 || lng > 133) { toast('좌표 범위를 확인하세요 (한국 인근)'); return; }
    Data.addUserPoint(kind, { name: name, lat: lat, lng: lng, memo: $id('al-memo').value.trim() });
    Data.refreshFromLocal();
    MapView.renderMarkers(onMarkerClick);
    populatePointSelects();
    closeSheet('add-landing-sheet');
    resetLandingForm();
    toast('착륙장이 추가되었습니다');
  }

  function saveNewWaypoint() {
    var name = $id('aw-name').value.trim();
    var lat = parseFloat($id('aw-lat').value);
    var lng = parseFloat($id('aw-lng').value);
    if (!name || isNaN(lat) || isNaN(lng)) { toast('이름과 좌표를 입력하세요'); return; }
    if (lat < 30 || lat > 43 || lng < 122 || lng > 133) { toast('좌표 범위를 확인하세요 (한국 인근)'); return; }
    Data.addUserPoint('waypoints', { name: name, lat: lat, lng: lng, memo: $id('aw-memo').value.trim() });
    Data.refreshFromLocal();
    MapView.renderMarkers(onMarkerClick);
    closeSheet('add-waypoint-sheet');
    resetWaypointForm();
    toast('WayPoint가 추가되었습니다');
  }

  function saveNewRoute() {
    var name = $id('ar-name').value.trim();
    var depName = $id('ar-dep-select').value;
    var arrName = $id('ar-arr-select').value;
    if (!name || !depName || !arrName) { toast('이름, 출발지, 도착지를 입력하세요'); return; }
    if (depName === arrName) { toast('출발지와 도착지가 같습니다'); return; }
    var depPt = Data.ALL_POINTS.find(function (p) { return p.name === depName; });
    var arrPt = Data.ALL_POINTS.find(function (p) { return p.name === arrName; });
    if (!depPt || !arrPt) { toast('출발/도착 지점을 찾을 수 없습니다'); return; }
    var coords = [{ lat: depPt.lat, lng: depPt.lng }].concat(viaPoints).concat([{ lat: arrPt.lat, lng: arrPt.lng }]);
    var route = {
      name: name,
      dep: { lat: depPt.lat, lng: depPt.lng },
      arr: { lat: arrPt.lat, lng: arrPt.lng },
      coords: coords,
      memo: $id('ar-memo').value.trim()
    };
    Data.addUserRoute(route);
    Data.refreshFromLocal();
    MapView.renderMarkers(onMarkerClick);
    closeSheet('add-route-sheet');
    resetRouteForm();
    renderRouteTabs();
    renderRouteList();
    toast('항법경로가 추가되었습니다 (' + route.coords.length + '개 지점)');
  }

  /* ── 초기화: 이벤트 연결 ── */
  function init() {
    // 상단바 / 하단바
    $id('layer-btn').addEventListener('click', function () { syncLayerSheetUI(); openSheet('layer-sheet'); });
    $id('route-select-btn').addEventListener('click', function () {
      renderRouteTabs();
      renderRouteList();
      openSheet('route-sheet');
    });
    $id('add-fab').addEventListener('click', function () {
      populatePointSelects();
      openSheet('add-menu');
    });
    $id('route-clear-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      clearRouteSelection();
    });

    // 공통: 오버레이 클릭/닫기버튼으로 시트 닫기
    document.querySelectorAll('.sheet-overlay').forEach(function (ov) {
      ov.addEventListener('click', function () { closeSheet(ov.closest('.sheet').id); });
    });
    document.querySelectorAll('[data-close-sheet]').forEach(function (btn) {
      btn.addEventListener('click', function () { closeSheet(btn.getAttribute('data-close-sheet')); });
    });

    // 위치 선택 힌트 바
    $id('pick-hint-cancel').addEventListener('click', function () { if (pickCancelFn) pickCancelFn(); });
    $id('pick-hint-done').addEventListener('click', function () { if (pickDoneFn) pickDoneFn(); });

    // 경로 검색
    $id('route-search-input').addEventListener('input', function () {
      searchQuery = this.value;
      renderRouteList();
    });

    // 마커 시트
    $id('marker-close-btn').addEventListener('click', function () { closeSheet('marker-sheet'); });
    $id('fms-copy-btn').addEventListener('click', function () {
      var txt = $id('m-lat').textContent + ' ' + $id('m-lng').textContent;
      var btn = $id('fms-copy-btn');
      var orig = btn.textContent;
      var done = function () { btn.textContent = '✅ 복사됨'; setTimeout(function () { btn.textContent = orig; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done).catch(function () { toast('복사에 실패했습니다'); });
      } else {
        toast('이 브라우저는 클립보드 복사를 지원하지 않습니다');
      }
    });

    // 추가 메뉴
    $id('menu-add-route').addEventListener('click', function () {
      closeSheet('add-menu');
      populatePointSelects();
      openSheet('add-route-sheet');
    });
    $id('menu-add-landing').addEventListener('click', function () {
      closeSheet('add-menu');
      openSheet('add-landing-sheet');
    });
    $id('menu-add-waypoint').addEventListener('click', function () {
      closeSheet('add-menu');
      openSheet('add-waypoint-sheet');
    });
    $id('menu-export').addEventListener('click', function () {
      closeSheet('add-menu');
      Data.exportMergedJson();
      toast('navmap_data.json 파일을 다운로드했습니다');
    });

    // 착륙장 추가
    $id('al-pick-btn').addEventListener('click', function () {
      pickLocation(function (latlng) {
        $id('al-lat').value = latlng.lat.toFixed(6);
        $id('al-lng').value = latlng.lng.toFixed(6);
      });
    });
    $id('al-save-btn').addEventListener('click', saveNewLanding);
    $id('al-cancel-btn').addEventListener('click', function () { closeSheet('add-landing-sheet'); resetLandingForm(); });

    // WayPoint 추가
    $id('aw-pick-btn').addEventListener('click', function () {
      pickLocation(function (latlng) {
        $id('aw-lat').value = latlng.lat.toFixed(6);
        $id('aw-lng').value = latlng.lng.toFixed(6);
      });
    });
    $id('aw-save-btn').addEventListener('click', saveNewWaypoint);
    $id('aw-cancel-btn').addEventListener('click', function () { closeSheet('add-waypoint-sheet'); resetWaypointForm(); });

    // 항법경로 추가
    $id('ar-pick-via-btn').addEventListener('click', pickViaPoints);
    $id('ar-reset-via-btn').addEventListener('click', function () { viaPoints = []; renderViaList(); });
    $id('ar-save-btn').addEventListener('click', saveNewRoute);
    $id('ar-cancel-btn').addEventListener('click', function () { closeSheet('add-route-sheet'); resetRouteForm(); });

    // 레이어 시트
    $id('layer-sk').addEventListener('change', function () { MapView.setLayerVisible('sk', this.checked); });
    $id('layer-land').addEventListener('change', function () { MapView.setLayerVisible('land', this.checked); });
    $id('layer-wp').addEventListener('change', function () { MapView.setLayerVisible('wp', this.checked); });
    $id('layer-routes').addEventListener('change', function () { MapView.setLayerVisible('routesAll', this.checked); });
    $id('maptype-select').addEventListener('change', function () {
      MapView.setMapType(this.value);
      localStorage.setItem('skn_maptype', this.value);
    });
    $id('layer-export-btn').addEventListener('click', function () {
      Data.exportMergedJson();
      toast('navmap_data.json 파일을 다운로드했습니다');
    });

    MapView.setMapType(localStorage.getItem('skn_maptype') || 'hybrid');
    renderViaList();
  }

  global.UI = {
    init: init,
    onMarkerClick: onMarkerClick,
    toast: toast,
    openSheet: openSheet,
    closeSheet: closeSheet
  };
})(window);
