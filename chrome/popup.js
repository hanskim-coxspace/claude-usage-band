const DEFAULTS = { enabled: true, position: 'bottom-right' };
const field = (id) => document.getElementById(id);

chrome.storage.local.get(['settings', 'learnedUrl', 'cache'], (got) => {
  const settings = Object.assign({}, DEFAULTS, (got && got.settings) || {});
  field('enabled').checked = settings.enabled;
  field('position').value = settings.position;

  const count = got && got.cache && Array.isArray(got.cache.windows) ? got.cache.windows.length : 0;
  if (count) {
    field('status').textContent = '한도 ' + count + '개를 읽고 있습니다.';
  } else if (got && got.learnedUrl) {
    field('status').textContent = '사용량 경로는 찾았고, 다음 갱신을 기다리고 있습니다.';
  } else {
    field('status').textContent = 'claude.ai에서 설정 → 사용량을 한 번 열면 배너가 채워집니다.';
  }
});

const save = () =>
  chrome.storage.local.set({
    settings: { enabled: field('enabled').checked, position: field('position').value },
  });

field('enabled').addEventListener('change', save);
field('position').addEventListener('change', save);
