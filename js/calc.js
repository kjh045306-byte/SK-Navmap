/* SK 항법지도 2.0 — 거리/시간/연료/좌표 계산 */
(function (global) {
  'use strict';

  var NM_RADIUS = 3440.065; // 지구 반지름 (해리, nautical miles)

  function toRad(deg) { return (deg * Math.PI) / 180; }

  // 대권거리(Haversine) — 두 좌표 사이 거리(NM)
  function haversineNM(lat1, lng1, lat2, lng2) {
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return NM_RADIUS * c;
  }

  // 경로(coords 배열)의 총 거리(NM) — 각 구간 합산
  function routeDistanceNM(coords) {
    if (!coords || coords.length < 2) return 0;
    var total = 0;
    for (var i = 0; i < coords.length - 1; i++) {
      total += haversineNM(coords[i].lat, coords[i].lng, coords[i + 1].lat, coords[i + 1].lng);
    }
    return total;
  }

  // 소요시간(분) = 거리(NM) / 속도(KTS) * 60
  function timeMin(distNm, kts) {
    return (distNm / kts) * 60;
  }

  // 연료(LBS) = 130KTS 소요시간(분) * 10
  function fuelLbs(t130Min) {
    return t130Min * 10;
  }

  // 소수점 좌표(DD) → FMS 도분(DDM) 형식 { lat:'N3727.69', lng:'E12702.43' }
  function toFMS(lat, lng) {
    var latH = lat >= 0 ? 'N' : 'S';
    var lngH = lng >= 0 ? 'E' : 'W';
    var la = Math.abs(lat);
    var lo = Math.abs(lng);
    var laDeg = Math.floor(la);
    var laMin = (la - laDeg) * 60;
    var loDeg = Math.floor(lo);
    var loMin = (lo - loDeg) * 60;
    var latStr = latH + String(laDeg).padStart(2, '0') + laMin.toFixed(2).padStart(5, '0');
    var lngStr = lngH + String(loDeg).padStart(3, '0') + loMin.toFixed(2).padStart(5, '0');
    return { lat: latStr, lng: lngStr };
  }

  // 소수점 좌표(DD) → 구글어스 방식 도분초(DMS) 형식 { lat:'N37°27\'41"', lng:'E127°02\'26"' }
  function toDMS(lat, lng) {
    function parts(v, degPad) {
      var deg = Math.floor(v);
      var minFull = (v - deg) * 60;
      var min = Math.floor(minFull);
      var sec = Math.round((minFull - min) * 60);
      if (sec === 60) { sec = 0; min += 1; }
      if (min === 60) { min = 0; deg += 1; }
      return String(deg).padStart(degPad, '0') + '°' +
        String(min).padStart(2, '0') + '\'' +
        String(sec).padStart(2, '0') + '"';
    }
    var latH = lat >= 0 ? 'N' : 'S';
    var lngH = lng >= 0 ? 'E' : 'W';
    return {
      lat: latH + parts(Math.abs(lat), 2),
      lng: lngH + parts(Math.abs(lng), 3)
    };
  }

  // coords 배열의 첫 좌표와 마지막 좌표가 같은지로 "닫힌 구역(면)"인지 판정한다.
  // geomType 문자열(Polygon/LineString)은 원본(KMZ) placemark 타입을 그대로 옮겨온 값이라
  // 실제 폐합 여부와 어긋나는 경우가 있으므로(예: Polygon인데 열려있는 항목), 좌표로 직접 판정한다.
  function isClosedRing(coords) {
    if (!coords || coords.length < 3) return false;
    var a = coords[0], b = coords[coords.length - 1];
    return Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;
  }

  global.Calc = {
    haversineNM: haversineNM,
    routeDistanceNM: routeDistanceNM,
    timeMin: timeMin,
    fuelLbs: fuelLbs,
    toFMS: toFMS,
    toDMS: toDMS,
    isClosedRing: isClosedRing
  };
})(window);
