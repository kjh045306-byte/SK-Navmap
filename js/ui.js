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
  var displayedRoute = null; // 위와 동일한 경로의 전체 객체 — "이 경로 Log 인쇄" 버튼이 참조
  // marker "kind"는 Data 타입 키(sk_landings/offsite_landings/hospital_landings/ultralight_landings/waypoints)와 그대로 동일하게 사용한다
  var LAYER_ORDER = ['sk_landings', 'offsite_landings', 'hospital_landings', 'ultralight_landings', 'cp', 'waypoints', 'ctrz', 'reportPoints', 'gwanjegwon', 'restricted'];
  var LANDING_KINDS = ['sk_landings', 'offsite_landings', 'hospital_landings', 'ultralight_landings'];
  var currentSearchResult = null; // 장소 검색 결과 중 선택된 항목 { name, address, lat, lng }
  var routeComposeActive = false; // 항법경로 작성 폼이 열려 있는 동안(경유점 탭 선택 중 포함) true
  var selectedDepPoint = null; // 현재 선택된 출발지 { name, lat, lng } — 드롭다운/지도탭 공통 소스
  var selectedArrPoint = null; // 현재 선택된 도착지 { name, lat, lng }
  var pendingRoutePoint = null; // 지도탭 직후 역할(출발/도착/경유) 선택 대기 중인 지점

  // ── 지도 누르기유지(long-press)로 시작하는 임시경로 작성 ──
  var lpFlowActive = false; // 누르기유지로 임시경로 작성이 진행 중인지
  var lpPendingPoint = null; // 누르기유지 발동 직후 역할 선택 대기 중인 지점
  var lpDraftName = null; // 자동 생성된 임시경로 이름 (예: Route01)
  var lpOrder = []; // 추가된 순서('dep'|'via') — "마지막 점 취소" 버튼이 참조
  var lpSnapCandidate = null; // { near, raw } — 근처지점 스냅 확인 대기 중일 때
  var lpEditMode = false; // 저장된 경로를 지도에서 직접 편집 중인지 (드래그/롱프레스 재지정 + 저장 버튼)

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

  // 지도에서 출발/도착/경유지 선택 (기존 마커 탭 또는 빈 지도 탭 모두 지원)
  function pickDepArr() {
    closeSheet('add-route-sheet');
    showPickHint('지도를 탭해 출발지·도착지·경유지를 선택하세요', true);
    MapView.setMapClickHandler(function (latlng) {
      openRoutePointChooser({ name: coordPointName(latlng), lat: latlng.lat, lng: latlng.lng });
    });
    MapView.setRoutePointClickHandler(function (point) {
      openRoutePointChooser({ name: point.name, lat: point.lat, lng: point.lng });
    });
    pickDoneFn = function () {
      hidePickHint();
      closeRoutePointChooser();
      MapView.clearMapClickHandler();
      MapView.clearRoutePointClickHandler();
      openSheet('add-route-sheet');
    };
    pickCancelFn = pickDoneFn;
  }

  function openRoutePointChooser(point) {
    pendingRoutePoint = point;
    $id('rpc-label').textContent = point.name;
    $id('route-point-chooser').style.display = 'block';
  }

  function closeRoutePointChooser() {
    pendingRoutePoint = null;
    $id('route-point-chooser').style.display = 'none';
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
    updateComposeStats();
    refreshMidpointMarkers();
  }

  // 출발/도착/경유점이 모두 갖춰지면 노란색 미리보기 선을 그린다 (저장 전 임시 경로)
  function updateDraftPreview() {
    if (!selectedDepPoint || !selectedArrPoint) { MapView.clearDraftRoute(); return; }
    var coords = [{ lat: selectedDepPoint.lat, lng: selectedDepPoint.lng }]
      .concat(viaPoints)
      .concat([{ lat: selectedArrPoint.lat, lng: selectedArrPoint.lng }]);
    MapView.previewDraftRoute(coords);
  }

  // 드롭다운/지도탭 어느 경로로 선택하든 이 함수를 거쳐 selectedDepPoint/selectedArrPoint를 갱신한다.
  // 등록된 지점(ALL_POINTS)이 아니면(빈 지도 탭) select에 임시 옵션을 만들어 보여준다.
  function setDepArrPoint(role, point) {
    var selectId = role === 'dep' ? 'ar-dep-select' : 'ar-arr-select';
    var sel = $id(selectId);
    var isRegistered = Data.ALL_POINTS.some(function (p) { return p.name === point.name; });
    var tempId = selectId + '-temp-option';
    var existingTemp = $id(tempId);
    if (existingTemp) existingTemp.remove();
    if (!isRegistered) {
      var opt = document.createElement('option');
      opt.id = tempId;
      opt.value = point.name;
      opt.textContent = point.name + ' (좌표 직접 선택)';
      opt.dataset.lat = point.lat;
      opt.dataset.lng = point.lng;
      sel.appendChild(opt);
    }
    sel.value = point.name;
    if (role === 'dep') {
      selectedDepPoint = point;
      MapView.setDepMarker(point, true, onDepDrag);
    } else {
      selectedArrPoint = point;
      MapView.setArrMarker(point, true, onArrDrag);
    }
    updateDraftPreview();
    updateComposeStats();
    refreshMidpointMarkers();
  }

  // 출발/도착 마커 드래그 종료 → 좌표만 갱신 (이름은 저장 시 쓰이지 않으므로 그대로 둔다)
  function onDepDrag(latlng) {
    if (!selectedDepPoint) return;
    selectedDepPoint = { name: selectedDepPoint.name, lat: latlng.lat, lng: latlng.lng };
    updateDraftPreview();
    updateComposeStats();
    refreshMidpointMarkers();
  }
  function onArrDrag(latlng) {
    if (!selectedArrPoint) return;
    selectedArrPoint = { name: selectedArrPoint.name, lat: latlng.lat, lng: latlng.lng };
    updateDraftPreview();
    updateComposeStats();
    refreshMidpointMarkers();
  }

  // 편집모드(출발+도착이 모두 있을 때)에서 구간별 "+" 삽입 아이콘 위치를 재계산한다
  function refreshMidpointMarkers() {
    if (!lpFlowActive || !selectedDepPoint || !selectedArrPoint) { MapView.clearMidpointMarkers(); return; }
    var seq = [{ lat: selectedDepPoint.lat, lng: selectedDepPoint.lng }]
      .concat(viaPoints)
      .concat([{ lat: selectedArrPoint.lat, lng: selectedArrPoint.lng }]);
    MapView.setMidpointMarkers(seq);
  }

  // 구간 중앙의 "+" 아이콘 탭 → 그 구간(segIndex번째)에 새 경유점을 두 지점의 중간 좌표로 삽입
  function insertViaAtSegment(segIndex) {
    var seq = [selectedDepPoint].concat(viaPoints).concat([selectedArrPoint]);
    var a = seq[segIndex], b = seq[segIndex + 1];
    if (!a || !b) return;
    var mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    viaPoints.splice(segIndex, 0, mid);
    lpOrder.push('via');
    syncViaUI();
    toast('경유점이 추가되었습니다');
  }

  function coordPointName(latlng) {
    return '좌표 ' + latlng.lat.toFixed(5) + ', ' + latlng.lng.toFixed(5);
  }

  /* ── 지도 누르기유지(long-press)로 시작하는 임시경로 작성 ── */

  // 이미 쓰인 "RouteNN" 이름과 겹치지 않는 다음 순번 이름을 만든다
  function nextDraftRouteName() {
    var used = {};
    Data.ROUTES.forEach(function (r) { used[r.name] = true; });
    var n = 1;
    while (used['Route' + String(n).padStart(2, '0')]) n++;
    return 'Route' + String(n).padStart(2, '0');
  }

  function showComposeBar() {
    $id('action-row-normal').style.display = 'none';
    $id('compose-row').style.display = 'flex';
    $id('compose-title').textContent = lpDraftName + (lpEditMode ? ' 편집 중' : ' 작성 중');
    $id('compose-undo-btn').style.display = lpEditMode ? 'none' : 'flex';
    $id('compose-save-btn').style.display = lpEditMode ? 'flex' : 'none';
    updateComposeStats();
  }

  function hideComposeBar() {
    $id('compose-row').style.display = 'none';
    $id('action-row-normal').style.display = '';
  }

  // calc.js의 거리계산 함수를 그대로 재사용해 작성 중인 임시경로의 거리/시간을 하단 액션바에 표시
  function updateComposeStats() {
    if (!lpFlowActive) return;
    var pts = [];
    if (selectedDepPoint) pts.push({ lat: selectedDepPoint.lat, lng: selectedDepPoint.lng });
    pts = pts.concat(viaPoints);
    if (selectedArrPoint) pts.push({ lat: selectedArrPoint.lat, lng: selectedArrPoint.lng });
    var dist = Calc.routeDistanceNM(pts);
    var t130 = Calc.timeMin(dist, 130);
    $id('compose-stats').textContent = '거리 ' + dist.toFixed(1) + 'NM · ' + t130.toFixed(1) + '분';
  }

  // 근처 등록지점 자동 스냅 반경 (50~100m 중간값)
  var SNAP_RADIUS_NM = 80 / 1852;

  // 지도 누르기유지 발동 시 호출 — 반경 안에 등록지점이 있으면 스냅 확인 카드를,
  // 없으면 바로 역할 선택 목록을 보여준다 (같은 바텀시트 안에서 전환)
  function onMapLongPress(latlng) {
    var rawPoint = { name: coordPointName(latlng), lat: latlng.lat, lng: latlng.lng };
    var near = Data.nearestPoint(latlng.lat, latlng.lng, SNAP_RADIUS_NM);
    if (near) {
      lpSnapCandidate = { near: near, raw: rawPoint };
      showLpRoleSheet(null);
    } else {
      lpPendingPoint = rawPoint;
      showLpRoleSheet(rawPoint);
    }
  }

  // point가 있으면 역할 선택 목록을, 없으면(=스냅 확인 대기) 스냅 카드를 보여준다
  function showLpRoleSheet(point) {
    if (point) {
      $id('lp-snap-card').style.display = 'none';
      $id('lp-role-list').style.display = 'flex';
      $id('lp-role-title').textContent = point.name;
    } else {
      $id('lp-role-list').style.display = 'none';
      $id('lp-snap-card').style.display = 'block';
      $id('lp-snap-name').textContent = lpSnapCandidate.near.name;
      $id('lp-role-title').textContent = '이 지점을 어떻게 사용할까요?';
    }
    openSheet('lp-role-sheet');
  }

  // 스냅 확인 카드에서 "네, 이 지점 사용" — 등록된 지점의 정확한 이름/좌표를 그대로 사용
  function lpSnapAccept() {
    if (!lpSnapCandidate) return;
    var near = lpSnapCandidate.near;
    lpPendingPoint = { name: near.name, lat: near.lat, lng: near.lng };
    lpSnapCandidate = null;
    showLpRoleSheet(lpPendingPoint);
  }

  // 스냅 확인 카드에서 "아니오, 새 지점 사용" — 누른 좌표 그대로 사용
  function lpSnapDecline() {
    if (!lpSnapCandidate) return;
    lpPendingPoint = lpSnapCandidate.raw;
    lpSnapCandidate = null;
    showLpRoleSheet(lpPendingPoint);
  }

  // 역할 선택 바텀시트에서 출발지/경유지/도착지 버튼 선택 시 호출
  function lpSelectRole(role) {
    if (!lpPendingPoint) return;
    if (role === 'arr' && !selectedDepPoint) {
      closeSheet('lp-role-sheet');
      lpPendingPoint = null;
      toast('먼저 출발지를 지정해주세요');
      return;
    }
    var point = lpPendingPoint;
    lpPendingPoint = null;
    closeSheet('lp-role-sheet');
    if (!lpFlowActive) {
      lpFlowActive = true;
      lpDraftName = nextDraftRouteName();
      $id('ar-name').value = lpDraftName;
      routeComposeActive = true;
      showComposeBar();
    }
    if (role === 'dep') {
      if (lpOrder.indexOf('dep') === -1) lpOrder.push('dep');
      setDepArrPoint('dep', point);
      toast('출발지로 지정되었습니다');
    } else if (role === 'arr') {
      setDepArrPoint('arr', point);
      if (lpEditMode) {
        toast('도착지가 재지정되었습니다');
      } else {
        finalizeLpDraft();
      }
      return;
    } else {
      lpOrder.push('via');
      viaPoints.push({ lat: point.lat, lng: point.lng });
      syncViaUI();
      toast('경유지로 추가되었습니다 (' + viaPoints.length + '개)');
    }
  }

  // 하단 액션바의 "↩️ 취소" — 방금 추가한 마지막 지점을 제거하고 거리를 재계산
  function lpUndoLast() {
    if (!lpOrder.length) return;
    var last = lpOrder.pop();
    if (last === 'via') {
      viaPoints.pop();
      syncViaUI();
    } else if (last === 'dep') {
      selectedDepPoint = null;
      $id('ar-dep-select').value = '';
      MapView.clearDepMarker();
      updateDraftPreview();
      updateComposeStats();
    }
    if (!selectedDepPoint && !viaPoints.length) lpCancelDraft();
  }

  // 작성/편집 중인 임시경로를 전체 취소하고 초기 상태로 되돌린다 (편집모드였다면 원본 경로는 그대로 유지됨)
  function lpCancelDraft() {
    lpFlowActive = false;
    lpEditMode = false;
    editingRouteId = null;
    lpOrder = [];
    lpDraftName = null;
    viaPoints = [];
    selectedDepPoint = null;
    selectedArrPoint = null;
    routeComposeActive = false;
    $id('ar-dep-select').value = '';
    $id('ar-arr-select').value = '';
    MapView.clearViaMarkers();
    MapView.clearDraftRoute();
    MapView.clearDepMarker();
    MapView.clearArrMarker();
    MapView.clearMidpointMarkers();
    hideComposeBar();
  }

  // 도착지 지정 → 임시경로 완성. 저장 확인 바텀시트를 연다 (이름은 탭하면 직접 입력 가능)
  function finalizeLpDraft() {
    lpFlowActive = false;
    hideComposeBar();
    $id('ar-name').value = lpDraftName;
    openLpSaveSheet();
  }

  function openLpSaveSheet() {
    $id('lp-save-name-label').textContent = lpDraftName;
    $id('lp-save-name-label').style.display = '';
    $id('lp-save-name-input').style.display = 'none';
    $id('lp-save-route').textContent = selectedDepPoint.name + ' → ' + selectedArrPoint.name;
    var pts = [{ lat: selectedDepPoint.lat, lng: selectedDepPoint.lng }]
      .concat(viaPoints)
      .concat([{ lat: selectedArrPoint.lat, lng: selectedArrPoint.lng }]);
    var dist = Calc.routeDistanceNM(pts);
    var t130 = Calc.timeMin(dist, 130);
    $id('lp-save-stats').textContent = '거리 ' + dist.toFixed(1) + 'NM · ' + t130.toFixed(1) + '분 · 경유 ' + viaPoints.length + '개';
    openSheet('lp-save-sheet');
  }

  // 이름 텍스트를 탭하면 바로 수정 가능한 입력창으로 전환
  function lpSaveNameEdit() {
    $id('lp-save-name-label').style.display = 'none';
    var inp = $id('lp-save-name-input');
    inp.value = $id('ar-name').value;
    inp.style.display = 'block';
    inp.focus();
    inp.select();
  }

  // 입력값을 ar-name(저장 로직이 참조하는 필드)에 반영 — 비워두면 자동생성 이름을 그대로 사용
  function lpSaveNameCommit() {
    var inp = $id('lp-save-name-input');
    if (inp.style.display === 'none') return;
    var v = inp.value.trim();
    $id('ar-name').value = v || lpDraftName;
    $id('lp-save-name-label').textContent = $id('ar-name').value;
    inp.style.display = 'none';
    $id('lp-save-name-label').style.display = '';
  }

  /* ── 장소 검색 ── */
  // 검색 시트를 열기 전, 열려 있는 시트/좌표 선택 모드를 정리(선택 중이던 항법경로 작성은 유지)
  function pauseForSearch() {
    document.querySelectorAll('.sheet.open').forEach(function (s) { closeSheet(s.id); });
    hidePickHint();
    $id('via-pick-panel').style.display = 'none';
    closeRoutePointChooser();
    MapView.clearMapClickHandler();
    MapView.clearRoutePointClickHandler();
  }

  function openSearchSheet() {
    pauseForSearch();
    $id('place-search-input').value = '';
    $id('place-search-results').innerHTML = '';
    openSheet('search-sheet');
    $id('place-search-input').focus();
  }

  function buildPlaceCard(r) {
    var card = el('div', 'place-card');
    card.appendChild(el('div', 'place-card-icon', '📍'));
    var info = el('div', 'place-card-info');
    info.appendChild(el('div', 'place-card-name', r.name));
    info.appendChild(el('div', 'place-card-addr', r.address || ''));
    card.appendChild(info);
    card.addEventListener('click', function () { selectSearchResult(r); });
    return card;
  }

  function renderPlaceSearchResults(results) {
    var wrap = $id('place-search-results');
    wrap.innerHTML = '';
    if (!results.length) { wrap.appendChild(el('div', 'empty-hint', '검색 결과가 없습니다')); return; }
    results.forEach(function (r) { wrap.appendChild(buildPlaceCard(r)); });
  }

  function runPlaceSearch() {
    var q = $id('place-search-input').value.trim();
    if (!q) return;
    var wrap = $id('place-search-results');
    wrap.innerHTML = '';
    wrap.appendChild(el('div', 'empty-hint', '검색 중...'));
    MapView.searchPlaces(q).then(function (results) {
      renderPlaceSearchResults(results);
    }).catch(function (e) {
      console.error(e);
      wrap.innerHTML = '';
      var msg = String(e.message || '').indexOf('REQUEST_DENIED') >= 0
        ? 'Places API가 활성화되어 있지 않습니다 (Google Cloud Console 확인 필요)'
        : '검색 중 오류가 발생했습니다';
      wrap.appendChild(el('div', 'empty-hint', msg));
    });
  }

  // 검색 결과 선택 → 임시(보라) 마커 표시 + 지도 이동/확대 + 정보 시트
  function selectSearchResult(r) {
    currentSearchResult = r;
    closeSheet('search-sheet');
    MapView.showSearchMarker(r.lat, r.lng, r.name);
    MapView.panToPoint(r.lat, r.lng, 16);
    $id('sr-name').textContent = r.name;
    $id('sr-address').textContent = r.address || '—';
    var fms = Calc.toFMS(r.lat, r.lng);
    var dms = Calc.toDMS(r.lat, r.lng);
    $id('sr-fms-lat').textContent = fms.lat;
    $id('sr-fms-lng').textContent = fms.lng;
    $id('sr-dms-lat').textContent = dms.lat;
    $id('sr-dms-lng').textContent = dms.lng;
    $id('sr-add-via-btn').style.display = routeComposeActive ? '' : 'none';
    openSheet('search-result-sheet');
  }

  // CP/ReportPoint는 경로의 출발/도착지가 아니라 "지나는 경유점"으로 관련됨 — 경로 좌표열 중 하나라도 근접하면 관련 경로로 본다
  function routePassesNear(r, lat, lng, maxNm) {
    if (!r.coords) return false;
    for (var i = 0; i < r.coords.length; i++) {
      if (Calc.haversineNM(lat, lng, r.coords[i].lat, r.coords[i].lng) <= maxNm) return true;
    }
    return false;
  }

  // 마커시트 안의 "즉시 경로작성" 버튼 — 지도 누르기유지(lpSelectRole)와 완전히 같은 상태/로직을 공유한다
  function updateMarkerRouteActions(point) {
    var wrap = $id('marker-route-actions');
    wrap.innerHTML = '';
    function startFlow(role) {
      closeSheet('marker-sheet');
      lpPendingPoint = { name: point.name, lat: point.lat, lng: point.lng };
      lpSelectRole(role);
    }
    if (!lpFlowActive) {
      var startBtn = el('button', 'btn-primary', '🛫 이 지점에서 새 경로 시작');
      startBtn.addEventListener('click', function () { startFlow('dep'); });
      wrap.appendChild(startBtn);
    } else {
      var viaBtn = el('button', 'btn-secondary', '📍 경유지로 추가');
      viaBtn.addEventListener('click', function () { startFlow('via'); });
      var arrBtn = el('button', 'btn-primary', '🛬 도착지로 지정하고 완료');
      arrBtn.addEventListener('click', function () { startFlow('arr'); });
      wrap.appendChild(viaBtn);
      wrap.appendChild(arrBtn);
    }
  }

  /* ── 항법경로 Log 인쇄 (PC 전용, nav_log_2-1A_preview_v2.html 레이아웃 그대로) ── */
  var CIRCLED_DIGITS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  var PRE_FLIGHT_FUEL_LBS = 150; // 이륙전 사용량 기본값 — 첫 행(출발)부터 누적연료에 반영

  function circledNum(n) {
    if (n >= 1 && n <= CIRCLED_DIGITS.length) return CIRCLED_DIGITS[n - 1];
    return '(' + n + ')';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // 경로의 coords(=[dep, ...via, arr])를 구간별 로그 행으로 변환. via 지점 이름은
  // 등록된 지점(스냅 반경 이내)이면 그 이름을, 아니면 좌표 표기를 사용한다
  function buildLogRows(r) {
    var coords = r.coords || [r.dep, r.arr];
    var n = coords.length;
    var cumDist = 0, cumTime = 0;
    var rows = [];
    for (var i = 0; i < n; i++) {
      var c = coords[i];
      var segDist = null, segTime = null;
      if (i > 0) {
        segDist = Calc.haversineNM(coords[i - 1].lat, coords[i - 1].lng, c.lat, c.lng);
        segTime = Calc.timeMin(segDist, 130);
        cumDist += segDist;
        cumTime += segTime;
      }
      var name;
      if (i === 0) name = r.depName;
      else if (i === n - 1) name = r.arrName;
      else name = Data.nearestPointName(c.lat, c.lng, SNAP_RADIUS_NM) || coordPointName(c);
      var fms = Calc.toFMS(c.lat, c.lng);
      rows.push({
        isDep: i === 0,
        isArr: i === n - 1,
        no: i === 0 ? '출발' : (i === n - 1 ? '도착' : circledNum(i)),
        name: name,
        fmsText: fms.lat + ' ' + fms.lng,
        seg: segDist,
        segTime: segTime,
        cumDist: cumDist,
        cumTime: cumTime,
        cumFuel: Math.round(PRE_FLIGHT_FUEL_LBS + Calc.fuelLbs(cumTime))
      });
    }
    return rows;
  }

  // nav_log_2-1A_preview_v2.html의 CSS를 그대로 사용 (A5 최적화 + 표 페이지분할 방지 추가)
  var NAV_LOG_STYLE =
    '* { box-sizing: border-box; margin: 0; padding: 0; }' +
    "body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; background: #525659; padding: 24px; }" +
    '.page { background: #fff; width: 148mm; min-height: 210mm; margin: 0 auto; padding: 10mm 8mm; color: #111; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }' +
    '.summary-box { border: 1.5px solid #111; page-break-inside: avoid; }' +
    '.summary-row1 { padding: 6px 10px; border-bottom: 1px solid #111; }' +
    '.summary-label { font-size: 8px; color: #666; letter-spacing: 0.5px; }' +
    '.summary-value { font-size: 14px; font-weight: 900; margin-top: 2px; line-height: 1.2; }' +
    '.summary-arrow { color: #d4610a; margin: 0 8px; }' +
    '.summary-row2 { display: flex; }' +
    '.stat-cell { flex: 1; padding: 6px 6px; border-right: 1px solid #ddd; text-align: center; }' +
    '.stat-cell:last-child { border-right: none; }' +
    '.stat-label { font-size: 8px; color: #666; }' +
    '.stat-value { font-size: 15px; font-weight: 900; margin-top: 2px; }' +
    '.stat-value.blue { color: #1a5fa8; } .stat-value.green { color: #1a7a3c; } .stat-value.orange { color: #d4610a; }' +
    '.stat-unit { font-size: 10px; font-weight: 700; }' +
    '.log-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }' +
    '.log-table th { background: #dceefc; color: #111; padding: 4px 3px; font-size: 10px; font-weight: 900; border: 1.5px solid #1a2634; text-align: center; }' +
    '.log-table td { border: 1px solid #999; padding: 4px 3px; text-align: center; font-weight: 700; font-size: 12px; }' +
    '.log-table td.wpt-name { text-align: left; padding-left: 8px; font-weight: 900; }' +
    '.wpt-coord { font-size: 13px; font-weight: 700; color: #333; margin-top: 2px; }' +
    '.log-table tr.dep-row td { background: #eaf7ee; } .log-table tr.arr-row td { background: #fdeaea; }' +
    '.log-table tr:nth-child(even):not(.dep-row):not(.arr-row) td { background: #f7f9fb; }' +
    '.no-cell { font-weight: 900; font-size: 11px; }' +
    '.no-cell.dep { color: #1a7a3c; font-size: 10px; } .no-cell.arr { color: #b83232; font-size: 10px; }' +
    '.log-table tr.total-row td { background: #dceefc; color: #111; font-weight: 900; font-size: 13px; border-color: #1a2634; }' +
    '.log-table tr { page-break-inside: avoid; } .log-table thead { display: table-header-group; }' +
    '.footer-note { margin-top: 8px; font-size: 8px; color: #111; page-break-inside: avoid; }' +
    '.print-btn { position: fixed; top: 20px; right: 20px; background: #111; color: #fff; border: none; border-radius: 8px; padding: 12px 20px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }' +
    '@media print { body { background: #fff; padding: 0; } .page { box-shadow: none; width: 100%; min-height: 0; } .print-btn { display: none; } @page { size: A5; margin: 8mm; } }';

  function buildLogRowHtml(row) {
    var trCls = row.isDep ? 'dep-row' : (row.isArr ? 'arr-row' : '');
    var noCls = row.isDep ? 'no-cell dep' : (row.isArr ? 'no-cell arr' : 'no-cell');
    return '<tr class="' + trCls + '">' +
      '<td class="' + noCls + '">' + row.no + '</td>' +
      '<td class="wpt-name">' + escapeHtml(row.name) + '<div class="wpt-coord">' + row.fmsText + '</div></td>' +
      '<td>' + (row.seg == null ? '—' : row.seg.toFixed(1)) + '</td>' +
      '<td>' + (row.segTime == null ? '—' : row.segTime.toFixed(1)) + '</td>' +
      '<td>' + row.cumDist.toFixed(1) + '</td>' +
      '<td>' + row.cumTime.toFixed(1) + '</td>' +
      '<td>' + row.cumFuel + '</td>' +
      '</tr>';
  }

  function buildNavLogHtml(r) {
    var rows = buildLogRows(r);
    var rowsHtml = rows.map(buildLogRowHtml).join('');
    var totalFuel = rows[rows.length - 1].cumFuel;
    var totalRow = '<tr class="total-row">' +
      '<td colspan="2">TOTAL</td>' +
      '<td>' + r.distNm.toFixed(1) + '</td>' +
      '<td>' + r.t130.toFixed(1) + '</td>' +
      '<td>—</td><td>—</td>' +
      '<td>' + totalFuel + '</td>' +
      '</tr>';
    return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
      '<title>항법경로 Log — ' + escapeHtml(r.name) + '</title>' +
      '<style>' + NAV_LOG_STYLE + '</style></head><body>' +
      '<button class="print-btn" onclick="window.print()">🖨️ 인쇄</button>' +
      '<div class="page">' +
      '<div class="summary-box">' +
      '<div class="summary-row1">' +
      '<div class="summary-label">ROUTE</div>' +
      '<div class="summary-value">' + escapeHtml(r.depName) + ' <span class="summary-arrow">→</span> ' + escapeHtml(r.arrName) + '</div>' +
      '<div style="margin-top:6px;font-size:13px;font-weight:700;color:#333">' + escapeHtml(r.name) + '</div>' +
      '</div>' +
      '<div class="summary-row2">' +
      '<div class="stat-cell"><div class="stat-label">총거리</div><div class="stat-value blue">' + r.distNm.toFixed(1) + '<span class="stat-unit">NM</span></div></div>' +
      '<div class="stat-cell"><div class="stat-label">130KTS 소요</div><div class="stat-value green">' + r.t130.toFixed(1) + '<span class="stat-unit">분</span></div></div>' +
      '<div class="stat-cell"><div class="stat-label">총연료</div><div class="stat-value orange">' + totalFuel + '<span class="stat-unit">LBS</span></div></div>' +
      '</div></div>' +
      '<table class="log-table"><thead><tr>' +
      '<th style="width:44px">No</th><th>지점명</th>' +
      '<th style="width:56px">구간<br>(NM)</th><th style="width:56px">소요<br>(분)</th>' +
      '<th style="width:56px">누적<br>거리</th><th style="width:56px">누적<br>시간</th><th style="width:62px">누적<br>연료</th>' +
      '</tr></thead><tbody>' + rowsHtml + totalRow + '</tbody></table>' +
      '<div class="footer-note">SK 항법지도 2.0 · ' + todayStr() + ' 출력 · 이륙전 사용량 ' + PRE_FLIGHT_FUEL_LBS + 'LBS 포함</div>' +
      '</div></body></html>';
  }

  function openNavLogPrint(r) {
    var win = window.open('', '_blank');
    if (!win) { toast('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요'); return; }
    win.document.open();
    win.document.write(buildNavLogHtml(r));
    win.document.close();
  }

  /* ── 마커 클릭 → 정보 시트 ── */
  function onMarkerClick(point, kind) {
    var typeLabel = (Data.LAYER_STYLES[kind] && Data.LAYER_STYLES[kind].label) || kind;
    var isReference = kind === 'cp' || kind === 'reportPoints';
    $id('m-name').textContent = point.name;
    $id('m-type').textContent = typeLabel;
    var fms = Calc.toFMS(point.lat, point.lng);
    var dms = Calc.toDMS(point.lat, point.lng);
    $id('m-fms-lat').textContent = fms.lat;
    $id('m-fms-lng').textContent = fms.lng;
    $id('m-dms-lat').textContent = dms.lat;
    $id('m-dms-lng').textContent = dms.lng;

    var related = isReference
      ? Data.ROUTES.filter(function (r) { return routePassesNear(r, point.lat, point.lng, SNAP_RADIUS_NM); })
      : Data.ROUTES.filter(function (r) { return r.depName === point.name || r.arrName === point.name; });
    var wrap = $id('related-routes');
    wrap.innerHTML = '';
    if (related.length === 0) {
      wrap.appendChild(el('div', 'empty-hint', '등록된 경로 없음'));
    } else {
      related.forEach(function (r) {
        var isDep = r.depName === point.name;
        var dir = isReference ? '경유' : (isDep ? '→' : '←');
        var dest = isReference ? (r.depName + ' → ' + r.arrName) : (isDep ? r.arrName : r.depName);
        var chip = el('div', 'related-chip');
        chip.appendChild(el('div', 'related-dir', dir));
        chip.appendChild(el('div', 'related-dest', dest));
        chip.appendChild(el('div', 'related-time', r.t130.toFixed(1) + '분 / ' + Math.round(r.fuel) + 'LBS'));
        chip.addEventListener('click', function () {
          selectRouteAndShow(r);
          closeSheet('marker-sheet');
        });
        wrap.appendChild(chip);
      });
    }

    // CP/ReportPoint는 참고전용(사용자 추가/수정 불가)이므로 수정/삭제 버튼을 숨긴다
    $id('marker-edit-btn').style.display = isReference ? 'none' : '';
    $id('marker-delete-btn').style.display = isReference ? 'none' : '';
    if (!isReference) {
      $id('marker-edit-btn').onclick = function () {
        closeSheet('marker-sheet');
        openEditPoint(kind, point);
      };
      $id('marker-delete-btn').onclick = function () {
        if (!confirm(point.name + '을(를) 정말 삭제하시겠어요?')) return;
        Data.deleteItemById(kind, point.id);
        Data.refreshFromLocal();
        MapView.renderMarkers(onMarkerClick);
        populatePointSelects();
        closeSheet('marker-sheet');
        toast('삭제되었습니다');
      };
    }

    updateMarkerRouteActions(point);
    openSheet('marker-sheet');
  }

  // 착륙장/SK착륙장/WayPoint 수정 폼 열기 — 해당 마커는 폼이 열려 있는 동안 드래그로 좌표 조정 가능
  function openEditPoint(kind, point) {
    editingPoint = { type: kind, id: point.id };
    if (kind === 'waypoints') {
      $id('aw-name').value = point.name;
      $id('aw-lat').value = point.lat;
      $id('aw-lng').value = point.lng;
      $id('aw-memo').value = point.memo || '';
      $id('add-waypoint-sheet').querySelector('.sheet-title').textContent = 'WayPoint 수정';
      openSheet('add-waypoint-sheet');
    } else {
      $id('al-name').value = point.name;
      $id('al-kind').value = kind;
      $id('al-lat').value = point.lat;
      $id('al-lng').value = point.lng;
      $id('al-memo').value = point.memo || '';
      $id('add-landing-sheet').querySelector('.sheet-title').textContent = '착륙장 수정';
      openSheet('add-landing-sheet');
    }
    MapView.setMarkerDraggable(kind, point.id, true, function (latlng) {
      var latId = kind === 'waypoints' ? 'aw-lat' : 'al-lat';
      var lngId = kind === 'waypoints' ? 'aw-lng' : 'al-lng';
      $id(latId).value = latlng.lat.toFixed(6);
      $id(lngId).value = latlng.lng.toFixed(6);
    });
  }

  /* ── 경로 선택/표시 ── */
  function selectRouteAndShow(r) {
    MapView.selectRoute(r);
    selectedRouteId = r.id;
    displayedRoute = r;
    $id('r-dist').textContent = r.distNm.toFixed(1);
    $id('r-130').textContent = r.t130.toFixed(1);
    $id('r-140').textContent = r.t140.toFixed(1);
    $id('r-fuel').textContent = Math.round(r.fuel);
    $id('result-bar').classList.add('show');
    $id('route-display').textContent = r.name;
    $id('route-sub').textContent = r.depName + ' → ' + r.arrName + ' · ' + r.distNm.toFixed(1) + 'NM · ' + r.t130.toFixed(1) + '분';
    $id('route-sub').style.display = '';
    $id('route-clear-btn').style.display = 'flex';
    $id('route-print-btn').classList.add('show');
    closeSheet('route-sheet');
  }

  function clearRouteSelection() {
    MapView.clearSelectedRoute();
    selectedRouteId = null;
    displayedRoute = null;
    $id('result-bar').classList.remove('show');
    $id('route-display').textContent = '항법경로 선택';
    $id('route-sub').textContent = '';
    $id('route-sub').style.display = 'none';
    $id('route-clear-btn').style.display = 'none';
    $id('route-print-btn').classList.remove('show');
  }

  /* ── 경로 검색 시트 (탭은 경로의 depGroup 필드로 필터링 — 레이어와 무관) ── */
  function computeDepGroups() {
    var groups = {};
    Data.ROUTES.forEach(function (r) { if (r.depGroup) groups[r.depGroup] = true; });
    return Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }

  function renderRouteTabs() {
    var tabRow = $id('route-tabs');
    tabRow.innerHTML = '';
    var tabs = [{ v: 'all', label: '전체' }, { v: 'fav', label: '⭐ 즐겨찾기' }];
    computeDepGroups().forEach(function (g) { tabs.push({ v: g, label: g }); });
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
  // 저장된 경로를 지도에서 직접 편집: 출발(S)/경유(①②..)/도착(E) 마커를 드래그 가능하게 표시하고,
  // 지도 누르기유지로 역할을 재지정할 수도 있게 한다. 이름/메모는 유지되고 좌표만 바뀐다 (id 기반 편집 재사용)
  function openEditRoute(r) {
    document.querySelectorAll('.sheet.open').forEach(function (s) { closeSheet(s.id); }); // 편집 중엔 지도가 인터랙션 가능해야 함
    populatePointSelects();
    editingRouteId = r.id;
    lpEditMode = true;
    lpFlowActive = true;
    lpDraftName = r.name;
    lpOrder = [];
    routeComposeActive = true;
    $id('ar-name').value = r.name;
    $id('ar-memo').value = r.memo || '';
    MapView.selectRoute(r);
    selectedRouteId = r.id;
    displayedRoute = r;
    $id('route-print-btn').classList.add('show');
    setDepArrPoint('dep', Data.ALL_POINTS.find(function (p) { return p.name === r.depName; }) || { name: r.depName, lat: r.dep.lat, lng: r.dep.lng });
    setDepArrPoint('arr', Data.ALL_POINTS.find(function (p) { return p.name === r.arrName; }) || { name: r.arrName, lat: r.arr.lat, lng: r.arr.lng });
    viaPoints = (r.coords || []).slice(1, -1).map(function (c) { return { lat: c.lat, lng: c.lng }; });
    showComposeBar();
    syncViaUI();
    toast('편집모드: 마커를 드래그하거나 지도를 누르기유지해 재지정하세요');
  }

  function renderRouteList() {
    var q = searchQuery.trim().toLowerCase();
    var list = Data.ROUTES.filter(function (r) {
      var matchTab = currentTab === 'all' ||
        (currentTab === 'fav' && Data.isFavorite(r.name)) ||
        (r.depGroup === currentTab);
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

  /* ── 레이어 시트 (10개 레이어 + 전체 항법경로 — layerStyles(JSON)에서 라벨/색상을 그대로 읽어 생성) ── */
  function buildLayerRow(key, label, color) {
    var row = el('div', 'layer-row');
    var labelDiv = el('div', 'layer-row-label');
    var dot = el('span', 'layer-dot');
    dot.style.background = color;
    labelDiv.appendChild(dot);
    labelDiv.appendChild(document.createTextNode(label));
    row.appendChild(labelDiv);
    var switchLabel = el('label', 'switch');
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'layer-' + key;
    input.addEventListener('change', function () { MapView.setLayerVisible(key, this.checked); });
    switchLabel.appendChild(input);
    switchLabel.appendChild(el('span', 'switch-track'));
    row.appendChild(switchLabel);
    return row;
  }

  function renderLayerRows() {
    var wrap = $id('layer-rows');
    wrap.innerHTML = '';
    LAYER_ORDER.forEach(function (type) {
      var style = Data.LAYER_STYLES[type] || { label: type, color: '#ffffff' };
      wrap.appendChild(buildLayerRow(type, style.label || type, style.color || '#ffffff'));
    });
    wrap.appendChild(buildLayerRow('routesAll', '전체 항법경로', '#00cc66'));
  }

  function syncLayerSheetUI() {
    var state = Data.getLayerState();
    LAYER_ORDER.concat(['routesAll']).forEach(function (key) {
      var input = $id('layer-' + key);
      if (input) input.checked = !!state[key];
    });
    $id('maptype-select').value = localStorage.getItem('skn_maptype') || 'hybrid';
  }

  /* ── 착륙장/WP/경로 추가 폼 ── */
  function populatePointSelects() {
    var points = Data.DB.sk_landings.concat(Data.DB.offsite_landings).concat(Data.DB.hospital_landings)
      .concat(Data.DB.ultralight_landings).concat(Data.DB.waypoints).slice().sort(function (a, b) {
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

  // 착륙장 추가 시트의 "종류" 드롭다운을 layerStyles(JSON)의 라벨로 채운다 (4종)
  function populateLandingKindSelect() {
    var sel = $id('al-kind');
    var current = sel.value;
    sel.innerHTML = '';
    LANDING_KINDS.forEach(function (type) {
      var style = Data.LAYER_STYLES[type] || {};
      var opt = el('option', null, style.label || type);
      opt.value = type;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  }

  function resetLandingForm() {
    if (editingPoint) MapView.setMarkerDraggable(editingPoint.type, editingPoint.id, false);
    $id('al-name').value = '';
    $id('al-lat').value = '';
    $id('al-lng').value = '';
    $id('al-memo').value = '';
    $id('al-kind').value = 'offsite_landings';
    editingPoint = null;
    $id('add-landing-sheet').querySelector('.sheet-title').textContent = '착륙장 추가';
  }
  function resetWaypointForm() {
    if (editingPoint) MapView.setMarkerDraggable(editingPoint.type, editingPoint.id, false);
    $id('aw-name').value = '';
    $id('aw-lat').value = '';
    $id('aw-lng').value = '';
    $id('aw-memo').value = '';
    editingPoint = null;
    $id('add-waypoint-sheet').querySelector('.sheet-title').textContent = 'WayPoint 추가';
  }
  function resetRouteForm() {
    $id('ar-name').value = '';
    ['ar-dep-select', 'ar-arr-select'].forEach(function (selectId) {
      var tempOpt = $id(selectId + '-temp-option');
      if (tempOpt) tempOpt.remove();
      $id(selectId).value = '';
    });
    $id('ar-memo').value = '';
    viaPoints = [];
    selectedDepPoint = null;
    selectedArrPoint = null;
    editingRouteId = null;
    routeComposeActive = false;
    lpFlowActive = false;
    lpEditMode = false;
    lpOrder = [];
    lpDraftName = null;
    hideComposeBar();
    MapView.clearDepMarker();
    MapView.clearArrMarker();
    MapView.clearMidpointMarkers();
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
    if (!name || !selectedDepPoint || !selectedArrPoint) { toast('이름, 출발지, 도착지를 입력하세요'); return; }
    if (selectedDepPoint.name === selectedArrPoint.name) { toast('출발지와 도착지가 같습니다'); return; }
    var depPt = selectedDepPoint;
    var arrPt = selectedArrPoint;
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
    $id('search-btn').addEventListener('click', openSearchSheet);
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
    $id('route-print-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      if (displayedRoute) openNavLogPrint(displayedRoute);
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

    // 장소 검색
    $id('place-search-go').addEventListener('click', runPlaceSearch);
    $id('place-search-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') runPlaceSearch();
    });
    $id('sr-close-btn').addEventListener('click', function () {
      MapView.clearSearchMarker();
      closeSheet('search-result-sheet');
    });
    $id('sr-add-landing-btn').addEventListener('click', function () {
      if (!currentSearchResult) return;
      MapView.clearSearchMarker();
      closeSheet('search-result-sheet');
      resetLandingForm();
      $id('al-name').value = currentSearchResult.name;
      $id('al-lat').value = currentSearchResult.lat.toFixed(6);
      $id('al-lng').value = currentSearchResult.lng.toFixed(6);
      $id('al-memo').value = currentSearchResult.address || '';
      openSheet('add-landing-sheet');
    });
    $id('sr-add-via-btn').addEventListener('click', function () {
      if (!currentSearchResult) return;
      viaPoints.push({ lat: currentSearchResult.lat, lng: currentSearchResult.lng });
      syncViaUI();
      MapView.clearSearchMarker();
      closeSheet('search-result-sheet');
      openSheet('add-route-sheet');
      toast('경유지로 추가되었습니다');
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
      routeComposeActive = true;
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
    $id('ar-search-via-btn').addEventListener('click', openSearchSheet);
    $id('ar-reset-via-btn').addEventListener('click', function () { viaPoints = []; syncViaUI(); });
    $id('ar-pick-deparr-btn').addEventListener('click', pickDepArr);
    $id('rpc-dep-btn').addEventListener('click', function () {
      if (!pendingRoutePoint) return;
      setDepArrPoint('dep', pendingRoutePoint);
      closeRoutePointChooser();
      toast('출발지로 선택되었습니다');
    });
    $id('rpc-arr-btn').addEventListener('click', function () {
      if (!pendingRoutePoint) return;
      setDepArrPoint('arr', pendingRoutePoint);
      closeRoutePointChooser();
      toast('도착지로 선택되었습니다');
    });
    $id('rpc-via-btn').addEventListener('click', function () {
      if (!pendingRoutePoint) return;
      viaPoints.push({ lat: pendingRoutePoint.lat, lng: pendingRoutePoint.lng });
      syncViaUI();
      closeRoutePointChooser();
      toast('경유지로 추가되었습니다');
    });
    $id('ar-save-btn').addEventListener('click', saveNewRoute);
    $id('ar-cancel-btn').addEventListener('click', function () { closeSheet('add-route-sheet'); resetRouteForm(); });

    // 지도 누르기유지(long-press) → 역할 선택 바텀시트
    $id('lp-snap-yes').addEventListener('click', lpSnapAccept);
    $id('lp-snap-no').addEventListener('click', lpSnapDecline);
    $id('lp-role-dep').addEventListener('click', function () { lpSelectRole('dep'); });
    $id('lp-role-via').addEventListener('click', function () { lpSelectRole('via'); });
    $id('lp-role-arr').addEventListener('click', function () { lpSelectRole('arr'); });
    $id('compose-undo-btn').addEventListener('click', lpUndoLast);
    $id('compose-cancel-btn').addEventListener('click', function () {
      if (confirm('작성 중인 경로를 취소할까요?')) lpCancelDraft();
    });
    MapView.setLongPressHandler(onMapLongPress);

    // 도착지 지정 완료 → 저장 확인 바텀시트 (이름 탭하면 입력창으로 전환)
    $id('lp-save-name-label').addEventListener('click', lpSaveNameEdit);
    $id('lp-save-name-input').addEventListener('blur', lpSaveNameCommit);
    $id('lp-save-name-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $id('lp-save-name-input').blur();
    });
    $id('lp-save-confirm-btn').addEventListener('click', function () {
      lpSaveNameCommit();
      if (selectedDepPoint.name === selectedArrPoint.name) {
        toast('출발지와 도착지가 같습니다');
        return;
      }
      closeSheet('lp-save-sheet');
      saveNewRoute();
    });
    $id('lp-save-cancel-btn').addEventListener('click', function () {
      closeSheet('lp-save-sheet');
      lpCancelDraft();
    });

    // 편집모드: 하단 액션바의 "💾 저장" — 기존 저장 로직(saveNewRoute)을 그대로 재사용해 id 기준으로 업데이트
    $id('compose-save-btn').addEventListener('click', saveNewRoute);

    // 경유점 마커: 어느 흐름(구 드롭다운/신규 롱프레스/편집모드)에서든 드래그·탭 삭제가 항상 동작하도록 앱 시작 시 한 번만 연결
    MapView.setViaPointCallbacks(onViaDrag, onViaMarkerClick);
    // 편집모드 구간 "+" 아이콘 탭 → 경유점 삽입
    MapView.setMidpointCallback(insertViaAtSegment);
    function pointFromSelect(sel) {
      var registered = Data.ALL_POINTS.find(function (p) { return p.name === sel.value; });
      if (registered) return registered;
      var opt = sel.selectedOptions[0];
      if (opt && opt.dataset.lat) return { name: sel.value, lat: parseFloat(opt.dataset.lat), lng: parseFloat(opt.dataset.lng) };
      return null;
    }
    $id('ar-dep-select').addEventListener('change', function () {
      selectedDepPoint = pointFromSelect(this);
      updateDraftPreview();
    });
    $id('ar-arr-select').addEventListener('change', function () {
      selectedArrPoint = pointFromSelect(this);
      updateDraftPreview();
    });

    // 레이어 시트 (change 리스너는 각 행 생성 시 buildLayerRow 안에서 연결됨)
    renderLayerRows();
    populateLandingKindSelect();
    $id('maptype-select').addEventListener('change', function () {
      MapView.setMapType(this.value);
      localStorage.setItem('skn_maptype', this.value);
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
