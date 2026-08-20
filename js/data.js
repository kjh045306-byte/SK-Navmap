/* SK 항법지도 2.0 — 데이터 로드/병합/저장 */
(function (global) {
  'use strict';

  var DATA_URL = './navmap_data.json';
  var LS_USER = 'skn_user_data';
  var LS_FAVS = 'skn_favorites';
  var LS_LAYERS = 'skn_layers';
  var LS_CLOUD_SEEN = 'skn_cloud_seen'; // 직전 동기화 시점에 클라우드에 존재했던 사용자추가 항목 id 목록(타입별) — 다른 기기의 삭제를 구분하기 위한 용도
  var CLOUD_ROOT = 'userData'; // Firebase Realtime Database 경로 루트

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
    // 랜덤 부분을 8자리로 확보(36^8 ≈ 2.8조 조합)해 여러 기기에서 동시에 추가해도 충돌 가능성을 사실상 없앤다
    return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
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

  // ── Firebase Realtime Database 동기화 (write-through) ──
  function currentUserEmail() {
    return (window.firebaseAuth && window.firebaseAuth.currentUser && window.firebaseAuth.currentUser.email) || null;
  }
  function cloudReady() {
    return !!(window.firebaseDb && window.firebaseDbRef && window.firebaseDbUpdate && currentUserEmail());
  }
  function notifySyncFailure() {
    console.warn('[Sync] 클라우드 반영 실패, 로컬에만 저장됨');
    if (global.UI && global.UI.toast) global.UI.toast('동기화 실패, 로컬에만 저장됨');
  }
  // pathValues: { "userData/타입/id": 값(null이면 해당 경로 삭제), ... } — 여러 경로를 한 번에 원자적으로 반영
  function cloudWrite(pathValues) {
    if (!cloudReady()) { notifySyncFailure(); return; }
    window.firebaseDbUpdate(window.firebaseDbRef(window.firebaseDb), pathValues).catch(function (err) {
      console.warn('[Sync] 클라우드 쓰기 실패', err);
      notifySyncFailure();
    });
  }
  function getCloudSeen() {
    try { return JSON.parse(localStorage.getItem(LS_CLOUD_SEEN) || '{}'); } catch (e) { return {}; }
  }
  function saveCloudSeen(seen) {
    localStorage.setItem(LS_CLOUD_SEEN, JSON.stringify(seen));
  }

  function addUserPoint(type, item) {
    var d = getUserData();
    item = Object.assign({ id: makeId() }, item, { addedBy: currentUserEmail(), updatedAt: Date.now() });
    d[type].push(item);
    saveUserData(d);
    var pv = {};
    pv[CLOUD_ROOT + '/' + type + '/' + item.id] = item;
    cloudWrite(pv);
    return item;
  }

  function addUserRoute(route) {
    var d = getUserData();
    route = Object.assign({ id: makeId() }, route, { addedBy: currentUserEmail(), updatedAt: Date.now() });
    d.routes.push(route);
    saveUserData(d);
    var pv = {};
    pv[CLOUD_ROOT + '/routes/' + route.id] = route;
    cloudWrite(pv);
    return route;
  }

  // 기존 항목(원본 base 데이터 포함) 수정: id 기준으로 오버레이 적용
  function updateItem(type, id, fields) {
    var d = getUserData();
    var meta = { addedBy: currentUserEmail(), updatedAt: Date.now() };
    if (String(id).indexOf('u_') === 0) {
      var idx = d[type].findIndex(function (x) { return x.id === id; });
      if (idx >= 0) {
        d[type][idx] = Object.assign({}, d[type][idx], fields, meta);
        saveUserData(d);
        var pv = {};
        pv[CLOUD_ROOT + '/' + type + '/' + id] = d[type][idx];
        cloudWrite(pv);
        return;
      }
    }
    d.edits[type][id] = Object.assign({}, d.edits[type][id], fields, meta);
    saveUserData(d);
    var pv2 = {};
    pv2[CLOUD_ROOT + '/edits/' + type + '/' + id] = d.edits[type][id];
    cloudWrite(pv2);
  }

  // 기존 항목(원본 base 데이터 포함) 삭제: id 기준
  function deleteItemById(type, id) {
    var d = getUserData();
    var meta = { addedBy: currentUserEmail(), updatedAt: Date.now() };
    if (String(id).indexOf('u_') === 0) {
      d[type] = d[type].filter(function (x) { return x.id !== id; });
      delete d.edits[type][id];
      saveUserData(d);
      var pv = {};
      pv[CLOUD_ROOT + '/' + type + '/' + id] = null;
      pv[CLOUD_ROOT + '/edits/' + type + '/' + id] = null;
      cloudWrite(pv);
    } else {
      if (d.deletes[type].indexOf(id) === -1) d.deletes[type].push(id);
      delete d.edits[type][id];
      saveUserData(d);
      var pv2 = {};
      pv2[CLOUD_ROOT + '/deletes/' + type + '/' + id] = meta;
      pv2[CLOUD_ROOT + '/edits/' + type + '/' + id] = null;
      cloudWrite(pv2);
    }
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

  // 클라우드(userData) 전체를 읽어와 로컬(skn_user_data)에 병합하고, 로컬에만 있던(아직
  // 클라우드에 올라간 적 없는) 항목은 업로드한다. 앱 로드(로그인 직후) 및 "🔄 동기화" 버튼에서 호출.
  //
  // edits/deletes 우선순위는 별도 규칙을 두지 않고, 병합 결과를 d.edits/d.deletes에 그대로
  // 채운 뒤 기존 mergeBase()→applyOverlay()가 원래 하던 대로(삭제가 수정보다 우선) 처리하게 한다.
  function syncFromCloud() {
    if (!window.firebaseDb || !window.firebaseDbRef || !window.firebaseDbGet || !window.firebaseDbUpdate) {
      return Promise.reject(new Error('클라우드 연결이 준비되지 않았습니다'));
    }
    return window.firebaseDbGet(window.firebaseDbRef(window.firebaseDb, CLOUD_ROOT)).then(function (snap) {
      var cloud = snap.exists() ? snap.val() : {};
      var d = getUserData();
      var seen = getCloudSeen();
      var newSeen = {};
      var uploads = {};
      var uploadedCount = 0;
      var email = currentUserEmail();

      // 1) 항목 배열(착륙장 4종/waypoints/routes): 클라우드 병합 + 다른 기기의 삭제 반영 + 로컬 전용 항목 업로드
      TYPES.forEach(function (type) {
        var cloudItems = cloud[type] || {};
        var cloudIds = Object.keys(cloudItems);
        var seenIds = seen[type] || [];

        // 직전 동기화 때는 클라우드에 있었는데(=이 기기가 이미 받아봤는데) 지금은 없다 → 다른 기기에서 삭제된 것 → 로컬에서도 제거
        var kept = d[type].filter(function (item) {
          return !(seenIds.indexOf(item.id) !== -1 && cloudIds.indexOf(item.id) === -1);
        });

        var byId = {};
        kept.forEach(function (item) { byId[item.id] = item; });
        // 클라우드 항목 반영: 로컬에 없거나, 클라우드 쪽이 더 최신이면 덮어씀
        cloudIds.forEach(function (id) {
          var cItem = cloudItems[id];
          var lItem = byId[id];
          if (!lItem || (cItem.updatedAt || 0) >= (lItem.updatedAt || 0)) byId[id] = cItem;
        });
        d[type] = Object.keys(byId).map(function (id) { return byId[id]; });

        // 이 기기에만 있고(=아직 한 번도 클라우드에서 본 적 없는) 클라우드엔 없는 항목 → 최초 업로드 대상
        d[type].forEach(function (item) {
          if (!cloudItems[item.id] && seenIds.indexOf(item.id) === -1) {
            uploads[CLOUD_ROOT + '/' + type + '/' + item.id] = item;
            uploadedCount++;
          }
        });
        newSeen[type] = cloudIds.slice();
        Object.keys(uploads).forEach(function (path) {
          if (path.indexOf(CLOUD_ROOT + '/' + type + '/') === 0) {
            var id = path.slice((CLOUD_ROOT + '/' + type + '/').length);
            if (newSeen[type].indexOf(id) === -1) newSeen[type].push(id);
          }
        });
      });

      // 2) edits(수정 오버레이) 병합: 더 최신 updatedAt 쪽 채택, 로컬 전용 edit은 업로드
      var cloudEdits = cloud.edits || {};
      TYPES.forEach(function (type) {
        var cTypeEdits = cloudEdits[type] || {};
        Object.keys(cTypeEdits).forEach(function (id) {
          var cE = cTypeEdits[id];
          var lE = d.edits[type][id];
          if (!lE || (cE.updatedAt || 0) >= (lE.updatedAt || 0)) d.edits[type][id] = cE;
        });
        Object.keys(d.edits[type]).forEach(function (id) {
          if (!cTypeEdits[id]) {
            uploads[CLOUD_ROOT + '/edits/' + type + '/' + id] = d.edits[type][id];
            uploadedCount++;
          }
        });
      });

      // 3) deletes(삭제 오버레이) 병합: 합집합(삭제는 항상 우선 — mergeBase가 그대로 적용)
      var cloudDeletes = cloud.deletes || {};
      TYPES.forEach(function (type) {
        var cTypeDeletes = cloudDeletes[type] || {};
        Object.keys(cTypeDeletes).forEach(function (id) {
          if (d.deletes[type].indexOf(id) === -1) d.deletes[type].push(id);
        });
        d.deletes[type].forEach(function (id) {
          if (!cTypeDeletes[id]) {
            uploads[CLOUD_ROOT + '/deletes/' + type + '/' + id] = { addedBy: email, updatedAt: Date.now() };
            uploadedCount++;
          }
        });
      });

      saveUserData(d);
      saveCloudSeen(newSeen);
      mergeBase(baseCache, d);
      buildIndices();

      if (Object.keys(uploads).length) {
        return window.firebaseDbUpdate(window.firebaseDbRef(window.firebaseDb), uploads).then(function () {
          return { uploaded: uploadedCount };
        });
      }
      return { uploaded: 0 };
    });
  }

  global.Data = {
    DB: DB,
    get ROUTES() { return ROUTES; },
    get ALL_POINTS() { return ALL_POINTS; },
    get LAYER_STYLES() { return LAYER_STYLES; },
    loadDatabase: loadDatabase,
    refreshFromLocal: refreshFromLocal,
    syncFromCloud: syncFromCloud,
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
