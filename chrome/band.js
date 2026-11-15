// 확장 쪽(격리 세계). 가로챈 사용량 응답을 한 줄 배너로 그리고, 배운 경로로 스스로 갱신한다.
(() => {
  'use strict';
  const TAG = 'claude-usage-band';
  const ID = 'claude-usage-band';
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const REFRESH_MS = 120000;
  const TICK_MS = 30000;
  const DEFAULTS = { enabled: true, position: 'bottom-right' };
  const MODEL_COLUMNS = 2;
  const HINT = '사용량을 아직 못 읽었어요 — 설정 → 사용량을 한 번 열어주세요';

  let settings = Object.assign({}, DEFAULTS);
  let learnedUrl = null;
  let windows = [];
  let note = null;
  let detailed = false;
  let hidden = false;
  let lastFetch = 0;

  const onAuthPage = () => /^\/(login|logout|magic-link|oauth)/.test(location.pathname);

  // ---- 응답 읽기 : 형식을 넓게 받아들인다 ----
  const num = (value) => (typeof value === 'number' && isFinite(value) ? value : null);

  const percentOf = (node) => {
    for (const key of ['percent', 'percent_used', 'percentUsed']) {
      const value = num(node[key]);
      if (value !== null) return value;
    }
    const used = num(node.utilization);
    if (used !== null) return used <= 1 ? used * 100 : used;
    return null;
  };

  const resetOf = (node) => {
    for (const key of ['resets_at', 'reset_at', 'resetsAt', 'resetAt']) {
      if (typeof node[key] === 'string') return node[key];
    }
    return null;
  };

  const labelOf = (node, key) => {
    const scope = node.scope;
    if (scope && typeof scope === 'object') {
      const model = scope.model;
      if (model && typeof model === 'object' && typeof model.display_name === 'string') return model.display_name;
      if (typeof model === 'string') return model;
      if (typeof scope.surface === 'string') return scope.surface;
    }
    const kind = String(node.kind || node.type || key || '').toLowerCase();
    if (/five_?hour|5h/.test(kind)) return '세션';
    if (/seven_?day|7d|week/.test(kind)) return '주간';
    if (/spend|cost|dollar/.test(kind)) return '지출';
    return null;
  };

  const rank = (label) => (label === '세션' ? 0 : label === '주간' ? 1 : label === '지출' ? 3 : 2);

  const parseUsage = (data) => {
    const found = [];
    const walk = (node, key, depth) => {
      if (!node || typeof node !== 'object' || depth > 6) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, key, depth + 1);
        return;
      }
      const percent = percentOf(node);
      if (percent !== null) {
        const label = labelOf(node, key);
        if (label) {
          found.push({
            label,
            percent: Math.max(0, Math.min(100, Math.round(percent * 10) / 10)),
            resetsAt: resetOf(node),
          });
        }
      }
      for (const entry of Object.keys(node)) walk(node[entry], entry, depth + 1);
    };
    walk(data, null, 0);
    const byLabel = new Map();
    for (const item of found) if (!byLabel.has(item.label)) byLabel.set(item.label, item);
    const sorted = Array.from(byLabel.values()).sort(
      (a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label)
    );
    // 모델별 한도는 여러 개일 수 있다. 줄이 잘리지 않게 사용률 높은 쪽만 남긴다.
    const kept = sorted
      .filter((item) => rank(item.label) === 2)
      .sort((a, b) => b.percent - a.percent)
      .slice(0, MODEL_COLUMNS);
    return sorted.filter((item) => rank(item.label) !== 2 || kept.indexOf(item) !== -1);
  };

  // ---- 표시 ----
  const colorOf = (percent) => (percent >= 90 ? '#e5484d' : percent >= 75 ? '#f5a623' : '#2f7de1');

  const fmtReset = (iso) => {
    const at = Date.parse(iso);
    if (!isFinite(at)) return null;
    const when = new Date(at);
    const clock =
      String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0');
    return when.toDateString() === new Date().toDateString()
      ? clock
      : WEEKDAYS[when.getDay()] + ' ' + clock;
  };

  const fmtLeft = (iso) => {
    const at = Date.parse(iso);
    if (!isFinite(at)) return null;
    const seconds = Math.max(0, Math.round((at - Date.now()) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? hours + '시간 ' + minutes + '분 남음' : minutes + '분 남음';
  };

  const isDark = () => {
    for (const node of [document.body, document.documentElement]) {
      if (!node) continue;
      const parts = getComputedStyle(node).backgroundColor.match(/[\d.]+/g);
      if (!parts || parts.length < 3) continue;
      if (parts.length > 3 && Number(parts[3]) === 0) continue;
      const light = 0.299 * Number(parts[0]) + 0.587 * Number(parts[1]) + 0.114 * Number(parts[2]);
      return light < 128;
    }
    return matchMedia('(prefers-color-scheme: dark)').matches;
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const root = () => {
    let node = document.getElementById(ID);
    if (!node) {
      node = document.createElement('div');
      node.id = ID;
      node.addEventListener('click', (event) => {
        const target = event.target;
        if (target && target.dataset && target.dataset.act === 'close') {
          hidden = true;
          render();
          return;
        }
        detailed = !detailed;
        render();
      });
      (document.body || document.documentElement).appendChild(node);
    }
    return node;
  };

  const render = () => {
    if (onAuthPage()) {
      const existing = document.getElementById(ID);
      if (existing) existing.remove();
      return;
    }
    const node = root();
    if (!settings.enabled || hidden) {
      node.style.display = 'none';
      return;
    }
    node.style.display = '';
    node.dataset.pos = settings.position;
    node.dataset.theme = isDark() ? 'dark' : 'light';
    node.title = '눌러서 남은 시간 보기';
    node.textContent = '';

    if (!windows.length) {
      node.appendChild(el('span', 'cub-note', note || HINT));
    } else {
      windows.forEach((item, index) => {
        if (index) node.appendChild(el('span', 'cub-sep', '│'));
        const column = el('span', 'cub-col');
        column.appendChild(el('span', 'cub-label', item.label));
        const track = el('span', 'cub-track');
        const fill = el('span', 'cub-fill');
        fill.style.width = (item.percent <= 0 ? 0 : Math.max(8, item.percent)) + '%';
        fill.style.background = colorOf(item.percent);
        track.appendChild(fill);
        column.appendChild(track);
        column.appendChild(el('span', 'cub-pct', Math.round(item.percent) + '%'));
        const reset = item.resetsAt && (detailed ? fmtLeft(item.resetsAt) : fmtReset(item.resetsAt));
        if (reset) column.appendChild(el('span', 'cub-reset', reset));
        node.appendChild(column);
      });
      if (note) {
        node.appendChild(el('span', 'cub-sep', '│'));
        node.appendChild(el('span', 'cub-note', note));
      }
    }

    const close = el('span', 'cub-close', '×');
    close.dataset.act = 'close';
    close.title = '이 탭에서 숨기기';
    node.appendChild(close);
  };

  // ---- 데이터 ----
  const absorb = (url, data) => {
    const parsed = parseUsage(data);
    if (!parsed.length) return false;
    windows = parsed;
    note = null;
    const store = { cache: { at: Date.now(), windows: parsed } };
    if (url) {
      learnedUrl = url;
      store.learnedUrl = url;
    }
    try { chrome.storage.local.set(store); } catch (_) {}
    render();
    return true;
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const payload = event.data;
    if (!payload || payload.tag !== TAG || payload.kind !== 'usage') return;
    absorb(typeof payload.url === 'string' ? payload.url : null, payload.data);
  });

  const refresh = async (force) => {
    if (!learnedUrl || !settings.enabled || hidden || onAuthPage()) return;
    if (!force && Date.now() - lastFetch < REFRESH_MS) return;
    if (document.visibilityState !== 'visible') return;
    lastFetch = Date.now();
    try {
      const response = await fetch(learnedUrl, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        note = '사용량 조회 실패 (' + response.status + ')';
        render();
        return;
      }
      absorb(learnedUrl, await response.json());
    } catch (_) {
      note = '사용량 조회 실패';
      render();
    }
  };

  chrome.storage.local.get(['settings', 'learnedUrl', 'cache'], (got) => {
    settings = Object.assign({}, DEFAULTS, (got && got.settings) || {});
    learnedUrl = got && typeof got.learnedUrl === 'string' ? got.learnedUrl : null;
    if (got && got.cache && Array.isArray(got.cache.windows)) windows = got.cache.windows;
    render();
    refresh(true);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    settings = Object.assign({}, DEFAULTS, changes.settings.newValue || {});
    hidden = false;
    render();
    refresh(true);
  });

  setInterval(() => {
    render();
    refresh(false);
  }, TICK_MS);

  document.addEventListener('visibilitychange', () => refresh(false));
})();
