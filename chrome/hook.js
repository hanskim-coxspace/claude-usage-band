// MAIN world. claude.ai 자신이 가져오는 사용량 응답만 엿보고, 그 경로를 배너 쪽에 알려준다.
// 추가 요청을 만들지 않고, 밖으로 보내는 것도 없다.
(() => {
  'use strict';
  const TAG = 'claude-usage-band';

  const looksLikeUsage = (data) => {
    if (!data || typeof data !== 'object') return false;
    let text;
    try { text = JSON.stringify(data); } catch (_) { return false; }
    if (!text || text.length > 400000) return false;
    if (/"(five_hour|seven_day|five_hour_limit|seven_day_limit)"\s*:/.test(text)) return true;
    return /"(percent|percent_used|utilization)"\s*:/.test(text) && /"resets?_at"\s*:/.test(text);
  };

  const report = (url, data) => {
    let absolute = null;
    try { absolute = new URL(url, location.origin).href; } catch (_) { absolute = null; }
    if (absolute && !absolute.startsWith(location.origin)) absolute = null;
    try {
      window.postMessage({ tag: TAG, kind: 'usage', url: absolute, data }, location.origin);
    } catch (_) { /* 복제 불가한 응답은 넘긴다 */ }
  };

  const isApi = (url) => typeof url === 'string' && /\/api\//.test(url);

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      const result = nativeFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (isApi(url)) {
          Promise.resolve(result).then((response) => {
            const type = (response.headers && response.headers.get('content-type')) || '';
            if (!/json/i.test(type)) return;
            response.clone().json().then((data) => {
              if (looksLikeUsage(data)) report(url, data);
            }).catch(() => {});
          }).catch(() => {});
        }
      } catch (_) {}
      return result;
    };
  }

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__usageBandUrl = url; } catch (_) {}
    return nativeOpen.apply(this, arguments);
  };

  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    try {
      const url = this.__usageBandUrl;
      if (isApi(url)) {
        this.addEventListener('load', () => {
          try {
            if (typeof this.responseText !== 'string') return;
            const data = JSON.parse(this.responseText);
            if (looksLikeUsage(data)) report(url, data);
          } catch (_) {}
        });
      }
    } catch (_) {}
    return nativeSend.apply(this, arguments);
  };
})();
