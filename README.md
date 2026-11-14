# usage-band

Claude Code 프롬프트 입력창 위에 사용량을 한 줄로 보여주는 배너 플러그인입니다.

```
세션 ━━━━━━──── 62% 18:40 │ 주간 ━━━━━━━━── 82% 월 12:00 │ Fable ━━━━━━━━━─ 86%   [자세히]
```

- **세션**: 5시간 한도 사용률과 초기화 시각
- **주간**: 주간 한도 사용률과 초기화 시각
- **모델별 한도**: 요금제가 모델별로 따로 두는 주간 한도(예: Fable)
- **[자세히]**: 컨텍스트 창 사용률과 토큰 수, 세션 비용, 한도별 남은 시간

막대는 75%부터 주황, 90%부터 빨강으로 바뀌고, 한도가 90%를 넘으면 한 번 알림을 띄웁니다. 창이 좁으면 초기화 시각, 막대 순으로 줄여 한 줄을 유지합니다.

## 설치

### Claude 데스크톱 앱

1. 프롬프트 입력창 옆의 **+** 를 누릅니다.
2. **Plugins** 를 고릅니다.
3. **Add marketplace** 에 `hanskim-coxspace/claude-usage-band` 를 입력합니다.
4. 목록에서 `usage-band` 를 **Add plugin** 으로 추가합니다.

### 터미널의 Claude Code

프롬프트에서:

```
/plugin install usage-band --marketplace hanskim-coxspace/claude-usage-band
```

셸에서:

```
claude plugin install usage-band --marketplace hanskim-coxspace/claude-usage-band
```

마켓플레이스를 추가할지 물으면 `y`, 범위는 사용자(user)를 고르면 이후 모든 세션에서 로드됩니다.

## 켜고 끄기

- 데스크톱 앱: **+** → **Plugins** 에서 `usage-band` 를 켜거나 끕니다.
- 터미널: `/plugin` 메뉴에서 켜거나 끕니다.
- 잠깐만 가리려면 배너 오른쪽의 `[-]` (또는 `ctrl+x ctrl+a`)로 접습니다.

## 무엇을 읽나

- 세션·주간 한도, 컨텍스트, 비용은 Claude Code가 플러그인에 넘겨주는 값을 그대로 씁니다.
- 모델별 한도는 Claude Code가 넘겨주지 않아서, Anthropic의 사용량 조회 경로(`api.anthropic.com/api/oauth/usage`)를 직접 읽습니다. 세션의 구독 로그인은 Claude Code가 요청에 대신 붙이며, 플러그인 코드는 토큰을 볼 수 없습니다. 조회는 세션 시작 때와 턴이 끝날 때, 2분에 한 번 이하로 합니다.
- 다른 곳으로 보내는 데이터는 없습니다.

## 참고

- 구독 로그인이 아닌 경우(API 키 과금 등)에는 한도 칸 대신 컨텍스트 사용률만 표시됩니다.
- Claude Code의 플러그인 훅 API는 얼리 액세스라, Claude Code 버전에 따라 동작이 달라질 수 있습니다. 2.1.325에서 확인했습니다.
- 사용량 조회 경로는 공개 문서가 없는 내부 경로라, 응답 형식이 바뀌면 모델별 한도 칸이 사라질 수 있습니다.
