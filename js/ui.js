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
  // marker "kind"는 Data 타입 키(sk_landings/offsite_landings/hospital_landings/ultralight_landings/airports/waypoints)와 그대로 동일하게 사용한다
  var LAYER_ORDER = ['sk_landings', 'offsite_landings', 'hospital_landings', 'ultralight_landings', 'airports', 'cp', 'waypoints', 'ctrz', 'reportPoints', 'gwanjegwon', 'restricted'];
  var LANDING_KINDS = ['sk_landings', 'offsite_landings', 'airports', 'hospital_landings', 'ultralight_landings'];
  var landingPicker = null; // 착륙장 추가/수정 폼의 아이콘/색상 선택 컴포넌트 (init에서 mountPicker로 생성)
  var awKind = 'waypoints'; // add-waypoint-sheet에서 현재 선택된 종류('waypoints'|'reportPoints')
  var rpConvertId = null; // Report Point → 공항·비행장 종류 변경 대상 id (rp-convert-sheet가 열려있는 동안)
  var rpConvertPicker = null; // rp-convert-sheet의 아이콘/색상 선택 컴포넌트
  // 구역(CTRZ/관제권/금지위험제한공역) 편집(기존 항목 수정/삭제)
  var ZONE_KINDS = ['ctrz', 'gwanjegwon', 'restricted'];
  var RESTRICTED_GROUPS = ['P AREA', 'D AREA', 'R AREA', 'NOTAM구역']; // restricted의 group 값은 이 4종으로 고정
  var editingZonePoint = null; // { type, id } — restricted의 Point 항목(단순 좌표편집 폼) 수정 중일 때
  var editingZoneShape = null; // { type, id } — LineString/Polygon 항목을 지도에서 직접(editable) 편집 중일 때
  var zpColorPicker = null; // 구역 지점(zone-point-sheet) 색상 선택 컴포넌트
  var zeColorPicker = null; // 구역 도형(zone-edit-bar) 색상 선택 컴포넌트
  // 새 구역 그리기(신규 생성) — 자유그리기/원형/사각형
  var drawZone = null; // { type, group } — 종류/그리기방식 선택 시트에서 확정
  var drawMethod = null; // 'free' | 'circle' | 'rect' | null(그리기 중 아님)
  var drawPoints = []; // free: 탭한 점 전부. circle: [중심점]. rect: [모서리1, 모서리2]
  var drawFinalCoords = null; // 완료 버튼으로 확정된 최종 좌표 — 정보입력 폼에서 저장할 값
  var drawFinalGeomType = null; // 'LineString' | 'Polygon'
  var dziColorPicker = null; // 새 구역 정보입력 폼(draw-zone-info-sheet) 색상 선택 컴포넌트
  // 거리측정(일회성 도구 — 저장 안 함)
  var measureActive = false;
  var measurePoints = [];
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

  // 경유점 드래그 이동 → 좌표 갱신 (근처 등록지점이 있으면 스냅 제안)
  function onViaDrag(index, latlng) {
    resolveDragSnap(latlng, function (p) {
      viaPoints[index] = { lat: p.lat, lng: p.lng };
      syncViaUI();
    });
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

  // 출발/도착 마커 드래그 종료 → 좌표 갱신 (근처 등록지점이 있으면 스냅 제안; 없으면 이름은 그대로 두고 좌표만 갱신)
  function onDepDrag(latlng) {
    if (!selectedDepPoint) return;
    resolveDragSnap(latlng, function (p) {
      if (p.snapped) {
        setDepArrPoint('dep', { name: p.name, lat: p.lat, lng: p.lng });
      } else {
        selectedDepPoint = { name: selectedDepPoint.name, lat: p.lat, lng: p.lng };
        updateDraftPreview();
        updateComposeStats();
        refreshMidpointMarkers();
      }
    });
  }
  function onArrDrag(latlng) {
    if (!selectedArrPoint) return;
    resolveDragSnap(latlng, function (p) {
      if (p.snapped) {
        setDepArrPoint('arr', { name: p.name, lat: p.lat, lng: p.lng });
      } else {
        selectedArrPoint = { name: selectedArrPoint.name, lat: p.lat, lng: p.lng };
        updateDraftPreview();
        updateComposeStats();
        refreshMidpointMarkers();
      }
    });
  }

  // 편집모드 드래그/경유점삽입 스냅은 신규작성 롱프레스 스냅과 동일한 SNAP_RADIUS_NM(아래 정의)을 재사용
  var dragSnapPending = null; // { near, raw, apply } — 편집모드 드래그/경유점삽입 스냅 확인 대기 중일 때

  // 편집모드 마커 드래그·경유점 삽입 공용: 근처에 등록지점이 있으면 스냅 확인 카드를 띄우고,
  // 없으면 바로 apply(raw좌표)를 호출한다. apply는 { lat, lng, name, snapped } 형태의 결과를 받는다
  function resolveDragSnap(latlng, apply) {
    var near = Data.nearestPoint(latlng.lat, latlng.lng, SNAP_RADIUS_NM);
    if (!near) {
      apply({ lat: latlng.lat, lng: latlng.lng, name: null, snapped: false });
      return;
    }
    dragSnapPending = { near: near, raw: { lat: latlng.lat, lng: latlng.lng }, apply: apply };
    $id('drag-snap-name').textContent = near.name;
    openSheet('drag-snap-sheet');
  }

  function dragSnapAccept() {
    if (!dragSnapPending) return;
    var near = dragSnapPending.near, apply = dragSnapPending.apply;
    dragSnapPending = null;
    closeSheet('drag-snap-sheet');
    apply({ lat: near.lat, lng: near.lng, name: near.name, snapped: true });
  }

  function dragSnapDecline() {
    if (!dragSnapPending) return;
    var raw = dragSnapPending.raw, apply = dragSnapPending.apply;
    dragSnapPending = null;
    closeSheet('drag-snap-sheet');
    apply({ lat: raw.lat, lng: raw.lng, name: null, snapped: false });
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
  // (중간 좌표 근처에 등록지점이 있으면 드래그와 동일하게 스냅 제안)
  function insertViaAtSegment(segIndex) {
    var seq = [selectedDepPoint].concat(viaPoints).concat([selectedArrPoint]);
    var a = seq[segIndex], b = seq[segIndex + 1];
    if (!a || !b) return;
    var mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    resolveDragSnap(mid, function (p) {
      viaPoints.splice(segIndex, 0, { lat: p.lat, lng: p.lng });
      lpOrder.push('via');
      syncViaUI();
      toast('경유점이 추가되었습니다');
    });
  }

  function coordPointName(latlng) {
    return '좌표 ' + latlng.lat.toFixed(5) + ', ' + latlng.lng.toFixed(5);
  }

  /* ── 지도 누르기유지(long-press)로 시작하는 임시경로 작성 ── */

  // 이미 쓰인 "RouteNN" 이름과 겹치지 않는 다음 순번 이름을 만든다 (작성 중 임시 표시용)
  function nextDraftRouteName() {
    var used = {};
    Data.ROUTES.forEach(function (r) { used[r.name] = true; });
    var n = 1;
    while (used['Route' + String(n).padStart(2, '0')]) n++;
    return 'Route' + String(n).padStart(2, '0');
  }

  // 저장 시 기본 이름: "출발지명 - 도착지명". 이미 같은 이름의 경로가 있으면 " (2)", " (3)"... 을 붙인다
  function nextRouteName(depName, arrName) {
    var base = depName + ' - ' + arrName;
    var used = {};
    Data.ROUTES.forEach(function (r) { used[r.name] = true; });
    if (!used[base]) return base;
    var n = 2;
    while (used[base + ' (' + n + ')']) n++;
    return base + ' (' + n + ')';
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

  /* ── 거리측정 도구 — 경로작성/구역그리기와 동일한 "탭해서 점 찍기" + 미리보기선 인터랙션을
     재사용하되, 스냅이 없고 결과를 어디에도 저장하지 않는 일회성 도구 ── */
  function showMeasureBar() {
    $id('action-row-normal').style.display = 'none';
    $id('compose-row').style.display = 'none';
    $id('measure-row').style.display = 'flex';
  }
  function hideMeasureBar() {
    $id('measure-row').style.display = 'none';
    $id('action-row-normal').style.display = '';
  }

  function formatMeasureDistance(nm) {
    return nm.toFixed(1) + ' NM (' + (nm * 1.852).toFixed(1) + ' km)';
  }

  function updateMeasureDistance() {
    $id('measure-dist-value').textContent = formatMeasureDistance(Calc.routeDistanceNM(measurePoints));
  }

  function measureTapHandler(latlng) {
    measurePoints.push(latlng);
    MapView.setMeasurePoints(measurePoints);
    MapView.previewDraftRoute(measurePoints);
    MapView.clearRubberBand(); // 확정된 구간은 draftRoute가 이어받고, 다음 고무줄은 새 마지막점에서 다음 mousemove에 다시 시작
    updateMeasureDistance();
  }

  // 첫 점을 찍은 뒤 마우스를 움직이면 마지막 확정점→커서까지 고무줄 선을 그리고,
  // "확정 누적거리 + 커서까지 임시거리"를 합산해 총 거리에 즉시 반영한다(터치 기기는 mousemove가
  // 오지 않으므로 이 핸들러 자체가 호출되지 않아 자연히 탭-찍기만 동작함)
  function measureMouseMoveHandler(latlng) {
    if (measurePoints.length === 0) return;
    var last = measurePoints[measurePoints.length - 1];
    MapView.previewRubberBand(last, latlng);
    var total = Calc.routeDistanceNM(measurePoints) + Calc.haversineNM(last.lat, last.lng, latlng.lat, latlng.lng);
    $id('measure-dist-value').textContent = formatMeasureDistance(total);
  }

  function startMeasure() {
    measureActive = true;
    measurePoints = [];
    MapView.clearMeasurePoints();
    updateMeasureDistance();
    showMeasureBar();
    MapView.clearZoneClickHandler();
    MapView.setMapClickHandler(measureTapHandler);
    MapView.setRoutePointClickHandler(function (point) { measureTapHandler({ lat: point.lat, lng: point.lng }); });
    MapView.setMouseMoveHandler(measureMouseMoveHandler);
    toast('지도를 탭해 거리를 측정할 지점을 찍으세요');
  }

  function undoMeasurePoint() {
    if (measurePoints.length === 0) return;
    measurePoints.pop();
    MapView.setMeasurePoints(measurePoints);
    MapView.previewDraftRoute(measurePoints);
    MapView.clearRubberBand();
    updateMeasureDistance();
  }

  function endMeasure() {
    measureActive = false;
    measurePoints = [];
    MapView.clearMapClickHandler();
    MapView.clearRoutePointClickHandler();
    MapView.clearMouseMoveHandler();
    MapView.clearRubberBand();
    MapView.clearMeasurePoints();
    MapView.setZoneClickHandler(onZoneClick);
    MapView.clearDraftRoute();
    hideMeasureBar();
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
    // 드래그/경유점삽입 스냅 확인이 열려 있는 채로 취소되면, 이후 그 시트에서 예/아니오를 눌렀을 때
    // 이미 초기화된 상태를 참조하는 낡은 콜백(apply)이 실행되어 취소 후에도 마커가 되살아나는 등
    // 편집 상태가 남아있는 것처럼 보일 수 있다 — 대기 중이던 스냅 확인을 함께 무효화한다
    dragSnapPending = null;
    closeSheet('drag-snap-sheet');
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
    lpDraftName = nextRouteName(selectedDepPoint.name, selectedArrPoint.name);
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
      var em = String(e.message || '');
      var msg = (em.indexOf('REQUEST_DENIED') >= 0 || em.indexOf('PERMISSION_DENIED') >= 0 || em.indexOf('UNAUTHENTICATED') >= 0)
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

  // nav_log_2-1A_preview_v2.html의 CSS 기반, A4 기준으로 폰트/여백/컬럼폭 재조정 (표 페이지분할 방지 포함)
  var NAV_LOG_STYLE =
    '* { box-sizing: border-box; margin: 0; padding: 0; }' +
    "body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; background: #525659; padding: 24px; }" +
    '.page { background: #fff; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 15mm; color: #111; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }' +
    '.summary-box { border: 2px solid #111; page-break-inside: avoid; }' +
    '.summary-row1 { padding: 10px 16px; border-bottom: 1px solid #111; }' +
    '.summary-label { font-size: 10px; color: #666; letter-spacing: 0.5px; }' +
    '.summary-value { font-size: 20px; font-weight: 900; margin-top: 3px; line-height: 1.2; }' +
    '.summary-arrow { color: #d4610a; margin: 0 10px; }' +
    '.summary-row2 { display: flex; }' +
    '.stat-cell { flex: 1; padding: 10px 8px; border-right: 1px solid #ddd; text-align: center; }' +
    '.stat-cell:last-child { border-right: none; }' +
    '.stat-label { font-size: 10px; color: #666; }' +
    '.stat-value { font-size: 20px; font-weight: 900; margin-top: 3px; }' +
    '.stat-value.blue { color: #1a5fa8; } .stat-value.green { color: #1a7a3c; } .stat-value.orange { color: #d4610a; }' +
    '.stat-unit { font-size: 12px; font-weight: 700; }' +
    '.log-table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 15px; }' +
    '.log-table th { background: #dceefc; color: #111; padding: 10px 6px; font-size: 14px; font-weight: 900; border: 1.5px solid #1a2634; text-align: center; }' +
    '.log-table td { border: 1px solid #999; padding: 10px 6px; text-align: center; font-weight: 700; font-size: 16px; }' +
    '.log-table td.wpt-name { text-align: left; padding-left: 14px; font-weight: 900; }' +
    '.wpt-coord { font-size: 16px; font-weight: 700; color: #333; margin-top: 3px; }' +
    '.log-table tr.dep-row td { background: #eaf7ee; } .log-table tr.arr-row td { background: #fdeaea; }' +
    '.log-table tr:nth-child(even):not(.dep-row):not(.arr-row) td { background: #f7f9fb; }' +
    '.no-cell { font-weight: 900; font-size: 15px; }' +
    '.no-cell.dep { color: #1a7a3c; font-size: 14px; } .no-cell.arr { color: #b83232; font-size: 14px; }' +
    '.log-table tr.total-row td { background: #dceefc; color: #111; font-weight: 900; font-size: 17px; border-color: #1a2634; }' +
    '.log-table tr { page-break-inside: avoid; } .log-table thead { display: table-header-group; }' +
    '.footer-note { margin-top: 14px; font-size: 10px; color: #111; page-break-inside: avoid; }' +
    '.print-btn { position: fixed; top: 20px; right: 20px; background: #111; color: #fff; border: none; border-radius: 8px; padding: 12px 20px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }' +
    '@media print { body { background: #fff; padding: 0; } .page { box-shadow: none; width: 100%; min-height: 0; } .print-btn { display: none; } @page { size: A4; margin: 0; } }';

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
      '<th style="width:60px">No</th><th>지점명</th>' +
      '<th style="width:80px">구간<br>(NM)</th><th style="width:80px">소요<br>(분)</th>' +
      '<th style="width:80px">누적<br>거리</th><th style="width:80px">누적<br>시간</th><th style="width:88px">누적<br>연료</th>' +
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
    var isReadOnly = kind === 'cp'; // CP만 여전히 참고전용(사용자 추가/수정 불가) — Report Point는 이제 사용자 편집 가능
    var nearMatch = kind === 'cp' || kind === 'reportPoints'; // 이름이 dep/arr로 직접 쓰이기보다 경로가 "경유"하는 지점인 경우가 많음
    $id('m-name').textContent = point.name;
    $id('m-type').textContent = typeLabel;
    var fms = Calc.toFMS(point.lat, point.lng);
    var dms = Calc.toDMS(point.lat, point.lng);
    $id('m-fms-lat').textContent = fms.lat;
    $id('m-fms-lng').textContent = fms.lng;
    $id('m-dms-lat').textContent = dms.lat;
    $id('m-dms-lng').textContent = dms.lng;

    var related = nearMatch
      ? Data.ROUTES.filter(function (r) { return routePassesNear(r, point.lat, point.lng, SNAP_RADIUS_NM); })
      : Data.ROUTES.filter(function (r) { return r.depName === point.name || r.arrName === point.name; });
    var wrap = $id('related-routes');
    wrap.innerHTML = '';
    if (related.length === 0) {
      wrap.appendChild(el('div', 'empty-hint', '등록된 경로 없음'));
    } else {
      related.forEach(function (r) {
        var isDep = r.depName === point.name;
        var dir = nearMatch ? '경유' : (isDep ? '→' : '←');
        var dest = nearMatch ? (r.depName + ' → ' + r.arrName) : (isDep ? r.arrName : r.depName);
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

    // CP는 참고전용(사용자 추가/수정 불가)이므로 수정/삭제 버튼을 숨긴다
    $id('marker-edit-btn').style.display = isReadOnly ? 'none' : '';
    $id('marker-delete-btn').style.display = isReadOnly ? 'none' : '';
    if (!isReadOnly) {
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

  // 착륙장/SK착륙장/WayPoint/Report Point 수정 폼 열기 — 해당 마커는 폼이 열려 있는 동안 드래그로 좌표 조정 가능
  function openEditPoint(kind, point) {
    editingPoint = { type: kind, id: point.id };
    var isAw = kind === 'waypoints' || kind === 'reportPoints';
    if (isAw) {
      applyAwKindUI(kind);
      $id('aw-name').value = point.name;
      $id('aw-lat').value = point.lat;
      $id('aw-lng').value = point.lng;
      $id('aw-memo').value = point.memo || '';
      if (kind === 'reportPoints') $id('aw-group').value = point.group || '';
      $id('add-waypoint-title').textContent = (kind === 'reportPoints' ? '공항 Report Point' : 'WayPoint') + ' 수정';
      openSheet('add-waypoint-sheet');
    } else {
      $id('al-name').value = point.name;
      $id('al-kind').value = kind;
      $id('al-lat').value = point.lat;
      $id('al-lng').value = point.lng;
      $id('al-memo').value = point.memo || '';
      landingPicker.setValue(Icons.iconOf(kind, point), Icons.colorOf(kind, point));
      $id('add-landing-sheet').querySelector('.sheet-title').textContent = '착륙장 수정';
      openSheet('add-landing-sheet');
    }
    MapView.setMarkerDraggable(kind, point.id, true, function (latlng) {
      var latId = isAw ? 'aw-lat' : 'al-lat';
      var lngId = isAw ? 'aw-lng' : 'al-lng';
      $id(latId).value = latlng.lat.toFixed(6);
      $id(lngId).value = latlng.lng.toFixed(6);
    });
  }

  /* ── 구역(CTRZ/관제권/금지위험제한공역) 클릭 → 정보시트. 항목별 geomType에 따라 편집 방식이 갈린다:
     Point(restricted만 해당)는 착륙장류와 동일한 단순 좌표편집 폼, LineString/Polygon은 지도 위에서
     Google Maps의 editable 핸들로 직접 점을 드래그/삽입/삭제한다. 신규 생성 UI는 이번 단계에 없다. ── */
  function onZoneClick(item, type) {
    var typeLabel = (Data.LAYER_STYLES[type] && Data.LAYER_STYLES[type].label) || type;
    $id('z-name').textContent = item.name || '(이름 없음)';
    $id('z-type').textContent = typeLabel;
    if (item.group) {
      $id('zone-group-row').style.display = '';
      $id('z-group').textContent = item.group;
    } else {
      $id('zone-group-row').style.display = 'none';
    }
    $id('z-memo').textContent = item.memo || '(메모 없음)';
    if (item.geomType === 'Point') {
      $id('z-pointcount').textContent = '단일 지점';
    } else {
      var n = (item.coords || []).length;
      $id('z-pointcount').textContent = n + '개 꼭짓점 · ' + (Calc.isClosedRing(item.coords) ? '닫힌 구역' : '열린 선');
    }
    $id('zone-edit-btn').onclick = function () {
      closeSheet('zone-sheet');
      openZoneEdit(type, item);
    };
    $id('zone-delete-btn').onclick = function () {
      if (!confirm((item.name || '이 구역') + '을(를) 정말 삭제하시겠어요?')) return;
      Data.deleteItemById(type, item.id);
      Data.refreshFromLocal();
      MapView.renderMarkers(onMarkerClick);
      closeSheet('zone-sheet');
      toast('삭제되었습니다');
    };
    openSheet('zone-sheet');
  }

  function populateRestrictedGroupSelect(sel, current) {
    sel.innerHTML = '<option value="">선택안함</option>';
    RESTRICTED_GROUPS.forEach(function (g) {
      var opt = el('option', null, g);
      opt.value = g;
      sel.appendChild(opt);
    });
    sel.value = current || '';
  }

  function openZoneEdit(type, item) {
    if (item.geomType === 'Point') openZonePointEdit(type, item);
    else openZoneShapeEdit(type, item);
  }

  /* ── 구역 내 단일 지점(restricted의 Point 항목) 수정 — 착륙장 편집과 동일한 단순 좌표편집 폼 ── */
  function openZonePointEdit(type, item) {
    editingZonePoint = { type: type, id: item.id };
    $id('zp-name').value = item.name || '';
    populateRestrictedGroupSelect($id('zp-group'), item.group);
    $id('zp-lat').value = item.lat;
    $id('zp-lng').value = item.lng;
    $id('zp-memo').value = item.memo || '';
    zpColorPicker.setValue(Data.zoneColorOf(type, item));
    MapView.setMarkerDraggable(type, item.id, true, function (latlng) {
      $id('zp-lat').value = latlng.lat.toFixed(6);
      $id('zp-lng').value = latlng.lng.toFixed(6);
    });
    openSheet('zone-point-sheet');
  }

  function closeZonePointEdit() {
    if (editingZonePoint) MapView.setMarkerDraggable(editingZonePoint.type, editingZonePoint.id, false);
    editingZonePoint = null;
    closeSheet('zone-point-sheet');
  }

  function saveZonePoint() {
    if (!editingZonePoint) return;
    var name = $id('zp-name').value.trim();
    var lat = parseFloat($id('zp-lat').value);
    var lng = parseFloat($id('zp-lng').value);
    if (!name || isNaN(lat) || isNaN(lng)) { toast('이름과 좌표를 입력하세요'); return; }
    if (lat < 30 || lat > 43 || lng < 122 || lng > 133) { toast('좌표 범위를 확인하세요 (한국 인근)'); return; }
    var type = editingZonePoint.type, id = editingZonePoint.id;
    var fields = {
      name: name, lat: lat, lng: lng,
      group: $id('zp-group').value,
      memo: $id('zp-memo').value.trim(),
      color: zpColorPicker.getValue()
    };
    Data.updateItem(type, id, fields);
    Data.refreshFromLocal();
    MapView.setMarkerDraggable(type, id, false);
    editingZonePoint = null;
    MapView.renderMarkers(onMarkerClick);
    closeSheet('zone-point-sheet');
    toast('수정되었습니다');
  }

  /* ── 구역 도형(LineString/Polygon) 수정 — 지도 위 editable 핸들로 점을 직접 드래그/삽입/삭제 ── */
  function showZoneEditBar() { $id('zone-edit-bar').classList.add('show'); }
  function hideZoneEditBar() { $id('zone-edit-bar').classList.remove('show'); }

  function openZoneShapeEdit(type, item) {
    document.querySelectorAll('.sheet.open').forEach(function (s) { closeSheet(s.id); }); // 편집 중엔 지도가 인터랙션 가능해야 함
    editingZoneShape = { type: type, id: item.id };
    $id('ze-name').value = item.name || '';
    var isRestricted = type === 'restricted';
    $id('ze-group').style.display = isRestricted ? '' : 'none';
    if (isRestricted) populateRestrictedGroupSelect($id('ze-group'), item.group);
    zeColorPicker.setValue(Data.zoneColorOf(type, item));
    MapView.setZoneEditable(type, item.id, true);
    showZoneEditBar();
    toast('점을 드래그하거나 변 중간점을 드래그해 추가하세요');
  }

  function cancelZoneShapeEdit() {
    if (editingZoneShape) MapView.setZoneEditable(editingZoneShape.type, editingZoneShape.id, false);
    editingZoneShape = null;
    hideZoneEditBar();
    MapView.renderMarkers(onMarkerClick); // Data는 건드리지 않았으므로 다시 그리면 원본 모양으로 되돌아간다
  }

  function saveZoneShapeEdit() {
    if (!editingZoneShape) return;
    var type = editingZoneShape.type, id = editingZoneShape.id;
    var coords = MapView.getZonePath(type, id);
    if (!coords || coords.length < 2) { toast('좌표를 확인하세요'); return; }
    var fields = { name: $id('ze-name').value.trim(), color: zeColorPicker.getValue(), coords: coords };
    if (type === 'restricted') fields.group = $id('ze-group').value;
    Data.updateItem(type, id, fields);
    Data.refreshFromLocal();
    MapView.setZoneEditable(type, id, false);
    editingZoneShape = null;
    hideZoneEditBar();
    MapView.renderMarkers(onMarkerClick);
    toast('구역이 수정되었습니다');
  }

  /* ── 새 구역 그리기(신규 생성) — 자유그리기(탭해서 점 찍기, 기존 경로작성 인터랙션 재사용)/원형/사각형.
     3가지 방식 모두 좌표가 확정되면(finishDraw) 공통 정보입력 폼(이름/분류/색상/메모)으로 넘어간다. ── */
  function populateZoneKindSelect() {
    var sel = $id('dz-kind');
    var current = sel.value;
    sel.innerHTML = '';
    ZONE_KINDS.forEach(function (type) {
      var style = Data.LAYER_STYLES[type] || {};
      var opt = el('option', null, style.label || type);
      opt.value = type;
      sel.appendChild(opt);
    });
    sel.value = current || 'ctrz';
  }

  function syncDrawZoneKindUI() {
    var isRestricted = $id('dz-kind').value === 'restricted';
    $id('dz-group-field').style.display = isRestricted ? '' : 'none';
    if (isRestricted) populateRestrictedGroupSelect($id('dz-group'), $id('dz-group').value);
  }

  function resetDrawZoneStartSheet() {
    populateZoneKindSelect();
    syncDrawZoneKindUI();
  }

  // 그리기 중엔 기존 마커/구역 클릭이 정보시트를 열지 않고 대신 그 좌표를 그리기 점으로 사용하게 리다이렉트한다
  // (routePointClickHandler는 착륙장/WP/구역 마커 클릭에 이미 쓰이는 기존 훅을 그대로 재사용)
  function beginZoneDrawInteraction() {
    MapView.clearZoneClickHandler();
    MapView.setMapClickHandler(drawTapHandler);
    MapView.setRoutePointClickHandler(function (point) { drawTapHandler({ lat: point.lat, lng: point.lng }); });
  }
  function endZoneDrawInteraction() {
    MapView.clearMapClickHandler();
    MapView.clearRoutePointClickHandler();
    MapView.setZoneClickHandler(onZoneClick);
  }

  function showZoneDrawBar() { $id('zone-draw-bar').classList.add('show'); }
  function hideZoneDrawBar() { $id('zone-draw-bar').classList.remove('show'); }

  function updateZoneDrawButtons() {
    var isFree = drawMethod === 'free';
    var isCircleOrRect = drawMethod === 'circle' || drawMethod === 'rect';
    $id('zdb-line-btn').style.display = isFree ? '' : 'none';
    $id('zdb-poly-btn').style.display = isFree ? '' : 'none';
    $id('zdb-done-btn').style.display = isCircleOrRect ? '' : 'none';
    if (isFree) {
      $id('zdb-line-btn').disabled = drawPoints.length < 2;
      $id('zdb-poly-btn').disabled = drawPoints.length < 3;
    } else if (drawMethod === 'circle') {
      var r = parseFloat($id('zdb-radius').value);
      $id('zdb-done-btn').disabled = !(drawPoints.length >= 1 && r > 0);
    } else if (drawMethod === 'rect') {
      $id('zdb-done-btn').disabled = drawPoints.length < 2;
    }
  }

  function rectCoords(a, b) {
    return [
      { lat: a.lat, lng: a.lng },
      { lat: a.lat, lng: b.lng },
      { lat: b.lat, lng: b.lng },
      { lat: b.lat, lng: a.lng },
      { lat: a.lat, lng: a.lng }
    ];
  }

  function updateCirclePreview() {
    var r = parseFloat($id('zdb-radius').value);
    if (drawPoints.length < 1 || !(r > 0)) { MapView.clearDraftRoute(); return; }
    MapView.previewDraftRoute(MapView.circlePolygonCoords(drawPoints[0], r));
  }

  // 방식별 지도 탭 처리 — 빈 지도 탭(mapClickHandler)과 기존 마커/구역 탭(routePointClickHandler 리다이렉트) 공용
  function drawTapHandler(latlng) {
    if (drawMethod === 'free') {
      drawPoints.push(latlng);
      $id('zdb-hint').textContent = '지도를 탭해 점을 추가하세요 (' + drawPoints.length + '개)';
      MapView.previewDraftRoute(drawPoints);
    } else if (drawMethod === 'circle') {
      drawPoints = [latlng];
      $id('zdb-radius-row').style.display = '';
      $id('zdb-hint').textContent = '반경(NM)을 입력하세요';
      updateCirclePreview();
    } else if (drawMethod === 'rect') {
      if (drawPoints.length === 0) {
        drawPoints = [latlng];
        $id('zdb-hint').textContent = '반대편(대각선) 모서리를 탭하세요';
      } else {
        drawPoints[1] = latlng;
        $id('zdb-hint').textContent = '반대편 모서리를 다시 탭하면 위치를 바꿀 수 있어요';
        MapView.previewDraftRoute(rectCoords(drawPoints[0], drawPoints[1]));
      }
    }
    updateZoneDrawButtons();
  }

  function startDraw(method) {
    drawMethod = method;
    drawPoints = [];
    $id('zdb-radius-row').style.display = 'none';
    $id('zdb-radius').value = '';
    $id('zdb-hint').textContent = method === 'free' ? '지도를 탭해 점을 추가하세요 (0개)' :
      method === 'circle' ? '지도를 탭해 중심점을 선택하세요' : '첫 번째 모서리를 탭하세요';
    updateZoneDrawButtons();
    showZoneDrawBar();
    beginZoneDrawInteraction();
  }

  function resetDrawState() {
    drawMethod = null;
    drawPoints = [];
    endZoneDrawInteraction();
    MapView.clearDraftRoute();
    hideZoneDrawBar();
  }

  function finishDraw(coords, geomType) {
    drawFinalCoords = coords;
    drawFinalGeomType = geomType;
    resetDrawState();
    $id('dzi-name').value = '';
    $id('dzi-memo').value = '';
    var isRestricted = drawZone.type === 'restricted';
    $id('dzi-group-row').style.display = isRestricted ? '' : 'none';
    if (isRestricted) $id('dzi-group-val').textContent = drawZone.group || '(선택안함)';
    dziColorPicker.setValue(Data.zoneColorOf(drawZone.type, {}));
    openSheet('draw-zone-info-sheet');
  }

  function finishFreeDrawAsLine() {
    if (drawPoints.length < 2) return;
    finishDraw(drawPoints.slice(), 'LineString');
  }
  function finishFreeDrawAsPolygon() {
    if (drawPoints.length < 3) return;
    finishDraw(drawPoints.concat([{ lat: drawPoints[0].lat, lng: drawPoints[0].lng }]), 'Polygon');
  }
  function finishCircleDraw() {
    var r = parseFloat($id('zdb-radius').value);
    if (drawPoints.length < 1 || !(r > 0)) return;
    finishDraw(MapView.circlePolygonCoords(drawPoints[0], r), 'Polygon');
  }
  function finishRectDraw() {
    if (drawPoints.length < 2) return;
    finishDraw(rectCoords(drawPoints[0], drawPoints[1]), 'Polygon');
  }

  function cancelDrawZoneInfo() {
    closeSheet('draw-zone-info-sheet');
    drawZone = null;
    drawFinalCoords = null;
    drawFinalGeomType = null;
  }

  function saveDrawZone() {
    var name = $id('dzi-name').value.trim();
    if (drawZone.type !== 'gwanjegwon' && !name) { toast('이름을 입력하세요'); return; }
    var fields = {
      name: name,
      memo: $id('dzi-memo').value.trim(),
      color: dziColorPicker.getValue(),
      geomType: drawFinalGeomType,
      coords: drawFinalCoords
    };
    if (drawZone.type === 'restricted') fields.group = drawZone.group;
    Data.addUserPoint(drawZone.type, fields);
    Data.refreshFromLocal();
    MapView.renderMarkers(onMarkerClick);
    closeSheet('draw-zone-info-sheet');
    drawZone = null;
    drawFinalCoords = null;
    drawFinalGeomType = null;
    toast('구역이 추가되었습니다');
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
    var icon = el('div', 'rc-icon');
    // 로고(top-bar)에서 쓰는 헬기 SVG 재사용 — index.html .logo-icon과 동일한 마크업
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">'
      + '<line x1="2" y1="5" x2="22" y2="5"/><line x1="12" y1="5" x2="12" y2="8"/><rect x="6" y="8" width="11" height="7" rx="3.5"/>'
      + '<line x1="17" y1="12" x2="21" y2="15"/><line x1="21" y1="12.5" x2="21" y2="17"/><line x1="8" y1="15" x2="6.5" y2="19"/>'
      + '<line x1="14" y1="15" x2="14.5" y2="19"/><line x1="5.5" y1="19" x2="15.5" y2="19"/></svg>';
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

  /* ── 레이어 시트 (11개 레이어 + 전체 항법경로 — layerStyles(JSON)에서 라벨/색상을 그대로 읽어 생성) ── */
  // 착륙장류 5종(레이어별 아이콘/색상 일괄변경 편집버튼을 붙일 대상)
  var BULK_EDITABLE_TYPES = { sk_landings: 1, offsite_landings: 1, hospital_landings: 1, ultralight_landings: 1, airports: 1 };
  var BULK_EDIT_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 20l1-4.5L15.5 5 19 8.5 8.5 19 4 20Z"/><path d="M13.5 6.5 17.5 10.5"/></svg>';

  function buildLayerRow(key, label, color, bulkEditable) {
    var row = el('div', 'layer-row');
    var labelDiv = el('div', 'layer-row-label');
    var dot = el('span', 'layer-dot');
    dot.style.background = color;
    labelDiv.appendChild(dot);
    labelDiv.appendChild(document.createTextNode(label));
    row.appendChild(labelDiv);

    var right = el('div', 'layer-row-right');
    if (bulkEditable) {
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'layer-edit-btn';
      editBtn.setAttribute('aria-label', label + ' 아이콘·색상 일괄변경');
      editBtn.innerHTML = BULK_EDIT_ICON_SVG;
      editBtn.addEventListener('click', function () { openBulkStyleSheet(key, label); });
      right.appendChild(editBtn);
    }
    var switchLabel = el('label', 'switch');
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'layer-' + key;
    input.addEventListener('change', function () { MapView.setLayerVisible(key, this.checked); });
    switchLabel.appendChild(input);
    switchLabel.appendChild(el('span', 'switch-track'));
    right.appendChild(switchLabel);
    row.appendChild(right);
    return row;
  }

  function renderLayerRows() {
    var wrap = $id('layer-rows');
    wrap.innerHTML = '';
    LAYER_ORDER.forEach(function (type) {
      var style = Data.LAYER_STYLES[type] || { label: type, color: '#ffffff' };
      wrap.appendChild(buildLayerRow(type, style.label || type, style.color || '#ffffff', !!BULK_EDITABLE_TYPES[type]));
    });
    wrap.appendChild(buildLayerRow('routesAll', '전체 항법경로', '#00cc66', false));
  }

  // ── 레이어별 아이콘/색상 일괄변경 ──
  var bulkStylePicker = null;
  var bulkStyleType = null;
  var bulkStyleLabel = null;

  function openBulkStyleSheet(type, label) {
    bulkStyleType = type;
    bulkStyleLabel = label;
    closeSheet('layer-sheet');
    $id('bulk-style-title').textContent = label + ' 일괄변경';
    bulkStylePicker.setValue(Icons.defaultIcon(type), Icons.defaultColor(type));
    openSheet('bulk-style-sheet');
  }

  function applyBulkStyle() {
    var picked = bulkStylePicker.getValue();
    var count = Data.DB[bulkStyleType].length;
    if (!confirm(bulkStyleLabel + ' ' + count + '개 항목의 아이콘·색상이 모두 변경됩니다. 개별 설정도 덮어씌워집니다. 계속하시겠습니까?')) return;
    Data.bulkSetTypeIconColor(bulkStyleType, picked.icon, picked.color);
    Data.refreshFromLocal();
    MapView.renderMarkers(onMarkerClick);
    closeSheet('bulk-style-sheet');
    toast(bulkStyleLabel + ' ' + count + '개 항목이 일괄 변경되었습니다');
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
      .concat(Data.DB.ultralight_landings).concat(Data.DB.airports).concat(Data.DB.waypoints).slice().sort(function (a, b) {
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

  // WayPoint 추가 시트의 "소속 공항" 드롭다운을 기존 Report Point들의 group 코드로 채운다
  function populateReportPointGroupSelect() {
    var sel = $id('aw-group');
    var current = sel.value;
    sel.innerHTML = '<option value="">선택하세요</option>';
    Data.reportPointGroups().forEach(function (code) {
      var opt = el('option', null, code);
      opt.value = code;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  }

  // 종류 토글 버튼/소속공항 필드 표시 갱신 — WayPoint/Report Point는 아이콘/색상을 타입별 고정값으로
  // 통일하므로(항법 보조 표식은 사용자마다 다르게 보이면 혼란을 줌) 별도 선택 UI는 두지 않는다
  function applyAwKindUI(kind) {
    awKind = kind;
    $id('aw-kind-waypoints').classList.toggle('active', kind === 'waypoints');
    $id('aw-kind-reportPoints').classList.toggle('active', kind === 'reportPoints');
    $id('aw-group-field').style.display = kind === 'reportPoints' ? '' : 'none';
    if (kind === 'reportPoints') populateReportPointGroupSelect();
    // "공항·비행장으로 변경"은 기존 Report Point를 수정하는 중일 때만 의미가 있다(신규 작성/WayPoint 제외)
    $id('aw-convert-airport-btn').style.display = (editingPoint && kind === 'reportPoints') ? '' : 'none';
  }

  function resetLandingForm() {
    if (editingPoint) MapView.setMarkerDraggable(editingPoint.type, editingPoint.id, false);
    $id('al-name').value = '';
    $id('al-lat').value = '';
    $id('al-lng').value = '';
    $id('al-memo').value = '';
    $id('al-kind').value = 'offsite_landings';
    landingPicker.setValue(Icons.defaultIcon('offsite_landings'), Icons.defaultColor('offsite_landings'));
    editingPoint = null;
    $id('add-landing-sheet').querySelector('.sheet-title').textContent = '착륙장 추가';
  }
  function resetWaypointForm() {
    if (editingPoint) MapView.setMarkerDraggable(editingPoint.type, editingPoint.id, false);
    $id('aw-name').value = '';
    $id('aw-lat').value = '';
    $id('aw-lng').value = '';
    $id('aw-memo').value = '';
    $id('aw-group').value = '';
    applyAwKindUI('waypoints');
    editingPoint = null;
    $id('add-waypoint-title').textContent = 'WayPoint 추가';
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
    var picked = landingPicker.getValue();
    var fields = { name: name, lat: lat, lng: lng, memo: $id('al-memo').value.trim(), icon: picked.icon, color: picked.color };
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
    var kind = awKind;
    // 아이콘/색상은 항법 보조 표식 성격상 개인화하지 않고 타입별 고정값으로 저장한다
    var fields = { name: name, lat: lat, lng: lng, memo: $id('aw-memo').value.trim(), icon: Icons.defaultIcon(kind), color: Icons.defaultColor(kind) };
    if (kind === 'reportPoints') fields.group = $id('aw-group').value;
    var wasEditing = !!editingPoint;
    if (editingPoint) {
      if (editingPoint.type === kind) {
        Data.updateItem(kind, editingPoint.id, fields);
      } else {
        // 종류(WayPoint ↔ Report Point)가 바뀌면 기존 항목을 지우고 새 종류로 다시 추가한다
        Data.deleteItemById(editingPoint.type, editingPoint.id);
        Data.addUserPoint(kind, fields);
      }
    } else {
      Data.addUserPoint(kind, fields);
    }
    Data.refreshFromLocal();
    MapView.renderMarkers(onMarkerClick);
    closeSheet('add-waypoint-sheet');
    resetWaypointForm();
    var kindLabel = kind === 'reportPoints' ? 'Report Point' : 'WayPoint';
    toast(wasEditing ? kindLabel + '가 수정되었습니다' : kindLabel + '가 추가되었습니다');
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

  /* ── 클라우드 동기화 ── */
  var syncInFlight = false;
  function runCloudSync(silent) {
    if (syncInFlight) return;
    syncInFlight = true;
    var btn = $id('sync-btn');
    if (btn) btn.disabled = true;
    Data.syncFromCloud().then(function (result) {
      MapView.renderMarkers(onMarkerClick);
      populatePointSelects();
      renderRouteTabs();
      renderRouteList();
      if (result && result.uploaded) {
        toast('동기화 완료 (신규 ' + result.uploaded + '건 업로드)');
      } else if (!silent) {
        toast('동기화 완료 (최신 상태)');
      }
    }).catch(function (err) {
      console.warn('[Sync] 불러오기 실패', err);
      toast('동기화 실패, 최신 데이터를 받아오지 못했습니다');
    }).finally(function () {
      syncInFlight = false;
      if (btn) btn.disabled = false;
    });
  }

  // 레이어 시트 하단의 버전 표시 + 브라우저 탭 제목 — version.json에서 읽어와 채운다(하드코딩 금지).
  // 커밋 훅이 매 커밋마다 version.json을 갱신하므로 항상 최신 배포 버전을 반영한다.
  function loadAppVersion() {
    fetch('./version.json', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.version) return;
        $id('app-version').textContent = 'v' + data.version;
        document.title = 'SK 항법지도 ' + data.version;
      })
      .catch(function () { /* 장식용 정보라 실패해도 조용히 무시 */ });
  }

  /* ── 초기화: 이벤트 연결 ── */
  function init() {
    loadAppVersion();
    // 상단바 / 하단바
    $id('search-btn').addEventListener('click', openSearchSheet);
    $id('layer-btn').addEventListener('click', function () { syncLayerSheetUI(); openSheet('layer-sheet'); });
    $id('sync-btn').addEventListener('click', function () { runCloudSync(false); });
    $id('measure-btn').addEventListener('click', startMeasure);
    $id('measure-undo-btn').addEventListener('click', undoMeasurePoint);
    $id('measure-done-btn').addEventListener('click', endMeasure);
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

    // 구역(CTRZ/관제권/금지위험제한공역) 시트 — 기존 항목 수정/삭제만(신규 추가 없음)
    $id('zone-close-btn').addEventListener('click', function () { closeSheet('zone-sheet'); });
    $id('zp-pick-btn').addEventListener('click', function () {
      pickLocation(function (latlng) {
        $id('zp-lat').value = latlng.lat.toFixed(6);
        $id('zp-lng').value = latlng.lng.toFixed(6);
      });
    });
    $id('zp-save-btn').addEventListener('click', saveZonePoint);
    $id('zp-cancel-btn').addEventListener('click', closeZonePointEdit);
    $id('zone-edit-save-btn').addEventListener('click', saveZoneShapeEdit);
    $id('zone-edit-cancel-btn').addEventListener('click', cancelZoneShapeEdit);
    zpColorPicker = Icons.mountColorPicker($id('zp-color-row'), Icons.COLORS[0], function (hex) {
      if (editingZonePoint) MapView.setZoneColor(editingZonePoint.type, editingZonePoint.id, hex);
    });
    zeColorPicker = Icons.mountColorPicker($id('ze-color-row'), Icons.COLORS[0], function (hex) {
      if (editingZoneShape) MapView.setZoneColor(editingZoneShape.type, editingZoneShape.id, hex);
    });
    MapView.setZoneClickHandler(onZoneClick);

    // 새 구역 그리기 (신규 생성)
    $id('dz-kind').addEventListener('change', syncDrawZoneKindUI);
    $id('dz-cancel-btn').addEventListener('click', function () { closeSheet('draw-zone-start-sheet'); });
    $id('dz-method-free').addEventListener('click', function () {
      drawZone = { type: $id('dz-kind').value, group: $id('dz-kind').value === 'restricted' ? $id('dz-group').value : null };
      closeSheet('draw-zone-start-sheet');
      startDraw('free');
    });
    $id('dz-method-circle').addEventListener('click', function () {
      drawZone = { type: $id('dz-kind').value, group: $id('dz-kind').value === 'restricted' ? $id('dz-group').value : null };
      closeSheet('draw-zone-start-sheet');
      startDraw('circle');
    });
    $id('dz-method-rect').addEventListener('click', function () {
      drawZone = { type: $id('dz-kind').value, group: $id('dz-kind').value === 'restricted' ? $id('dz-group').value : null };
      closeSheet('draw-zone-start-sheet');
      startDraw('rect');
    });
    $id('zdb-radius').addEventListener('input', function () { updateCirclePreview(); updateZoneDrawButtons(); });
    $id('zdb-line-btn').addEventListener('click', finishFreeDrawAsLine);
    $id('zdb-poly-btn').addEventListener('click', finishFreeDrawAsPolygon);
    $id('zdb-done-btn').addEventListener('click', function () {
      if (drawMethod === 'circle') finishCircleDraw();
      else if (drawMethod === 'rect') finishRectDraw();
    });
    $id('zdb-cancel-btn').addEventListener('click', function () {
      resetDrawState();
      drawZone = null;
      toast('그리기를 취소했습니다');
    });
    $id('dzi-cancel-btn').addEventListener('click', cancelDrawZoneInfo);
    $id('dzi-save-btn').addEventListener('click', saveDrawZone);
    dziColorPicker = Icons.mountColorPicker($id('dzi-color-row'), Icons.COLORS[0]);
    $id('menu-draw-zone').addEventListener('click', function () {
      closeSheet('add-menu');
      resetDrawZoneStartSheet();
      openSheet('draw-zone-start-sheet');
    });

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
    $id('aw-kind-waypoints').addEventListener('click', function () { applyAwKindUI('waypoints'); });
    $id('aw-kind-reportPoints').addEventListener('click', function () { applyAwKindUI('reportPoints'); });
    $id('aw-pick-btn').addEventListener('click', function () {
      pickLocation(function (latlng) {
        $id('aw-lat').value = latlng.lat.toFixed(6);
        $id('aw-lng').value = latlng.lng.toFixed(6);
      });
    });
    $id('aw-save-btn').addEventListener('click', saveNewWaypoint);
    $id('aw-cancel-btn').addEventListener('click', function () { closeSheet('add-waypoint-sheet'); resetWaypointForm(); });
    // 공항 Report Point → 공항·비행장 종류 변경 (단방향, 기존 편집 폼 안의 버튼에서 진입)
    $id('aw-convert-airport-btn').addEventListener('click', function () {
      if (!editingPoint || editingPoint.type !== 'reportPoints') return;
      if (!confirm('이 지점을 공항·비행장으로 변경합니다. 계속하시겠습니까?')) return;
      rpConvertId = editingPoint.id;
      closeSheet('add-waypoint-sheet');
      resetWaypointForm();
      rpConvertPicker.setValue(Icons.defaultIcon('airports'), Icons.defaultColor('airports'));
      openSheet('rp-convert-sheet');
    });
    $id('rp2ap-cancel-btn').addEventListener('click', function () {
      rpConvertId = null;
      closeSheet('rp-convert-sheet');
    });
    $id('rp2ap-done-btn').addEventListener('click', function () {
      if (!rpConvertId) return;
      var picked = rpConvertPicker.getValue();
      var newItem = Data.convertReportPointToAirport(rpConvertId, picked.icon, picked.color);
      rpConvertId = null;
      closeSheet('rp-convert-sheet');
      if (!newItem) { toast('변경에 실패했습니다'); return; }
      Data.refreshFromLocal();
      MapView.renderMarkers(onMarkerClick);
      populatePointSelects();
      toast('공항·비행장으로 변경되었습니다');
    });

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
    $id('drag-snap-yes').addEventListener('click', dragSnapAccept);
    $id('drag-snap-no').addEventListener('click', dragSnapDecline);
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
    landingPicker = Icons.mountPicker($id('al-icon-grid'), $id('al-color-row'),
      Icons.defaultIcon('offsite_landings'), Icons.defaultColor('offsite_landings'));
    rpConvertPicker = Icons.mountPicker($id('rp2ap-icon-grid'), $id('rp2ap-color-row'),
      Icons.defaultIcon('airports'), Icons.defaultColor('airports'));
    bulkStylePicker = Icons.mountPicker($id('bulk-icon-grid'), $id('bulk-color-row'),
      Icons.PRESETS[0], Icons.COLORS[0]);
    $id('bulk-style-cancel-btn').addEventListener('click', function () { closeSheet('bulk-style-sheet'); });
    $id('bulk-style-apply-btn').addEventListener('click', applyBulkStyle);
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
    closeSheet: closeSheet,
    runCloudSync: runCloudSync
  };
})(window);
