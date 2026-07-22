/* SK 항법지도 2.0 — 구글 위성지도 렌더링 */
(function (global) {
  'use strict';

  var map = null;
  var markers = { sk: [], land: [], wp: [] };
  var allRouteLines = []; // 전체 경로(초록, 얇음) — 레이어 ON시만 지도에 부착
  var selectedPolyline = null;
  var mapClickHandler = null; // ui.js가 지도탭으로 좌표를 받을 때 설정

  function loadGoogleMaps(apiKey) {
    return new Promise(function (resolve, reject) {
      if (global.google && global.google.maps) { resolve(); return; }
      global.__onGoogleMapsLoaded = function () { resolve(); };
      var s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey) +
        '&v=weekly&callback=__onGoogleMapsLoaded&language=ko&region=KR';
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

  function initMap(container) {
    map = new google.maps.Map(container, {
      center: { lat: 36.6, lng: 127.9 },
      zoom: 7,
      mapTypeId: 'hybrid',
      disableDefaultUI: true,
      zoomControl: false,
      gestureHandling: 'greedy',
      clickableIcons: false
    });
    map.addListener('click', function (e) {
      if (mapClickHandler) mapClickHandler({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    });
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
      mk.addListener('click', function () { onMarkerClick(p, 'sk'); });
      markers.sk.push(mk);
    });

    Data.DB.landings.forEach(function (p) {
      var mk = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: layers.land ? map : null,
        icon: iconFor('land'),
        title: p.name
      });
      mk.addListener('click', function () { onMarkerClick(p, 'land'); });
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
      mk.addListener('click', function () { onMarkerClick(p, 'wp'); });
      markers.wp.push(mk);
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

  function panToPoint(lat, lng, zoom) {
    map.panTo({ lat: lat, lng: lng });
    if (zoom) map.setZoom(zoom);
  }

  function setMapClickHandler(fn) { mapClickHandler = fn; }
  function clearMapClickHandler() { mapClickHandler = null; }

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
    setMapType: setMapType
  };
})(window);
