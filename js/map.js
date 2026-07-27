/* SK 항법지도 2.0 — 구글 위성지도 렌더링 */
(function (global) {
  'use strict';

  var map = null;
  var markers = { sk: [], land: [], wp: [], cp: [], ctrz: [], airspace_notice: [], notam: [] };
  var AIRSPACE_KINDS = ['cp', 'ctrz', 'airspace_notice', 'notam'];
  var AIRSPACE_STYLE = {
    cp: '#00c8ff',
    ctrz: '#3366FF',
    airspace_notice: '#00CC66',
    notam: '#FF0000'
  };
  var allRouteLines = []; // 전체 경로(초록, 얇음) — 레이어 ON시만 지도에 부착
  var selectedPolyline = null; // 저장된 경로 선택 시(오렌지) — 레이어 설정과 무관하게 항상 표시
  var draftPolyline = null; // 작성 중인(미저장) 경로 미리보기(노랑) — 레이어 설정과 무관하게 항상 표시
  var viaMarkers = []; // 경로 작성 중 경유점 마커(드래그 가능)
  var viaDragHandler = null;
  var viaClickHandler = null;
  var mapClickHandler = null; // ui.js가 지도탭으로 좌표를 받을 때 설정
  var searchMarker = null; // 장소 검색 결과 임시 마커(보라)
  var routePointClickHandler = null; // 설정되어 있으면 sk/land/wp 마커 탭 시 정보시트 대신 이 콜백(point, kind)으로 전달

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
        '&libraries=places&callback=__onGoogleMapsLoaded&language=ko';
      s.async = true;
      s.onerror = function () { reject(new Error('Google Maps 스크립트 로드에 실패했습니다.')); };
      document.head.appendChild(s);
    });
  }

  function markerIconUrl(kind) {
    if (kind === 'wp') {
      var svgWp = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">' +
        '<circle cx="8" cy="8" r="6" fill="#00c8ff" stroke="#ffffff" stroke-width="2"/></svg>';
      return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgWp);
    }
    var color = kind === 'sk' ? '#E8001C' : '#00aa55';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30">' +
      '<rect x="2" y="2" width="26" height="26" rx="6" fill="' + color + '" stroke="#ffffff" stroke-width="2.5"/>' +
      '<text x="15" y="21" font-size="15" font-weight="900" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif">H</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  }

  function iconFor(kind) {
    if (kind === 'wp') {
      return { url: markerIconUrl('wp'), scaledSize: new google.maps.Size(16, 16), anchor: new google.maps.Point(8, 8) };
    }
    return { url: markerIconUrl(kind), scaledSize: new google.maps.Size(30, 30), anchor: new google.maps.Point(15, 15) };
  }

  function airspaceIcon(kind) {
    var color = AIRSPACE_STYLE[kind] || '#ffffff';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14">' +
      '<circle cx="7" cy="7" r="5" fill="' + color + '" stroke="#ffffff" stroke-width="1.5"/></svg>';
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(14, 14),
      anchor: new google.maps.Point(7, 7)
    };
  }

  // geomType(Point/LineString/Polygon)에 따라 마커/폴리라인/폴리곤으로 렌더링 (공역 레이어 공용)
  // 항목별 원본 color는 무시하고 카테고리 고정색(AIRSPACE_STYLE)을 적용
  function renderGeomItems(items, kind, visible) {
    var color = AIRSPACE_STYLE[kind] || '#ffffff';
    return (items || []).map(function (item) {
      if (item.geomType === 'Point') {
        return new google.maps.Marker({
          position: { lat: item.lat, lng: item.lng },
          map: visible ? map : null,
          icon: airspaceIcon(kind),
          title: item.name,
          zIndex: 2
        });
      }
      if (item.geomType === 'Polygon') {
        return new google.maps.Polygon({
          paths: item.coords,
          strokeColor: color, strokeWeight: 2, strokeOpacity: 0.9,
          fillColor: color, fillOpacity: 0.12,
          map: visible ? map : null,
          zIndex: 2
        });
      }
      return new google.maps.Polyline({
        path: item.coords,
        strokeColor: color, strokeWeight: 2, strokeOpacity: 0.85,
        map: visible ? map : null,
        zIndex: 2
      });
    });
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

    return map;
  }

  function clearMarkerGroup(kind) {
    markers[kind].forEach(function (m) { m.setMap(null); });
    markers[kind] = [];
  }

  function renderMarkers(onMarkerClick) {
    var layers = Data.getLayerState();
    clearMarkerGroup('sk');
    clearMarkerGroup('land');
    clearMarkerGroup('wp');

    Data.DB.sk_landings.forEach(function (p) {
      var mk = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: layers.sk ? map : null,
        icon: iconFor('sk'),
        title: p.name
      });
      mk.set('pointId', p.id);
      mk.addListener('click', function () {
        if (routePointClickHandler) routePointClickHandler(p, 'sk'); else onMarkerClick(p, 'sk');
      });
      markers.sk.push(mk);
    });

    Data.DB.landings.forEach(function (p) {
      var mk = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: layers.land ? map : null,
        icon: iconFor('land'),
        title: p.name
      });
      mk.set('pointId', p.id);
      mk.addListener('click', function () {
        if (routePointClickHandler) routePointClickHandler(p, 'land'); else onMarkerClick(p, 'land');
      });
      markers.land.push(mk);
    });

    Data.DB.waypoints.forEach(function (p) {
      var mk = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: layers.wp ? map : null,
        icon: iconFor('wp'),
        title: p.name,
        zIndex: 1
      });
      mk.set('pointId', p.id);
      mk.addListener('click', function () {
        if (routePointClickHandler) routePointClickHandler(p, 'wp'); else onMarkerClick(p, 'wp');
      });
      markers.wp.push(mk);
    });

    AIRSPACE_KINDS.forEach(function (kind) {
      clearMarkerGroup(kind);
      markers[kind] = renderGeomItems(Data.DB[kind], kind, layers[kind]);
    });

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
        zIndex: 1
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
      zIndex: 10
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
      zIndex: 15
    });
  }

  function clearDraftRoute() {
    if (draftPolyline) { draftPolyline.setMap(null); draftPolyline = null; }
  }

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
    clearSearchMarker: clearSearchMarker
  };
})(window);
