/* SK 항법지도 2.0 — KMZ/KML 업로드 파싱 (외부 라이브러리 없이 ZIP 해제 + KML Placemark 추출) */
(function (global) {
  'use strict';

  function readUint16LE(buf, off) { return buf[off] | (buf[off + 1] << 8); }
  function readUint32LE(buf, off) { return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0; }

  function inflateRaw(compData) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('이 브라우저는 압축 해제를 지원하지 않습니다(DecompressionStream 없음)'));
    }
    var stream = new Blob([compData]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  // 표준 ZIP(로컬/중앙 디렉터리) 구조를 직접 파싱해 파일명→압축해제된 바이트 맵을 만든다.
  // KMZ는 순수 ZIP이라 압축(deflate)/비압축(stored) 두 방식만 지원하면 충분하다.
  function unzip(arrayBuffer) {
    var buf = new Uint8Array(arrayBuffer);
    var eocdSig = 0x06054b50;
    var searchFloor = Math.max(0, buf.length - 22 - 65536);
    var eocdOffset = -1;
    for (var i = buf.length - 22; i >= searchFloor; i--) {
      if (readUint32LE(buf, i) === eocdSig) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) return Promise.reject(new Error('ZIP 형식이 아닙니다(EOCD 레코드 없음)'));

    var totalEntries = readUint16LE(buf, eocdOffset + 10);
    var cdOffset = readUint32LE(buf, eocdOffset + 16);

    var entries = [];
    var offset = cdOffset;
    for (var n = 0; n < totalEntries; n++) {
      if (readUint32LE(buf, offset) !== 0x02014b50) return Promise.reject(new Error('ZIP 중앙 디렉터리가 손상되었습니다'));
      var compMethod = readUint16LE(buf, offset + 10);
      var compSize = readUint32LE(buf, offset + 20);
      var nameLen = readUint16LE(buf, offset + 28);
      var extraLen = readUint16LE(buf, offset + 30);
      var commentLen = readUint16LE(buf, offset + 32);
      var localHeaderOffset = readUint32LE(buf, offset + 42);
      var name = new TextDecoder('utf-8').decode(buf.subarray(offset + 46, offset + 46 + nameLen));
      entries.push({ name: name, compMethod: compMethod, compSize: compSize, localHeaderOffset: localHeaderOffset });
      offset += 46 + nameLen + extraLen + commentLen;
    }

    return Promise.all(entries.map(function (entry) {
      var lh = entry.localHeaderOffset;
      if (readUint32LE(buf, lh) !== 0x04034b50) return null;
      var lNameLen = readUint16LE(buf, lh + 26);
      var lExtraLen = readUint16LE(buf, lh + 28);
      var dataStart = lh + 30 + lNameLen + lExtraLen;
      var compData = buf.subarray(dataStart, dataStart + entry.compSize);

      if (entry.compMethod === 0) return Promise.resolve({ name: entry.name, data: compData });
      if (entry.compMethod === 8) return inflateRaw(compData).then(function (raw) { return { name: entry.name, data: raw }; });
      return null; // 미지원 압축 방식(드묾)은 건너뜀
    })).then(function (results) {
      var files = {};
      results.forEach(function (r) { if (r) files[r.name] = r.data; });
      return files;
    });
  }

  // KML <coordinates>는 "lng,lat[,alt] lng,lat[,alt] ..." 형식 — lat/lng 순서가 우리 내부 표기와 반대라 뒤집는다.
  function parseCoordText(text) {
    return text.trim().split(/\s+/).filter(Boolean).map(function (tuple) {
      var parts = tuple.split(',');
      return { lat: parseFloat(parts[1]), lng: parseFloat(parts[0]) };
    }).filter(function (p) { return isFinite(p.lat) && isFinite(p.lng); });
  }

  function firstChildCoords(el) {
    var c = el.getElementsByTagName('coordinates')[0];
    return c ? parseCoordText(c.textContent) : [];
  }

  function extractPlacemarks(kmlText) {
    var xml = new DOMParser().parseFromString(kmlText, 'text/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('KML 파싱 오류');
    var placemarks = xml.getElementsByTagName('Placemark');
    var items = [];
    for (var i = 0; i < placemarks.length; i++) {
      var pm = placemarks[i];
      var nameEl = pm.getElementsByTagName('name')[0];
      var descEl = pm.getElementsByTagName('description')[0];
      var name = nameEl && nameEl.textContent.trim() ? nameEl.textContent.trim() : ('항목 ' + (i + 1));
      var memo = descEl ? descEl.textContent.trim() : '';

      var pointEl = pm.getElementsByTagName('Point')[0];
      var lineEl = pm.getElementsByTagName('LineString')[0];
      var polyEl = pm.getElementsByTagName('Polygon')[0];

      if (pointEl) {
        var pts = firstChildCoords(pointEl);
        if (!pts.length) continue;
        items.push({ id: 'kmz_' + i, name: name, memo: memo, geomType: 'Point', lat: pts[0].lat, lng: pts[0].lng });
      } else if (lineEl) {
        var lCoords = firstChildCoords(lineEl);
        if (lCoords.length < 2) continue;
        items.push({ id: 'kmz_' + i, name: name, memo: memo, geomType: 'LineString', coords: lCoords });
      } else if (polyEl) {
        var outer = polyEl.getElementsByTagName('outerBoundaryIs')[0] || polyEl;
        var pCoords = firstChildCoords(outer);
        if (pCoords.length < 3) continue;
        items.push({ id: 'kmz_' + i, name: name, memo: memo, geomType: 'Polygon', coords: pCoords });
      }
    }
    return items;
  }

  function parseFile(file) {
    if (/\.kml$/i.test(file.name)) {
      return file.text().then(function (text) { return { items: extractPlacemarks(text) }; });
    }
    return file.arrayBuffer().then(unzip).then(function (files) {
      var kmlName = Object.keys(files).filter(function (n) { return /\.kml$/i.test(n); })
        .sort(function (a, b) { return a.length - b.length; })[0]; // doc.kml처럼 짧은 경로 우선
      if (!kmlName) throw new Error('KMZ 안에 KML 파일이 없습니다');
      var text = new TextDecoder('utf-8').decode(files[kmlName]);
      return { items: extractPlacemarks(text) };
    });
  }

  global.KmzParser = { parseFile: parseFile };
})(window);
