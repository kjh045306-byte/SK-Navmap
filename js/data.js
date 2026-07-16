/* SK 항법지도 2.0 — 데이터 로드/병합/저장 */
(function (global) {
  'use strict';

  var DATA_URL = './navmap_data.json';
  var LS_USER = 'skn_user_data';
  var LS_FAVS = 'skn_favorites';
  var LS_LAYERS = 'skn_layers';

  var EMPTY_USER = function () {
    return { sk_landings: [], landings: [], waypoints: [], routes: [] };
  };

  // 병합된 현재 데이터 (base + 사용자 추가분)
  var DB = { sk_landings: [], landings: [], waypoints: [], routes: [] };
  // 검색/표시용으로 가공된 경로 목록 (거리/시간/연료/dep·arr 이름 포함)
  var ROUTES = [];
  // 모든 지점(마커 매칭용): {name,lat,lng,kind}
  var ALL_POINTS = [];

  function getUserData() {
    try {
      var raw = localStorage.getItem(LS_USER);
      if (!raw) return EMPTY_USER();
      var parsed = JSON.parse(raw);
      return Object.assign(EMPTY_USER(), parsed);
    } catch (e) {
      return EMPTY_USER();
    }
  }

  function saveUserData(d) {
    localStorage.setItem(LS_USER, JSON.stringify(d));
  }

  function addUserPoint(type, item) {
    var d = getUserData();
    d[type].push(item);
    saveUserData(d);
  }

  function addUserRoute(route) {
    var d = getUserData();
    d.routes.push(route);
    saveUserData(d);
  }

  function deleteUserItem(type, name) {
    var d = getUserData();
    d[type] = d[type].filter(function (x) { return x.name !== name; });
    saveUserData(d);
  }

  function isUserItem(type, name) {
    return getUserData()[type].some(function (x) { return x.name === name; });
  }

  // 즐겨찾기
  function getFavorites() {
    try { return JSON.parse(localStorage.getItem(LS_FAVS) || '{}'); } catch (e) { return {}; }
  }
  function isFavorite(routeName) {
    return !!getFavorites()[routeName];
  }
  function toggleFavorite(routeName) {
    var f = getFavorites();
    if (f[routeName]) delete f[routeName]; else f[routeName] = true;
    localStorage.setItem(LS_FAVS, JSON.stringify(f));
    return !!f[routeName];
  }

  // 레이어 표시 상태
  var DEFAULT_LAYERS = { sk: true, land: true, wp: false, routesAll: false };
  function getLayerState() {
    try {
      var raw = localStorage.getItem(LS_LAYERS);
      if (!raw) return Object.assign({}, DEFAULT_LAYERS);
      return Object.assign({}, DEFAULT_LAYERS, JSON.parse(raw));
    } catch (e) { return Object.assign({}, DEFAULT_LAYERS); }
  }
  function saveLayerState(state) {
    localStorage.setItem(LS_LAYERS, JSON.stringify(state));
  }

  // 경로명 "출발-도착(CODE)" → {dep,arr} 문자열 파싱 (좌표 매칭 실패 시 대체용)
  function parseRouteName(name) {
    var idx = name.indexOf('-');
    if (idx < 0) return { dep: name, arr: name };
    var dep = name.slice(0, idx).trim();
    var arr = name.slice(idx + 1).replace(/\([^)]*\)\s*$/, '').trim();
    return { dep: dep, arr: arr };
  }

  // 좌표에 가장 가까운 등록 지점 이름 찾기 (1NM 이내)
  function nearestPointName(lat, lng, maxNm) {
    maxNm = maxNm || 1.0;
    var best = null, bestD = Infinity;
    for (var i = 0; i < ALL_POINTS.length; i++) {
      var p = ALL_POINTS[i];
      var d = Calc.haversineNM(lat, lng, p.lat, p.lng);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best && bestD <= maxNm) return best.name;
    return null;
  }

  function buildIndices() {
    ALL_POINTS = [];
    DB.sk_landings.forEach(function (p) { ALL_POINTS.push({ name: p.name, lat: p.lat, lng: p.lng, kind: 'sk' }); });
    DB.landings.forEach(function (p) { ALL_POINTS.push({ name: p.name, lat: p.lat, lng: p.lng, kind: 'land' }); });
    DB.waypoints.forEach(function (p) { ALL_POINTS.push({ name: p.name, lat: p.lat, lng: p.lng, kind: 'wp' }); });

    ROUTES = DB.routes.map(function (r) {
      var parsed = parseRouteName(r.name);
      var depName = nearestPointName(r.dep.lat, r.dep.lng) || parsed.dep;
      var arrName = nearestPointName(r.arr.lat, r.arr.lng) || parsed.arr;
      var distNm = Calc.routeDistanceNM(r.coords && r.coords.length >= 2 ? r.coords : [r.dep, r.arr]);
      var t130 = Calc.timeMin(distNm, 130);
      var t140 = Calc.timeMin(distNm, 140);
      var fuel = Calc.fuelLbs(t130);
      return {
        name: r.name,
        dep: r.dep,
        arr: r.arr,
        depName: depName,
        arrName: arrName,
        coords: r.coords,
        memo: r.memo || '',
        distNm: distNm,
        t130: t130,
        t140: t140,
        fuel: fuel,
        isUser: isUserItem('routes', r.name)
      };
    });
  }

  function mergeBase(base, user) {
    DB.sk_landings = base.sk_landings.concat(user.sk_landings);
    DB.landings = base.landings.concat(user.landings);
    DB.waypoints = base.waypoints.concat(user.waypoints);
    DB.routes = base.routes.concat(user.routes);
  }

  var baseCache = null;

  function loadDatabase() {
    return fetch(DATA_URL, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('navmap_data.json 로드 실패 (' + res.status + ')');
        return res.json();
      })
      .then(function (base) {
        baseCache = base;
        var user = getUserData();
        mergeBase(base, user);
        buildIndices();
        return DB;
      });
  }

  function refreshFromLocal() {
    if (!baseCache) return;
    var user = getUserData();
    mergeBase(baseCache, user);
    buildIndices();
  }

  // 관리자용: base + 사용자 추가분을 합친 전체 JSON 내보내기(다운로드)
  function exportMergedJson() {
    var merged = {
      version: (baseCache && baseCache.version) || new Date().toISOString().slice(0, 10),
      sk_landings: DB.sk_landings,
      landings: DB.landings,
      waypoints: DB.waypoints,
      routes: DB.routes.map(function (r) {
        return { name: r.name, dep: r.dep, arr: r.arr, coords: r.coords, memo: r.memo || '' };
      })
    };
    var blob = new Blob([JSON.stringify(merged, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'navmap_data.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  global.Data = {
    DB: DB,
    get ROUTES() { return ROUTES; },
    get ALL_POINTS() { return ALL_POINTS; },
    loadDatabase: loadDatabase,
    refreshFromLocal: refreshFromLocal,
    addUserPoint: addUserPoint,
    addUserRoute: addUserRoute,
    deleteUserItem: deleteUserItem,
    isUserItem: isUserItem,
    getFavorites: getFavorites,
    isFavorite: isFavorite,
    toggleFavorite: toggleFavorite,
    getLayerState: getLayerState,
    saveLayerState: saveLayerState,
    nearestPointName: nearestPointName,
    exportMergedJson: exportMergedJson
  };
})(window);
