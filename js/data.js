/* SK 항법지도 2.0 — 데이터 로드/병합/저장 */
(function (global) {
  'use strict';

  var DATA_URL = './navmap_data.json';
  var LS_USER = 'skn_user_data';
  var LS_FAVS = 'skn_favorites';
  var LS_LAYERS = 'skn_layers';

  // 사용자가 추가/수정/삭제할 수 있는 타입(오버레이 대상) — 착륙장 4종 + WayPoint + 경로
  var TYPES = ['sk_landings', 'offsite_landings', 'hospital_landings', 'ultralight_landings', 'waypoints', 'routes'];
  // 참고용(읽기전용) 레이어 — base 데이터 그대로 표시, 사용자 추가/수정 없음
  var REFERENCE_TYPES = ['cp', 'ctrz', 'gwanjegwon', 'restricted', 'reportPoints'];
  // 경로 작성 시 드롭다운 대상이 되는 "장소"(사용자 추가/편집 가능) 타입
  var POINT_TYPES = ['sk_landings', 'offsite_landings', 'hospital_landings', 'ultralight_landings', 'waypoints'];
  // 이름 매칭/스냅(근처지점 자동 스냅, depName·arrName 산출)의 대상 — CP/ReportPoint도 마커클릭으로 경로에 쓰일 수 있으므로 포함
  var NAME_MATCH_TYPES = POINT_TYPES.concat(['cp', 'reportPoints']);

  var EMPTY_USER = function () {
    var o = {};
    TYPES.forEach(function (t) { o[t] = []; });
    return o;
  };
  var emptyEdits = function () {
    var o = {};
    TYPES.forEach(function (t) { o[t] = {}; });
    return o;
  };
  var emptyDeletes = function () {
    var o = {};
    TYPES.forEach(function (t) { o[t] = []; });
    return o;
  };

  // 병합된 현재 데이터 (base + 사용자 추가/수정/삭제 오버레이 적용)
  var DB = {};
  TYPES.concat(REFERENCE_TYPES).forEach(function (t) { DB[t] = []; });
  // navmap_data.json의 layerStyles(레이어별 라벨/색상/모양) — 레이어시트/마커 렌더링이 그대로 참조
  var LAYER_STYLES = {};
  // 검색/표시용으로 가공된 경로 목록 (거리/시간/연료/dep·arr 이름 포함)
  var ROUTES = [];
  // 모든 "장소" 지점(마커 매칭용): {name,lat,lng,kind}
  var ALL_POINTS = [];

  function makeId() {
    return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // navmap_data.json에 미리 심어둔 영구 id가 없는(마이그레이션 전) base 항목을 위한 대비책.
  // 이름+좌표 기반 해시라서 배열 순서가 바뀌어도, 다시 계산해도 항상 같은 값이 나온다.
  function hashStr(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
  }
  function contentId(type, item) {
    if (type === 'routes') {
      return 'r_' + hashStr(item.name + '|' + item.dep.lat + ',' + item.dep.lng + '|' + item.arr.lat + ',' + item.arr.lng);
    }
    return 'p_' + hashStr(item.name + '|' + item.lat + '|' + item.lng);
  }
  function idOf(type, item) {
    return item.id || contentId(type, item);
  }

  // 예전 버전(수정/삭제 기능 이전)에 저장된 사용자 항목은 id가 없으므로 최초 1회 부여한다.
  function migrateIds(d) {
    var changed = false;
    TYPES.forEach(function (type) {
      (d[type] || []).forEach(function (item) {
        if (!item.id) { item.id = makeId(); changed = true; }
      });
    });
    return changed;
  }

  function getUserData() {
    var d;
    try {
      var raw = localStorage.getItem(LS_USER);
      var parsed = raw ? JSON.parse(raw) : {};
      d = Object.assign(EMPTY_USER(), parsed);
      d.edits = Object.assign(emptyEdits(), parsed.edits);
      d.deletes = Object.assign(emptyDeletes(), parsed.deletes);
    } catch (e) {
      d = EMPTY_USER();
      d.edits = emptyEdits();
      d.deletes = emptyDeletes();
    }
    if (migrateIds(d)) saveUserData(d);
    return d;
  }

  function saveUserData(d) {
    localStorage.setItem(LS_USER, JSON.stringify(d));
  }

  function addUserPoint(type, item) {
    var d = getUserData();
    item = Object.assign({ id: makeId() }, item);
    d[type].push(item);
    saveUserData(d);
    return item;
  }

  function addUserRoute(route) {
    var d = getUserData();
    route = Object.assign({ id: makeId() }, route);
    d.routes.push(route);
    saveUserData(d);
    return route;
  }

  // 기존 항목(원본 base 데이터 포함) 수정: id 기준으로 오버레이 적용
  function updateItem(type, id, fields) {
    var d = getUserData();
    if (String(id).indexOf('u_') === 0) {
      var idx = d[type].findIndex(function (x) { return x.id === id; });
      if (idx >= 0) {
        d[type][idx] = Object.assign({}, d[type][idx], fields);
        saveUserData(d);
        return;
      }
    }
    d.edits[type][id] = Object.assign({}, d.edits[type][id], fields);
    saveUserData(d);
  }

  // 기존 항목(원본 base 데이터 포함) 삭제: id 기준
  function deleteItemById(type, id) {
    var d = getUserData();
    if (String(id).indexOf('u_') === 0) {
      d[type] = d[type].filter(function (x) { return x.id !== id; });
      delete d.edits[type][id];
    } else {
      if (d.deletes[type].indexOf(id) === -1) d.deletes[type].push(id);
      delete d.edits[type][id];
    }
    saveUserData(d);
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

  // 레이어 표시 상태 (10개 레이어 + 전체 항법경로)
  var DEFAULT_LAYERS = {
    sk_landings: true, offsite_landings: true, hospital_landings: false, ultralight_landings: false,
    cp: false, waypoints: false, ctrz: false, reportPoints: false, gwanjegwon: false, restricted: false,
    routesAll: false
  };
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

  // 경로명 "출발-도착(CODE)" → {dep,arr} 문자열 파싱. 이름에 "-" 구분이 없으면(자유 입력 이름)
  // dep/arr를 같은 문자열로 뭉뚱그리지 않도록 null을 반환해 좌표 기반 이름으로 대체하게 한다
  function parseRouteName(name) {
    var idx = name.indexOf('-');
    if (idx < 0) return { dep: null, arr: null };
    var dep = name.slice(0, idx).trim();
    var arr = name.slice(idx + 1).replace(/\([^)]*\)\s*$/, '').trim();
    return { dep: dep, arr: arr };
  }

  // 등록된 지점과도, 파싱된 이름과도 매칭되지 않을 때 최종 대체용 좌표 표기
  function coordLabel(lat, lng) {
    return '좌표 ' + lat.toFixed(5) + ', ' + lng.toFixed(5);
  }

  // 좌표에 가장 가까운 등록 지점(SK착륙장/장외이착륙장/병원착륙장/초경량비행장/WayPoint) 찾기 — { name, lat, lng, kind } 또는 없으면 null
  function nearestPoint(lat, lng, maxNm) {
    maxNm = maxNm || 1.0;
    var best = null, bestD = Infinity;
    for (var i = 0; i < ALL_POINTS.length; i++) {
      var p = ALL_POINTS[i];
      var d = Calc.haversineNM(lat, lng, p.lat, p.lng);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best && bestD <= maxNm) return best;
    return null;
  }

  // 좌표에 가장 가까운 등록 지점 이름 찾기 (1NM 이내)
  function nearestPointName(lat, lng, maxNm) {
    var p = nearestPoint(lat, lng, maxNm);
    return p ? p.name : null;
  }

  // base 배열 + 사용자 추가분에 수정/삭제 오버레이를 적용해 최종 배열을 만든다.
  // id는 navmap_data.json에 심어진 영구 id(또는 이름+좌표 해시)를 쓰므로,
  // base 배열의 순서가 바뀌거나 다른 항목이 추가/삭제되어도 오버레이가 엉뚱한 항목에 붙지 않는다.
  function applyOverlay(type, baseList, userList, edits, deletes) {
    var out = [];
    baseList.forEach(function (item) {
      var id = idOf(type, item);
      if (deletes[type].indexOf(id) !== -1) return;
      var merged = Object.assign({}, item, { id: id, _origin: 'base' });
      if (edits[type][id]) merged = Object.assign(merged, edits[type][id]);
      out.push(merged);
    });
    (userList || []).forEach(function (item) {
      var id = item.id || makeId();
      if (deletes[type].indexOf(id) !== -1) return;
      var merged = Object.assign({ _origin: 'user' }, item, { id: id });
      if (edits[type][id]) merged = Object.assign(merged, edits[type][id]);
      out.push(merged);
    });
    return out;
  }

  // 새 base.json을 받았을 때, 로컬 오버레이(edits/deletes)가 가리키는 id가
  // 더 이상 base/사용자 데이터 어디에도 없으면 "적용되지 않는 로컬 수정"이므로 모아서 알려준다.
  function findOrphanedOverlay(base, user) {
    var edits = user.edits, deletes = user.deletes;
    var details = [];
    TYPES.forEach(function (type) {
      var validIds = {};
      (base[type] || []).forEach(function (item) { validIds[idOf(type, item)] = true; });
      (user[type] || []).forEach(function (item) { if (item.id) validIds[item.id] = true; });

      Object.keys(edits[type]).forEach(function (id) {
        if (!validIds[id]) details.push({ type: type, id: id, kind: 'edit' });
      });
      deletes[type].forEach(function (id) {
        if (!validIds[id]) details.push({ type: type, id: id, kind: 'delete' });
      });
    });
    return details;
  }

  // depName/arrName 산출 시 "근처 등록지점"으로 간주할 반경 — 서로 다른 두 좌표가
  // 우연히 같은 지점 이름으로 뭉뚱그려지지 않도록 스냅 반경(약 80m)만큼만 타이트하게 유지
  var NAME_MATCH_RADIUS_NM = 80 / 1852;

  function buildIndices() {
    ALL_POINTS = [];
    NAME_MATCH_TYPES.forEach(function (type) {
      DB[type].forEach(function (p) { ALL_POINTS.push({ name: p.name, lat: p.lat, lng: p.lng, kind: type }); });
    });

    ROUTES = DB.routes.map(function (r) {
      var parsed = parseRouteName(r.name);
      var depName = nearestPointName(r.dep.lat, r.dep.lng, NAME_MATCH_RADIUS_NM) || parsed.dep || coordLabel(r.dep.lat, r.dep.lng);
      var arrName = nearestPointName(r.arr.lat, r.arr.lng, NAME_MATCH_RADIUS_NM) || parsed.arr || coordLabel(r.arr.lat, r.arr.lng);
      var distNm = Calc.routeDistanceNM(r.coords && r.coords.length >= 2 ? r.coords : [r.dep, r.arr]);
      var t130 = Calc.timeMin(distNm, 130);
      var t140 = Calc.timeMin(distNm, 140);
      var fuel = Calc.fuelLbs(t130);
      return {
        id: r.id,
        _origin: r._origin,
        name: r.name,
        dep: r.dep,
        arr: r.arr,
        depName: depName,
        arrName: arrName,
        depGroup: r.depGroup || null,
        coords: r.coords,
        memo: r.memo || '',
        distNm: distNm,
        t130: t130,
        t140: t140,
        fuel: fuel,
        isUser: r._origin === 'user'
      };
    });
  }

  function mergeBase(base, user) {
    var edits = user.edits || emptyEdits();
    var deletes = user.deletes || emptyDeletes();
    TYPES.forEach(function (type) {
      DB[type] = applyOverlay(type, base[type] || [], user[type], edits, deletes);
    });
    // 참고용(읽기전용) 레이어 — 사용자 추가/수정 없이 base 데이터 그대로 표시
    REFERENCE_TYPES.forEach(function (type) { DB[type] = base[type] || []; });
  }

  var baseCache = null;
  var orphanedOverlay = [];

  function loadDatabase() {
    return fetch(DATA_URL, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('navmap_data.json 로드 실패 (' + res.status + ')');
        return res.json();
      })
      .then(function (base) {
        baseCache = base;
        LAYER_STYLES = base.layerStyles || {};
        var user = getUserData();
        orphanedOverlay = findOrphanedOverlay(base, user);
        if (orphanedOverlay.length) {
          console.warn('[Data] 새 base 데이터에 없는 로컬 수정/삭제 항목 ' + orphanedOverlay.length + '건이 무시됩니다:', orphanedOverlay);
        }
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

  global.Data = {
    DB: DB,
    get ROUTES() { return ROUTES; },
    get ALL_POINTS() { return ALL_POINTS; },
    get LAYER_STYLES() { return LAYER_STYLES; },
    loadDatabase: loadDatabase,
    refreshFromLocal: refreshFromLocal,
    addUserPoint: addUserPoint,
    addUserRoute: addUserRoute,
    updateItem: updateItem,
    deleteItemById: deleteItemById,
    getFavorites: getFavorites,
    isFavorite: isFavorite,
    toggleFavorite: toggleFavorite,
    getLayerState: getLayerState,
    saveLayerState: saveLayerState,
    nearestPoint: nearestPoint,
    nearestPointName: nearestPointName,
    get orphanedOverlay() { return orphanedOverlay; }
  };
})(window);
