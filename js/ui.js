/* SK 항법지도 2.0 — 바텀시트 / 검색 / 폼 인터랙션 */
(function (global) {
  'use strict';

  var currentTab = 'all';
  var searchQuery = '';
  var toastTimer = null;
  var viaPoints = [];
  var pickDoneFn = null;
  var pickCancelFn = null;
  var editingPoint = null; // { type, id } — 착륙장/WP 수정 중일 때
  var editingRouteId = null; // 항법경로 수정 중일 때 대상 id
  var selectedRouteId = null; // 현재 지도에 표시 중인(선택된) 저장 경로 id
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
    closeSheet('add-route-sheet');
    showPickHint('경유점을 순서대로 탭하세요 (' + viaPoints.length + '개 선택됨)', true);
    $id('via-pick-panel').style.display = 'block';
    syncViaUI();
    MapView.setViaPointCallbacks(onViaDrag, onViaMarkerClick);
    MapView.setMapClickHandler(function (latlng) {
      viaPoints.push(latlng);
      $id('pick-hint-text').textContent = '경유점을 순서대로 탭하세요 (' + viaPoints.length + '개 선택됨)';
      syncViaUI();
    });
    pickDoneFn = function () {
      hidePickHint();
      $id('via-pick-panel').style.display = 'none';
      MapView.clearMapClickHandler();
      openSheet('add-route-sheet');
      syncViaUI();
    };
    pickCancelFn = function () {
      hidePickHint();
      $id('via-pick-panel').style.display = 'none';
      MapView.clearMapClickHandler();
      openSheet('add-route-sheet');
      syncViaUI();
    };
  }

  // 경유점 드래그 이동 → 좌표 갱신
  function onViaDrag(index, latlng) {
    viaPoints[index] = latlng;
    syncViaUI();
  }

  // 경유점 마커 탭 → 삭제 확인
  function onViaMarkerClick(index) {
    if (!confirm((index + 1) + '번 경유점을 삭제할까요?')) return;
    viaPoints.splice(index, 1);
    syncViaUI();
    $id('pick-hint-text').textContent = '경유점을 순서대로 탭하세요 (' + viaPoints.length + '개 선택됨)';
  }

  function buildViaRow(p, i) {
    var row = el('div', 'via-row');
    row.appendChild(el('div', 'via-row-num', String(i + 1)));
    row.appendChild(el('div', 'via-row-coord', p.lat.toFixed(5) + ', ' + p.lng.toFixed(5)));
    var delBtn = el('button', 'via-row-del', '✕');
    delBtn.title = '삭제';
    delBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      viaPoints.splice(i, 1);
      syncViaUI();
    });
    row.appendChild(delBtn);
    return row;
  }

  // 경유점 목록 텍스트/행 렌더링 (폼 안 목록 + 지도탭 모드 플로팅 패널 공용)
  function renderViaList() {
    $id('ar-via-count').textContent = viaPoints.length + '개 선택됨';
    [$id('ar-via-list'), $id('via-pick-list')].forEach(function (container) {
      container.innerHTML = '';
      viaPoints.forEach(function (p, i) { container.appendChild(buildViaRow(p, i)); });
    });
  }

  // 경유점 변경(추가/삭제/드래그) 시마다: 지도 마커 + 목록 + 미저장 경로 미리보기(노랑선)를 함께 갱신
  function syncViaUI() {
    MapView.setViaPoints(viaPoints);
    renderViaList();
    updateDraftPreview();
  }

  // 출발/도착/경유점이 모두 갖춰지면 노란색 미리보기 선을 그린다 (저장 전 임시 경로)
  function updateDraftPreview() {
    var depName = $id('ar-dep-select').value;
    var arrName = $id('ar-arr-select').value;
    var depPt = depName ? Data.ALL_POINTS.find(function (p) { return p.name === depName; }) : null;
    var arrPt = arrName ? Data.ALL_POINTS.find(function (p) { return p.name === arrName; }) : null;
    if (!depPt || !arrPt) { MapView.clearDraftRoute(); return; }
    var coords = [{ lat: depPt.lat, lng: depPt.lng }].concat(viaPoints).concat([{ lat: arrPt.lat, lng: arrPt.lng }]);
    MapView.previewDraftRoute(coords);
  }

  /* ── 마커 클릭 → 정보 시트 ── */
  function onMarkerClick(point, kind) {
    var typeLabel = kind === 'sk' ? 'SK착륙장' : (kind === 'land' ? '착륙장' : 'WayPoint');
    $id('m-name').textContent = point.name;
    $id('m-type').textContent = typeLabel;
    var fms = Calc.toFMS(point.lat, point.lng);
    var dms = Calc.toDMS(point.lat, point.lng);
    $id('m-fms-lat').textContent = fms.lat;
    $id('m-fms-lng').textContent = fms.lng;
    $id('m-dms-lat').textContent = dms.lat;
    $id('m-dms-lng').textContent = dms.lng;

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

    var typeKey = TYPE_MAP[kind];
    $id('marker-edit-btn').onclick = function () {
      closeSheet('marker-sheet');
      openEditPoint(kind, point);
    };
    $id('marker-delete-btn').onclick = function () {
      if (!confirm(point.name + '을(를) 정말 삭제하시겠어요?')) return;
      Data.deleteItemById(typeKey, point.id);
      Data.refreshFromLocal();
      MapView.renderMarkers(onMarkerClick);
      populatePointSelects();
      closeSheet('marker-sheet');
      toast('삭제되었습니다');
    };
    openSheet('marker-sheet');
  }

  // 착륙장/SK착륙장/WayPoint 수정 폼 열기
  function openEditPoint(kind, point) {
    editingPoint = { type: TYPE_MAP[kind], id: point.id };
    if (kind === 'wp') {
      $id('aw-name').value = point.name;
      $id('aw-lat').value = point.lat;
      $id('aw-lng').value = point.lng;
      $id('aw-memo').value = point.memo || '';
      $id('add-waypoint-sheet').querySelector('.sheet-title').textContent = 'WayPoint 수정';
      openSheet('add-waypoint-sheet');
    } else {
      $id('al-name').value = point.name;
      $id('al-kind').value = kind === 'sk' ? 'sk_landings' : 'landings';
      $id('al-lat').value = point.lat;
      $id('al-lng').value = point.lng;
      $id('al-memo').value = point.memo || '';
      $id('add-landing-sheet').querySelector('.sheet-title').textContent = '착륙장 수정';
      openSheet('add-landing-sheet');
    }
  }

  /* ── 경로 선택/표시 ── */
  function selectRouteAndShow(r) {
    MapView.selectRoute(r);
    selectedRouteId = r.id;
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
    selectedRouteId = null;
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
    var actions = el('div', 'rc-actions');
    var editBtn = el('button', 'rc-icon-btn', '✏️');
    editBtn.title = '수정';
    editBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openEditRoute(r);
    });
    var delBtn = el('button', 'rc-icon-btn danger', '🗑️');
    delBtn.title = '삭제';
    delBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!confirm('"' + r.name + '" 경로를 정말 삭제하시겠어요?')) return;
      Data.deleteItemById('routes', r.id);
      Data.refreshFromLocal();
      MapView.renderMarkers(onMarkerClick);
      if (selectedRouteId === r.id) clearRouteSelection();
      renderRouteTabs();
      renderRouteList();
      toast('삭제되었습니다');
    });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    card.appendChild(icon);
    card.appendChild(info);
    card.appendChild(stats);
    card.appendChild(favBtn);
    card.appendChild(actions);
    card.addEventListener('click', function () { selectRouteAndShow(r); });
    return card;
  }

  // 항법경로 수정 폼 열기 (기존 경유점/출발/도착/메모를 채워서 add-route-sheet 재사용)
  function openEditRoute(r) {
    populatePointSelects();
    editingRouteId = r.id;
    $id('ar-name').value = r.name;
    $id('ar-dep-select').value = r.depName;
    $id('ar-arr-select').value = r.arrName;
    $id('ar-memo').value = r.memo || '';
    viaPoints = (r.coords || []).slice(1, -1).map(function (c) { return { lat: c.lat, lng: c.lng }; });
    $id('add-route-sheet').querySelector('.sheet-title').textContent = '항법경로 수정';
    closeSheet('route-sheet');
    openSheet('add-route-sheet');
    syncViaUI();
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
    editingPoint = null;
    $id('add-landing-sheet').querySelector('.sheet-title').textContent = '착륙장 추가';
  }
  function resetWaypointForm() {
    $id('aw-name').value = '';
    $id('aw-lat').value = '';
    $id('aw-lng').value = '';
    $id('aw-memo').value = '';
    editingPoint = null;
    $id('add-waypoint-sheet').querySelector('.sheet-title').textContent = 'WayPoint 추가';
  }
  function resetRouteForm() {
    $id('ar-name').value = '';
    $id('ar-dep-select').value = '';
    $id('ar-arr-select').value = '';
    $id('ar-memo').value = '';
    viaPoints = [];
    editingRouteId = null;
    $id('add-route-sheet').querySelector('.sheet-title').textContent = '새 항법경로';
    syncViaUI();
  }

  function saveNewLanding() {
    var name = $id('al-name').value.trim();
    var kind = $id('al-kind').value;
    var lat = parseFloat($id('al-lat').value);
    var lng = parseFloat($id('al-lng').value);
    if (!name || isNaN(lat) || isNaN(lng)) { toast('이름과 좌표를 입력하세요'); return; }
    if (lat < 30 || lat > 43 || lng < 122 || lng > 133) { toast('좌표 범위를 확인하세요 (한국 인근)'); return; }
    var fields = { name: name, lat: lat, lng: lng, memo: $id('al-memo').value.trim() };
    var wasEditing = !!editingPoint;
    if (editingPoint) {
      if (editingPoint.type === kind) {
        Data.updateItem(kind, editingPoint.id, fields);
      } else {
        // 종류(착륙장 ↔ SK착륙장)가 바뀌면 기존 항목을 지우고 새 종류로 다시 추가한다
        Data.deleteItemById(editingPoint.type, editingPoint.id);
        Data.addUserPoint(kind, fields);
      }
    } else {
      Data.addUserPoint(kind, fields);
    }
    Data.refreshFromLocal();
    MapView.renderMarkers(onMarkerClick);
    populatePointSelects();
    closeSheet('add-landing-sheet');
    resetLandingForm();
    toast(wasEditing ? '착륙장이 수정되었습니다' : '착륙장이 추가되었습니다');
  }

  function saveNewWaypoint() {
    var name = $id('aw-name').value.trim();
    var lat = parseFloat($id('aw-lat').value);
    var lng = parseFloat($id('aw-lng').value);
    if (!name || isNaN(lat) || isNaN(lng)) { toast('이름과 좌표를 입력하세요'); return; }
    if (lat < 30 || lat > 43 || lng < 122 || lng > 133) { toast('좌표 범위를 확인하세요 (한국 인근)'); return; }
    var fields = { name: name, lat: lat, lng: lng, memo: $id('aw-memo').value.trim() };
    var wasEditing = !!editingPoint;
    if (editingPoint) {
      Data.updateItem('waypoints', editingPoint.id, fields);
    } else {
      Data.addUserPoint('waypoints', fields);
    }
    Data.refreshFromLocal();
    MapView.renderMarkers(onMarkerClick);
    closeSheet('add-waypoint-sheet');
    resetWaypointForm();
    toast(wasEditing ? 'WayPoint가 수정되었습니다' : 'WayPoint가 추가되었습니다');
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
    var fields = {
      name: name,
      dep: { lat: depPt.lat, lng: depPt.lng },
      arr: { lat: arrPt.lat, lng: arrPt.lng },
      coords: coords,
      memo: $id('ar-memo').value.trim()
    };
    var wasEditing = !!editingRouteId;
    var savedId;
    if (editingRouteId) {
      Data.updateItem('routes', editingRouteId, fields);
      savedId = editingRouteId;
    } else {
      savedId = Data.addUserRoute(fields).id;
    }
    Data.refreshFromLocal();
    MapView.renderMarkers(onMarkerClick);
    MapView.clearViaMarkers();
    MapView.clearDraftRoute();
    closeSheet('add-route-sheet');
    resetRouteForm();
    renderRouteTabs();
    renderRouteList();
    // 레이어 설정과 무관하게 방금 저장한 경로를 바로 지도에 표시
    var saved = Data.ROUTES.find(function (r) { return r.id === savedId; });
    if (saved) selectRouteAndShow(saved);
    toast(wasEditing ? '항법경로가 수정되었습니다' : '항법경로가 추가되었습니다 (' + coords.length + '개 지점)');
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
    function bindCoordCopy(btnId, latId, lngId) {
      $id(btnId).addEventListener('click', function () {
        var txt = $id(latId).textContent + ' ' + $id(lngId).textContent;
        var btn = $id(btnId);
        var orig = btn.textContent;
        var done = function () { btn.textContent = '✅'; setTimeout(function () { btn.textContent = orig; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(done).catch(function () { toast('복사에 실패했습니다'); });
        } else {
          toast('이 브라우저는 클립보드 복사를 지원하지 않습니다');
        }
      });
    }
    bindCoordCopy('fms-copy-btn', 'm-fms-lat', 'm-fms-lng');
    bindCoordCopy('dms-copy-btn', 'm-dms-lat', 'm-dms-lng');

    // 추가 메뉴
    $id('menu-add-route').addEventListener('click', function () {
      closeSheet('add-menu');
      populatePointSelects();
      resetRouteForm();
      openSheet('add-route-sheet');
    });
    $id('menu-add-landing').addEventListener('click', function () {
      closeSheet('add-menu');
      resetLandingForm();
      openSheet('add-landing-sheet');
    });
    $id('menu-add-waypoint').addEventListener('click', function () {
      closeSheet('add-menu');
      resetWaypointForm();
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
    $id('ar-reset-via-btn').addEventListener('click', function () { viaPoints = []; syncViaUI(); });
    $id('ar-save-btn').addEventListener('click', saveNewRoute);
    $id('ar-cancel-btn').addEventListener('click', function () { closeSheet('add-route-sheet'); resetRouteForm(); });
    $id('ar-dep-select').addEventListener('change', updateDraftPreview);
    $id('ar-arr-select').addEventListener('change', updateDraftPreview);

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
    syncViaUI();
  }

  global.UI = {
    init: init,
    onMarkerClick: onMarkerClick,
    toast: toast,
    openSheet: openSheet,
    closeSheet: closeSheet
  };
})(window);
