/* SK 항법지도 2.0 — 구글 위성지도 렌더링 */
(function (global) {
  'use strict';

  var map = null;
  // 사용자가 추가/편집 가능한 "장소" 레이어 (marker-sheet 클릭 인터랙션 있음)
  var POINT_LAYER_TYPES = ['sk_landings', 'offsite_landings', 'hospital_landings', 'ultralight_landings', 'airports', 'waypoints', 'reportPoints'];
  // 마커 크기(px) — 지정 없으면 착륙장류 기본값(30)
  var POINT_MARKER_SIZE = { waypoints: 16, reportPoints: 12 };
  // 구역 레이어(CTRZ/관제권/금지위험제한공역) — Point/LineString/Polygon 혼재, 항목별 클릭 가능(수정/삭제),
  // 단 이번 단계는 신규 추가 UI가 없으므로 기존 항목만 대상
  var ZONE_TYPES = ['ctrz', 'gwanjegwon', 'restricted'];
  var zoneClickHandler = null; // ui.js가 구역 클릭 시 정보시트를 열기 위해 설정
  var markers = { sk_landings: [], offsite_landings: [], hospital_landings: [], ultralight_landings: [], airports: [], waypoints: [], cp: [], ctrz: [], gwanjegwon: [], restricted: [], reportPoints: [] };
  var allRouteLines = []; // 전체 경로(초록, 얇음) — 레이어 ON시만 지도에 부착
  var selectedPolyline = null; // 저장된 경로 선택 시(오렌지) — 레이어 설정과 무관하게 항상 표시
  var draftPolyline = null; // 작성 중인(미저장) 경로 미리보기(노랑) — 레이어 설정과 무관하게 항상 표시
  var viaMarkers = []; // 경로 작성 중 경유점 마커(드래그 가능)
  var viaDragHandler = null;
  var viaClickHandler = null;
  var mapClickHandler = null; // ui.js가 지도탭으로 좌표를 받을 때 설정
  var mouseMoveHandler = null; // ui.js가 거리측정 중 고무줄(rubber-band) 라인 갱신을 위해 설정 — 터치 기기는 mousemove가 안 오므로 자연히 비활성
  var searchMarker = null; // 장소 검색 결과 임시 마커(보라)
  var routePointClickHandler = null; // 설정되어 있으면 sk/land/wp 마커 탭 시 정보시트 대신 이 콜백(point, kind)으로 전달
  var measurePointMarkers = []; // 거리측정 중 확정된 점마다 찍는 노란 점 마커
  var rubberBandLine = null; // 거리측정: 마지막 확정점 → 현재 커서까지 실시간으로 늘어나는 임시선

  // ── 지도 누르기 유지(long-press) 감지 ──
  // 지도 스크롤(팬) 제스처와 반드시 구분되어야 하므로, 누른 지점에서 화면 픽셀거리(LONG_PRESS_TOL_PX) 이상
  // 움직이면 즉시 타이머를 취소한다. mapClickHandler(기존 지도탭 픽 모드)가 설정된 동안에는 발동하지 않는다.
  var LONG_PRESS_MS = 600;
  var LONG_PRESS_TOL_PX = 10;
  var longPressHandler = null; // ui.js 콜백(latlng) — 발동 시 호출
  var longPressState = null; // { startX, startY, latLng, timer }
  var suppressNextClick = false; // 롱프레스 발동 직후 곧이어 오는 click 이벤트 1회 무시

  function longPressPoint(domEvent) {
    var t = domEvent.touches && domEvent.touches[0] ? domEvent.touches[0] : domEvent;
    return { x: t.clientX, y: t.clientY };
  }

  function onLongPressMove(e) {
    if (!longPressState) return;
    var p = longPressPoint(e);
    var d = Math.hypot(p.x - longPressState.startX, p.y - longPressState.startY);
    if (d > LONG_PRESS_TOL_PX) cancelLongPress();
  }

  function cancelLongPress() {
    if (!longPressState) return;
    clearTimeout(longPressState.timer);
    document.removeEventListener('mousemove', onLongPressMove);
    document.removeEventListener('touchmove', onLongPressMove);
    document.removeEventListener('mouseup', cancelLongPress);
    document.removeEventListener('touchend', cancelLongPress);
    document.removeEventListener('touchcancel', cancelLongPress);
    longPressState = null;
  }

  function startLongPress(e) {
    cancelLongPress();
    if (!longPressHandler || mapClickHandler) return; // 기존 지도탭 픽 모드 중에는 발동하지 않음
    if (!e.domEvent || !e.latLng) return;
    var p = longPressPoint(e.domEvent);
    var latLng = { lat: e.latLng.lat(), lng: e.latLng.lng() };
    longPressState = {
      startX: p.x,
      startY: p.y,
      timer: setTimeout(function () {
        longPressState = null;
        document.removeEventListener('mousemove', onLongPressMove);
        document.removeEventListener('touchmove', onLongPressMove);
        document.removeEventListener('mouseup', cancelLongPress);
        document.removeEventListener('touchend', cancelLongPress);
        document.removeEventListener('touchcancel', cancelLongPress);
        suppressNextClick = true;
        longPressHandler(latLng);
      }, LONG_PRESS_MS)
    };
    document.addEventListener('mousemove', onLongPressMove, { passive: true });
    document.addEventListener('touchmove', onLongPressMove, { passive: true });
    document.addEventListener('mouseup', cancelLongPress, { passive: true });
    document.addEventListener('touchend', cancelLongPress, { passive: true });
    document.addEventListener('touchcancel', cancelLongPress, { passive: true });
  }

  function setLongPressHandler(fn) { longPressHandler = fn; }

  // ── 경로 작성 중 출발지/도착지 지점 마커 (경유지 노란색과 구분되는 전용 색) ──
  // 이미 등록된 착륙장/WP 위에 지정된 경우에도 같은 좌표에 겹쳐 그려 "선택됨" 표시 역할을 한다
  var depMarker = null;
  var arrMarker = null;

  function endpointIcon(role) {
    var color = role === 'dep' ? '#00cc66' : '#E8001C';
    var label = role === 'dep' ? 'S' : 'E';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30">' +
      '<circle cx="15" cy="15" r="13" fill="' + color + '" stroke="#ffffff" stroke-width="2.5"/>' +
      '<text x="15" y="20" font-size="14" font-weight="900" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif">' + label + '</text>' +
      '</svg>';
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(30, 30),
      anchor: new google.maps.Point(15, 15)
    };
  }

  // draggable(옵션)이면 드래그 종료 시 onDragEnd({lat,lng})를 호출 — 편집모드에서 좌표 조정용
  function setDepMarker(point, draggable, onDragEnd) {
    clearDepMarker();
    if (!point) return;
    depMarker = new google.maps.Marker({
      position: { lat: point.lat, lng: point.lng },
      map: map,
      icon: endpointIcon('dep'),
      draggable: !!draggable,
      title: '출발지: ' + (point.name || ''),
      zIndex: 22
    });
    if (draggable && onDragEnd) {
      depMarker.addListener('dragend', function (e) { onDragEnd({ lat: e.latLng.lat(), lng: e.latLng.lng() }); });
    }
  }
  function clearDepMarker() { if (depMarker) { depMarker.setMap(null); depMarker = null; } }

  function setArrMarker(point, draggable, onDragEnd) {
    clearArrMarker();
    if (!point) return;
    arrMarker = new google.maps.Marker({
      position: { lat: point.lat, lng: point.lng },
      map: map,
      icon: endpointIcon('arr'),
      draggable: !!draggable,
      title: '도착지: ' + (point.name || ''),
      zIndex: 22
    });
    if (draggable && onDragEnd) {
      arrMarker.addListener('dragend', function (e) { onDragEnd({ lat: e.latLng.lat(), lng: e.latLng.lng() }); });
    }
  }
  function clearArrMarker() { if (arrMarker) { arrMarker.setMap(null); arrMarker = null; } }

  // ── 편집모드: 구간(점-점 사이) 중앙의 "+" 아이콘 — 탭하면 그 구간에 경유점을 삽입 ──
  var midMarkers = [];
  var midClickHandler = null; // ui.js 콜백(segIndex) — segIndex번째 구간(점[segIndex]~점[segIndex+1]) 클릭 시 호출

  function plusIcon() {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">' +
      '<circle cx="16" cy="16" r="11" fill="#ffffff" fill-opacity="0.95" stroke="#FF6B00" stroke-width="2.5"/>' +
      '<path d="M16 9 V23 M9 16 H23" stroke="#FF6B00" stroke-width="3" stroke-linecap="round"/>' +
      '</svg>';
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(32, 32), // 모바일 최소 터치영역(32x32) 확보
      anchor: new google.maps.Point(16, 16)
    };
  }

  function setMidpointCallback(fn) { midClickHandler = fn; }

  function clearMidpointMarkers() {
    midMarkers.forEach(function (m) { m.setMap(null); });
    midMarkers = [];
  }

  // points: 순서대로 배열된 전체 지점 [dep, ...via, arr] — 각 구간 중점에 + 아이콘을 그린다
  function setMidpointMarkers(points) {
    clearMidpointMarkers();
    if (!points || points.length < 2) return;
    for (var i = 0; i < points.length - 1; i++) {
      var midLat = (points[i].lat + points[i + 1].lat) / 2;
      var midLng = (points[i].lng + points[i + 1].lng) / 2;
      (function (segIndex) {
        var mk = new google.maps.Marker({
          position: { lat: midLat, lng: midLng },
          map: map,
          icon: plusIcon(),
          zIndex: 18
        });
        mk.addListener('click', function () {
          if (midClickHandler) midClickHandler(segIndex);
        });
        midMarkers.push(mk);
      })(i);
    }
  }

  function loadGoogleMaps(apiKey) {
    return new Promise(function (resolve, reject) {
      if (global.google && global.google.maps) { resolve(); return; }
      global.__onGoogleMapsLoaded = function () { resolve(); };
      var s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey) +
        '&libraries=places,geometry&callback=__onGoogleMapsLoaded&language=ko';
      s.async = true;
      s.onerror = function () { reject(new Error('Google Maps 스크립트 로드에 실패했습니다.')); };
      document.head.appendChild(s);
    });
  }

  // navmap_data.json의 layerStyles(shape/color)를 그대로 반영하는 범용 마커 아이콘 생성기
  function circleIcon(color, size) {
    size = size || 16;
    var c = size / 2, r = c - 1.5;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '">' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + color + '" stroke="#ffffff" stroke-width="1.5"/></svg>';
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(size, size),
      anchor: new google.maps.Point(c, c)
    };
  }

  // 구역(CTRZ/관제권/금지위험제한공역) 렌더링 — Point는 마커, 그 외는 좌표 폐합 여부(Calc.isClosedRing)로
  // Polygon/Polyline을 선택한다(geomType 문자열은 원본 KMZ 표기라 실제 폐합 여부와 어긋나는 경우가 있어 신뢰하지 않음).
  // 항목마다 zoneId를 심어두고(Point는 pointId도 함께) 클릭 시 zoneClickHandler(item, type)를 호출한다.
  function setZoneClickListener(obj, item, type) {
    obj.set('zoneId', item.id);
    obj.addListener('click', function () {
      if (zoneClickHandler) zoneClickHandler(item, type);
    });
  }

  function renderZones() {
    var layers = Data.getLayerState();
    ZONE_TYPES.forEach(function (type) {
      clearMarkerGroup(type);
      Data.DB[type].forEach(function (item) {
        var color = Data.zoneColorOf(type, item);
        var visible = layers[type];
        var obj;
        if (item.geomType === 'Point') {
          obj = new google.maps.Marker({
            position: { lat: item.lat, lng: item.lng },
            map: visible ? map : null,
            icon: circleIcon(color, 12),
            title: item.name,
            zIndex: 2
          });
          obj.set('pointId', item.id); // 착륙장류와 동일한 setMarkerDraggable() 재사용을 위해
        } else if (Calc.isClosedRing(item.coords)) {
          obj = new google.maps.Polygon({
            paths: item.coords,
            strokeColor: color, strokeWeight: 2, strokeOpacity: 0.9,
            fillColor: color, fillOpacity: 0.12,
            map: visible ? map : null,
            zIndex: 2
          });
        } else {
          obj = new google.maps.Polyline({
            path: item.coords,
            strokeColor: color, strokeWeight: 2, strokeOpacity: 0.85,
            map: visible ? map : null,
            zIndex: 2
          });
        }
        setZoneClickListener(obj, item, type);
        markers[type].push(obj);
      });
    });
  }

  // 구역(선/면) 편집 모드 on/off — google.maps.Polygon/Polyline의 내장 editable 핸들(점 드래그,
  // 변 중간점 드래그로 삽입, Alt+클릭/우클릭으로 삭제) + draggable(구역 안쪽을 잡고 전체 이동)을 함께 켠다.
  // 둘 다 같은 MVCArray path를 갱신하므로 getZonePath()의 getPath() 로직을 그대로 재사용할 수 있다.
  function findZoneObj(type, id) {
    return (markers[type] || []).find(function (m) { return m.get('zoneId') === id; });
  }
  function setZoneEditable(type, id, editable) {
    var obj = findZoneObj(type, id);
    if (!obj || !obj.setEditable) return;
    obj.setEditable(editable);
    if (obj.setDraggable) obj.setDraggable(editable);
  }
  // 편집 중인 Polygon/Polyline의 현재 좌표를 읽어온다(점 추가/삭제로 개수가 달라져도 그대로 반영)
  function getZonePath(type, id) {
    var obj = findZoneObj(type, id);
    if (!obj || !obj.getPath) return null;
    return obj.getPath().getArray().map(function (ll) { return { lat: ll.lat(), lng: ll.lng() }; });
  }
  // 색상 선택 즉시 미리보기 — Marker(Point)는 아이콘을 다시 그리고, Polygon/Polyline은 옵션만 갱신
  function setZoneColor(type, id, color) {
    var obj = findZoneObj(type, id);
    if (!obj) return;
    if (obj.setIcon) obj.setIcon(circleIcon(color, 12));
    else obj.setOptions({ strokeColor: color, fillColor: color });
  }
  function setZoneClickHandler(fn) { zoneClickHandler = fn; }
  function clearZoneClickHandler() { zoneClickHandler = null; }

  // 중심좌표+반경(NM)을 google.maps.geometry로 다각형 좌표(닫힌 링)로 변환 — 기존 ctrz base
  // 데이터(73점)와 동일한 점 개수로 이산화하고, 첫 점을 그대로 복제해 끝점에 붙여 정확히 폐합한다.
  function circlePolygonCoords(center, radiusNm, numPoints) {
    numPoints = numPoints || 72;
    var radiusM = radiusNm * 1852;
    var centerLatLng = new google.maps.LatLng(center.lat, center.lng);
    var pts = [];
    for (var i = 0; i < numPoints; i++) {
      var heading = (360 / numPoints) * i;
      var p = google.maps.geometry.spherical.computeOffset(centerLatLng, radiusM, heading);
      pts.push({ lat: p.lat(), lng: p.lng() });
    }
    pts.push({ lat: pts[0].lat, lng: pts[0].lng });
    return pts;
  }

  function searchMarkerIcon() {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26">' +
      '<circle cx="13" cy="13" r="10" fill="#a855f7" stroke="#ffffff" stroke-width="2.5"/>' +
      '<circle cx="13" cy="13" r="3.5" fill="#ffffff"/></svg>';
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(26, 26),
      anchor: new google.maps.Point(13, 13)
    };
  }

  // Google Places 텍스트 검색 — 결과를 { name, address, lat, lng } 배열로 변환
  function searchPlaces(query) {
    return new Promise(function (resolve, reject) {
      if (!google.maps.places) { reject(new Error('Places 라이브러리가 로드되지 않았습니다')); return; }
      var svc = new google.maps.places.PlacesService(map);
      svc.textSearch({ query: query, region: 'kr' }, function (results, status) {
        if (status === google.maps.places.PlacesServiceStatus.OK) {
          resolve((results || []).map(function (r) {
            return {
              name: r.name,
              address: r.formatted_address || '',
              lat: r.geometry.location.lat(),
              lng: r.geometry.location.lng()
            };
          }));
        } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          resolve([]);
        } else {
          reject(new Error(status));
        }
      });
    });
  }

  function showSearchMarker(lat, lng, title) {
    clearSearchMarker();
    searchMarker = new google.maps.Marker({
      position: { lat: lat, lng: lng },
      map: map,
      icon: searchMarkerIcon(),
      title: title,
      zIndex: 25
    });
  }

  function clearSearchMarker() {
    if (searchMarker) { searchMarker.setMap(null); searchMarker = null; }
  }

  function viaIcon(num) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26">' +
      '<circle cx="13" cy="13" r="11" fill="#FFD700" stroke="#7a5c00" stroke-width="2"/>' +
      '<text x="13" y="18" font-size="13" font-weight="900" text-anchor="middle" fill="#3a2a00" font-family="Arial,sans-serif">' + num + '</text>' +
      '</svg>';
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(26, 26),
      anchor: new google.maps.Point(13, 13)
    };
  }

  // 라벨은 행정구역명(시/도/시군구/동)만 남기고 나머지(POI, 도로명, 대중교통 등)는 숨긴다
  var MAP_STYLES = [
    { elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative', elementType: 'labels', stylers: [{ visibility: 'on' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] }
  ];

  function initMap(container) {
    map = new google.maps.Map(container, {
      center: { lat: 36.6, lng: 127.9 },
      zoom: 7,
      mapTypeId: 'hybrid',
      disableDefaultUI: true,
      zoomControl: false,
      gestureHandling: 'greedy',
      clickableIcons: false,
      styles: MAP_STYLES
    });
    map.addListener('click', function (e) {
      if (suppressNextClick) { suppressNextClick = false; return; }
      if (mapClickHandler) mapClickHandler({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    });
    map.addListener('mousedown', startLongPress);
    map.addListener('dragstart', cancelLongPress); // 팬(스크롤) 제스처가 인식되면 즉시 취소
    map.addListener('mousemove', function (e) {
      if (mouseMoveHandler && e.latLng) mouseMoveHandler({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    });

    return map;
  }

  function clearMarkerGroup(kind) {
    markers[kind].forEach(function (m) { m.setMap(null); });
    markers[kind] = [];
  }

  function renderMarkers(onMarkerClick) {
    var layers = Data.getLayerState();
    var styles = Data.LAYER_STYLES || {};

    // 사용자 추가/편집 가능한 "장소" 레이어 — 클릭 시 marker-sheet(또는 경로작성 중이면 routePointClickHandler)
    // 아이콘/색상은 항목별 icon/color 필드(없으면 타입별 기본값)를 그대로 사용한다
    POINT_LAYER_TYPES.forEach(function (type) {
      clearMarkerGroup(type);
      var size = POINT_MARKER_SIZE[type] || 30;
      Data.DB[type].forEach(function (p) {
        var mk = new google.maps.Marker({
          position: { lat: p.lat, lng: p.lng },
          map: layers[type] ? map : null,
          icon: Icons.markerIcon(Icons.iconOf(type, p), Icons.colorOf(type, p), size),
          title: p.name,
          zIndex: type === 'waypoints' ? 1 : (type === 'reportPoints' ? 2 : undefined)
        });
        mk.set('pointId', p.id);
        mk.addListener('click', function () {
          if (routePointClickHandler) routePointClickHandler(p, type); else onMarkerClick(p, type);
        });
        markers[type].push(mk);
      });
    });

    // CP — WayPoint와 동일하게 클릭 시 정보시트 표시
    clearMarkerGroup('cp');
    var cpIcon = circleIcon((styles.cp && styles.cp.color) || '#ffffff', 14);
    markers.cp = Data.DB.cp.map(function (p) {
      var mk = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: layers.cp ? map : null,
        icon: cpIcon,
        title: p.name,
        zIndex: 2
      });
      mk.addListener('click', function () {
        if (routePointClickHandler) routePointClickHandler(p, 'cp'); else onMarkerClick(p, 'cp');
      });
      return mk;
    });

    // 구역 레이어 (CTRZ/관제권/금지·위험·제한공역) — 클릭 시 zoneClickHandler(구역 정보시트)
    renderZones();

    renderAllRouteLines(layers.routesAll);
  }

  function renderAllRouteLines(visible) {
    allRouteLines.forEach(function (line) { line.setMap(null); });
    allRouteLines = [];
    if (!visible) return;
    Data.ROUTES.forEach(function (r) {
      if (!r.coords || r.coords.length < 2) return;
      var line = new google.maps.Polyline({
        path: r.coords,
        strokeColor: '#00cc66',
        strokeWeight: 1.5,
        strokeOpacity: 0.6,
        map: map,
        zIndex: 1,
        clickable: false // 비인터랙티브 참고 표시용 — 지도탭 인터랙션(경로작성/구역그리기/거리측정)을 가로채지 않도록
      });
      allRouteLines.push(line);
    });
  }

  function setLayerVisible(kind, visible) {
    var layers = Data.getLayerState();
    layers[kind] = visible;
    Data.saveLayerState(layers);
    if (kind === 'routesAll') {
      renderAllRouteLines(visible);
      return;
    }
    markers[kind].forEach(function (m) { m.setMap(visible ? map : null); });
  }

  function clearSelectedRoute() {
    if (selectedPolyline) { selectedPolyline.setMap(null); selectedPolyline = null; }
  }

  function selectRoute(route) {
    clearSelectedRoute();
    if (!route.coords || route.coords.length < 2) return;
    selectedPolyline = new google.maps.Polyline({
      path: route.coords,
      strokeColor: '#FF6B00',
      strokeWeight: 5,
      strokeOpacity: 0.95,
      map: map,
      zIndex: 10,
      clickable: false // 비인터랙티브 표시용 — 지도탭 인터랙션을 가로채지 않도록
    });
    var bounds = new google.maps.LatLngBounds();
    route.coords.forEach(function (c) { bounds.extend(c); });
    map.fitBounds(bounds, 60);
  }

  // ── 경로 작성 중 경유점 마커 (드래그로 이동, 탭하면 삭제 콜백) ──
  function setViaPointCallbacks(onDrag, onClick) {
    viaDragHandler = onDrag;
    viaClickHandler = onClick;
  }

  function clearViaMarkers() {
    viaMarkers.forEach(function (m) { m.setMap(null); });
    viaMarkers = [];
  }

  function setViaPoints(points) {
    clearViaMarkers();
    points.forEach(function (p, i) {
      var mk = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: map,
        icon: viaIcon(i + 1),
        draggable: true,
        zIndex: 20
      });
      mk.addListener('dragend', function (e) {
        if (viaDragHandler) viaDragHandler(i, { lat: e.latLng.lat(), lng: e.latLng.lng() });
      });
      mk.addListener('click', function () {
        if (viaClickHandler) viaClickHandler(i);
      });
      viaMarkers.push(mk);
    });
  }

  // ── 작성 중(미저장) 경로 미리보기 — 노란색, 레이어 설정과 무관하게 항상 표시 ──
  function previewDraftRoute(coords) {
    clearDraftRoute();
    if (!coords || coords.length < 2) return;
    draftPolyline = new google.maps.Polyline({
      path: coords,
      strokeColor: '#FFD700',
      strokeWeight: 4,
      strokeOpacity: 0.9,
      icons: [{
        icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
        offset: '0',
        repeat: '14px'
      }],
      map: map,
      zIndex: 15,
      clickable: false // 기본값(true)이면 선의 클릭 판정 영역이 지도 click 이벤트를 가로채
                        // 다음 점 탭이 씹히므로(경로작성/구역그리기/거리측정 공통 버그) 항상 뚫어준다
    });
  }

  function clearDraftRoute() {
    if (draftPolyline) { draftPolyline.setMap(null); draftPolyline = null; }
  }

  // ── 거리측정 도구 — 확정된 점마다 노란 점 마커, 마지막 점→커서까지 고무줄(rubber-band) 임시선 ──
  function setMeasurePoints(points) {
    clearMeasurePoints();
    var icon = circleIcon('#FFD700', 14);
    measurePointMarkers = points.map(function (p) {
      // clickable:false — 클릭 리스너가 없는 순수 표시용 마커라, 기본값(true)이면 근처 탭이
      // 마커에 가로채여 다음 점 확정이 씹힐 수 있으므로 지도로 항상 뚫어준다
      return new google.maps.Marker({ position: { lat: p.lat, lng: p.lng }, map: map, icon: icon, zIndex: 16, clickable: false });
    });
  }
  function clearMeasurePoints() {
    measurePointMarkers.forEach(function (m) { m.setMap(null); });
    measurePointMarkers = [];
  }

  // mousemove마다 호출되므로 매번 새로 만들지 않고 기존 폴리라인의 path만 갱신한다(터치 기기는
  // mousemove가 안 와서 이 함수 자체가 호출되지 않으므로 자연히 고무줄 없이 탭-찍기만 동작)
  function previewRubberBand(from, to) {
    if (rubberBandLine) {
      rubberBandLine.setPath([from, to]);
    } else {
      rubberBandLine = new google.maps.Polyline({
        path: [from, to],
        strokeColor: '#FFD700',
        strokeWeight: 3,
        strokeOpacity: 0.8,
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
          offset: '0',
          repeat: '10px'
        }],
        map: map,
        zIndex: 16,
        clickable: false // 커서를 따라다니는 선이라 다음 클릭이 이 선 위에서 나기 쉬움 — 반드시 뚫어줘야 함
      });
    }
  }
  function clearRubberBand() {
    if (rubberBandLine) { rubberBandLine.setMap(null); rubberBandLine = null; }
  }
  function setMouseMoveHandler(fn) { mouseMoveHandler = fn; }
  function clearMouseMoveHandler() { mouseMoveHandler = null; }

  function panToPoint(lat, lng, zoom) {
    map.panTo({ lat: lat, lng: lng });
    if (zoom) map.setZoom(zoom);
  }

  function setMapClickHandler(fn) { mapClickHandler = fn; }
  function clearMapClickHandler() { mapClickHandler = null; }
  function setRoutePointClickHandler(fn) { routePointClickHandler = fn; }
  function clearRoutePointClickHandler() { routePointClickHandler = null; }

  // 저장된 착륙장/WP 마커를 id로 찾아 드래그 가능 여부를 토글 (수정 중 지도에서 좌표 조정용)
  function setMarkerDraggable(kind, id, draggable, onDragEnd) {
    var mk = (markers[kind] || []).find(function (m) { return m.get('pointId') === id; });
    if (!mk) return;
    google.maps.event.clearListeners(mk, 'dragend');
    mk.setDraggable(draggable);
    if (draggable && onDragEnd) {
      mk.addListener('dragend', function (e) {
        onDragEnd({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      });
    }
  }

  function setMapType(typeId) {
    if (map) map.setMapTypeId(typeId);
  }

  global.MapView = {
    loadGoogleMaps: loadGoogleMaps,
    initMap: initMap,
    renderMarkers: renderMarkers,
    setLayerVisible: setLayerVisible,
    selectRoute: selectRoute,
    clearSelectedRoute: clearSelectedRoute,
    panToPoint: panToPoint,
    setMapClickHandler: setMapClickHandler,
    clearMapClickHandler: clearMapClickHandler,
    setLongPressHandler: setLongPressHandler,
    setDepMarker: setDepMarker,
    clearDepMarker: clearDepMarker,
    setArrMarker: setArrMarker,
    clearArrMarker: clearArrMarker,
    setMidpointCallback: setMidpointCallback,
    setMidpointMarkers: setMidpointMarkers,
    clearMidpointMarkers: clearMidpointMarkers,
    setRoutePointClickHandler: setRoutePointClickHandler,
    clearRoutePointClickHandler: clearRoutePointClickHandler,
    setMarkerDraggable: setMarkerDraggable,
    setMapType: setMapType,
    setViaPointCallbacks: setViaPointCallbacks,
    setViaPoints: setViaPoints,
    clearViaMarkers: clearViaMarkers,
    previewDraftRoute: previewDraftRoute,
    clearDraftRoute: clearDraftRoute,
    searchPlaces: searchPlaces,
    showSearchMarker: showSearchMarker,
    clearSearchMarker: clearSearchMarker,
    setZoneClickHandler: setZoneClickHandler,
    clearZoneClickHandler: clearZoneClickHandler,
    setZoneEditable: setZoneEditable,
    getZonePath: getZonePath,
    setZoneColor: setZoneColor,
    circlePolygonCoords: circlePolygonCoords,
    setMeasurePoints: setMeasurePoints,
    clearMeasurePoints: clearMeasurePoints,
    previewRubberBand: previewRubberBand,
    clearRubberBand: clearRubberBand,
    setMouseMoveHandler: setMouseMoveHandler,
    clearMouseMoveHandler: clearMouseMoveHandler
  };
})(window);
