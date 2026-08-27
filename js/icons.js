/* SK 항법지도 2.0 — 착륙장류 공용 아이콘/색상 프리셋 (마커 렌더링 + 추가/수정 폼 선택 UI 공용) */
(function (global) {
  'use strict';

  // Tabler 아이콘 클래스명을 식별자로 그대로 저장 — 렌더링은 자체 SVG로 처리(오프라인 PWA라 외부 아이콘폰트 의존 없음)
  // 선택 가능한 프리셋은 6종(실사용 빈도 기준으로 축소). map-pin/flag/building/triangle/star/
  // building-hospital은 더 이상 선택지에 없지만, 기존에 그 값으로 저장된 데이터가 있을 수 있어
  // 렌더링 함수(shapeInner/glyphInner)에서는 그대로 남겨 마이그레이션 없이도 계속 정상 표시된다.
  var ICON_PRESETS = ['ti-plane', 'ti-helipad', 'ti-hospital', 'ti-circle', 'ti-square', 'ti-diamond'];
  // 노랑/파랑/녹색/SK오렌지/빨강 — 색상은 항목마다 원본 hex 문자열 그대로 저장되므로
  // (프리셋 인덱스가 아님) 이 배열을 바꿔도 기존에 다른 색으로 저장된 데이터는 영향받지 않는다.
  // 흰색은 팔레트에서 제외(5종 전부 흰색 심볼이 잘 보이는 색이라 대비 처리 불필요)
  var COLOR_PRESETS = ['#FFD400', '#378ADD', '#1D9E75', '#EE6C0F', '#E24B4A'];

  // 타입별 기본 아이콘/색상 — icon/color 필드가 없는(마이그레이션 전) base 항목의 폴백.
  // waypoints/reportPoints는 이전부터 지도에 서로 다른 색(파랑/하늘색)의 원으로 렌더링되던 값을
  // 그대로 프리셋화한 것 — 임의로 새로 정하지 않음(layerStyles.waypoints/.reportPoints.color 참고)
  var DEFAULT_ICON = {
    sk_landings: 'ti-flag', offsite_landings: 'ti-map-pin', hospital_landings: 'ti-building-hospital',
    ultralight_landings: 'ti-triangle', waypoints: 'ti-circle', airports: 'ti-plane', reportPoints: 'ti-circle'
  };
  var DEFAULT_COLOR = {
    sk_landings: '#378ADD', offsite_landings: '#1D9E75', hospital_landings: '#E24B4A',
    ultralight_landings: '#BA7517', waypoints: '#378ADD', airports: '#378ADD', reportPoints: '#7DD3FC'
  };

  function defaultIcon(type) { return DEFAULT_ICON[type] || 'ti-circle'; }
  function defaultColor(type) { return DEFAULT_COLOR[type] || COLOR_PRESETS[0]; }
  function iconOf(type, item) { return (item && item.icon) || defaultIcon(type); }
  function colorOf(type, item) { return (item && item.color) || defaultColor(type); }

  // 순수 도형 프리셋 — 색칠된 도형 자체를 표시(별도 배지 불필요)
  var SHAPE_KEYS = { 'ti-circle': 1, 'ti-square': 1, 'ti-triangle': 1, 'ti-diamond': 1, 'ti-star': 1 };

  function shapeInner(key, color) {
    if (key === 'ti-circle') return '<circle cx="12" cy="12" r="9" fill="' + color + '" stroke="#ffffff" stroke-width="2"/>';
    if (key === 'ti-square') return '<rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="' + color + '" stroke="#ffffff" stroke-width="2"/>';
    if (key === 'ti-triangle') return '<path d="M12 3 L21 20 L3 20 Z" fill="' + color + '" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>';
    if (key === 'ti-diamond') return '<path d="M12 2 L22 12 L12 22 L2 12 Z" fill="' + color + '" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>';
    return '<path d="M12 2.5 L14.9 9.3 L22.3 9.9 L16.6 14.6 L18.5 21.8 L12 17.8 L5.5 21.8 L7.4 14.6 L1.7 9.9 L9.1 9.3 Z" fill="' + color + '" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>'; // ti-star
  }

  // 아이콘형 프리셋 — 색칠된 원형 배지 위에 흰색 심볼(지도 마커 스타일과 통일)
  var GLYPH_PATHS = {
    'ti-plane': 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2.5 1.5V22l4-1 4 1v-1.5L13 19v-4.5z',
    'ti-map-pin': 'M12 2C8.14 2 5 5.14 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.86-3.14-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z',
    'ti-flag': 'M5 2v20h2v-7h11l-2.5-4.5L18 6H7V2H5z'
  };

  function glyphInner(key, color) {
    var badge = '<circle cx="12" cy="12" r="9" fill="' + color + '" stroke="#ffffff" stroke-width="2"/>';
    if (key === 'ti-building') {
      return badge +
        '<rect x="7.5" y="7" width="9" height="11" fill="#ffffff"/>' +
        '<rect x="9" y="9" width="2" height="2" fill="' + color + '"/>' +
        '<rect x="13" y="9" width="2" height="2" fill="' + color + '"/>' +
        '<rect x="9" y="12.5" width="2" height="2" fill="' + color + '"/>' +
        '<rect x="13" y="12.5" width="2" height="2" fill="' + color + '"/>';
    }
    if (key === 'ti-building-hospital') { // 더 이상 선택 불가 — 기존 저장 데이터 렌더링용으로만 유지
      return badge +
        '<rect x="7.5" y="7" width="9" height="11" fill="#ffffff"/>' +
        '<rect x="10.7" y="9" width="2.6" height="7" fill="' + color + '"/>' +
        '<rect x="9" y="11.7" width="6" height="2.6" fill="' + color + '"/>';
    }
    if (key === 'ti-helipad') { // 원 안에 "H" — 헬리패드
      return badge +
        '<text x="12" y="16.5" font-size="11" font-weight="900" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif">H</text>';
    }
    if (key === 'ti-hospital') { // 원 안에 십자가 — building-hospital의 단순화 버전
      return badge +
        '<rect x="10.5" y="6.5" width="3" height="11" rx="0.5" fill="#ffffff"/>' +
        '<rect x="6.5" y="10.5" width="11" height="3" rx="0.5" fill="#ffffff"/>';
    }
    var path = GLYPH_PATHS[key];
    if (!path) return shapeInner('ti-circle', color);
    return badge + '<g transform="translate(4,4) scale(0.67)"><path d="' + path + '" fill="#ffffff"/></g>';
  }

  function innerSvg(key, color) {
    return SHAPE_KEYS[key] ? shapeInner(key, color) : glyphInner(key, color);
  }

  // key/color를 24x24 viewBox의 SVG 마크업 문자열로 변환 — 지도 마커(data URI)와 폼 미리보기 버튼이 공유
  function svgMarkup(key, color, size) {
    size = size || 24;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24">' + innerSvg(key, color) + '</svg>';
  }

  // 지도 마커용 google.maps.Icon 서술자 — google.maps 로드 완료 후(map.js에서)만 호출됨
  function markerIcon(key, color, size) {
    size = size || 30;
    var c = size / 2;
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgMarkup(key, color, size)),
      scaledSize: new google.maps.Size(size, size),
      anchor: new google.maps.Point(c, c)
    };
  }

  function buildIconGrid(container, getColor, selected, onSelect) {
    container.innerHTML = '';
    ICON_PRESETS.forEach(function (key) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-grid-btn' + (key === selected ? ' selected' : '');
      btn.innerHTML = svgMarkup(key, getColor(), 22);
      btn.addEventListener('click', function () { onSelect(key); });
      container.appendChild(btn);
    });
  }

  function buildColorRow(container, selected, onSelect) {
    container.innerHTML = '';
    COLOR_PRESETS.forEach(function (hex) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-swatch' + (hex === selected ? ' selected' : '');
      btn.style.background = hex;
      btn.addEventListener('click', function () { onSelect(hex); });
      container.appendChild(btn);
    });
  }

  // 아이콘그리드 + 색상스와치 공용 선택 컴포넌트. 착륙장 추가/수정 폼과, 이후 WayPoint 등에서도
  // 재사용할 수 있도록 DOM 컨테이너 2개(iconEl, colorEl)만 넘기면 알아서 렌더링/갱신한다.
  function mountPicker(iconEl, colorEl, initialIcon, initialColor) {
    var state = { icon: initialIcon, color: initialColor };
    function renderIcons() {
      buildIconGrid(iconEl, function () { return state.color; }, state.icon, function (key) {
        state.icon = key;
        renderIcons();
      });
    }
    function renderColors() {
      buildColorRow(colorEl, state.color, function (hex) {
        state.color = hex;
        renderIcons();
        renderColors();
      });
    }
    renderIcons();
    renderColors();
    return {
      setValue: function (icon, color) { state.icon = icon; state.color = color; renderIcons(); renderColors(); },
      getValue: function () { return { icon: state.icon, color: state.color }; }
    };
  }

  // 색상 스와치만 필요한 곳(구역/CTRZ류 편집)을 위한 단독 컴포넌트. onChange가 있으면 선택할 때마다
  // 즉시 호출한다(지도에 실시간 반영하는 용도) — mountPicker와 달리 getValue만으로 폴링하지 않아도 됨.
  function mountColorPicker(colorEl, initialColor, onChange) {
    var state = { color: initialColor };
    function render() {
      buildColorRow(colorEl, state.color, function (hex) {
        state.color = hex;
        render();
        if (onChange) onChange(hex);
      });
    }
    render();
    return {
      setValue: function (color) { state.color = color; render(); },
      getValue: function () { return state.color; }
    };
  }

  global.Icons = {
    PRESETS: ICON_PRESETS,
    COLORS: COLOR_PRESETS,
    defaultIcon: defaultIcon,
    defaultColor: defaultColor,
    iconOf: iconOf,
    colorOf: colorOf,
    svgMarkup: svgMarkup,
    markerIcon: markerIcon,
    mountPicker: mountPicker,
    mountColorPicker: mountColorPicker
  };
})(window);
