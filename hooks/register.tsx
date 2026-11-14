import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  SessionContextUsage,
  SessionCost,
  SessionRateLimit,
  Timer,
} from 'claude-code'

import type { UsageSnapshot, UsageWindow } from '../types'

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const isDetailed = atom({ plugin: 'usage-band', key: 'isDetailed' } as const, false)
const tick = atom({ plugin: 'usage-band', key: 'tick' } as const, 0)
const extras = atom({ plugin: 'usage-band', key: 'extras' } as const, [])
const extrasNote = atom({ plugin: 'usage-band', key: 'extrasNote' } as const, null)

// The account's usage as the usage page reads it: the engine's own figures
// carry the session and weekly windows, this adds the per-model ones (Fable).
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const REFRESH_EVERY_MS = 120000

const WINDOW_LABEL: Record<string, string> = {
  five_hour: '세션',
  seven_day: '주간',
  spend_limit: '지출',
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

const ALERT_AT = 90
const BAR_CELLS = 10
const BAR_WIDTH = 72
const BAR_HEIGHT = 6

// A window the engine names beyond the three above (a per-model weekly cap,
// say `seven_day_fable`) is labelled by what is left of its name: `Fable`.
const labelOf = (kind: string) => {
  const known = WINDOW_LABEL[kind]

  if (known !== undefined) {
    return known
  }

  const rest = kind.replace(/^(seven_day|five_hour)_/, '').replace(/_/g, ' ')

  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

const clamp = (percent: number) => Math.max(0, Math.min(100, percent))

const textTone = (percent: number) =>
  percent >= 90 ? 'error' : percent >= 75 ? 'warning' : 'text'

// An Svg is drawn as an image, outside the theme: raw colors that read on a
// light and a dark page alike.
const barColor = (percent: number) =>
  percent >= 90 ? '#e5484d' : percent >= 75 ? '#f5a623' : '#2f7de1'

const svgBar = (percent: number, width: number) => {
  const share = clamp(percent)
  const filled = share === 0 ? 0 : Math.max(BAR_HEIGHT, Math.round((share / 100) * width))
  const radius = BAR_HEIGHT / 2

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BAR_HEIGHT}" ` +
    `viewBox="0 0 ${width} ${BAR_HEIGHT}">` +
    `<rect width="${width}" height="${BAR_HEIGHT}" rx="${radius}" fill="#8a8a8a" fill-opacity="0.28"/>` +
    `<rect width="${filled}" height="${BAR_HEIGHT}" rx="${radius}" fill="${barColor(percent)}"/>` +
    `</svg>`
  )
}

const filledCells = (percent: number, cells: number) => Math.round((clamp(percent) / 100) * cells)

// How much of a gauge the band's width has room for, widest first: the line
// gives up the reset times, then half of each bar, then the bars, before it
// would wrap and break its labels across rows.
type Fit = { barCells: number; barWidth: number; hasNotes: boolean }

const FITS: readonly Fit[] = [
  { barCells: BAR_CELLS, barWidth: BAR_WIDTH, hasNotes: true },
  { barCells: BAR_CELLS, barWidth: BAR_WIDTH, hasNotes: false },
  { barCells: BAR_CELLS / 2, barWidth: BAR_WIDTH / 2, hasNotes: false },
  { barCells: 0, barWidth: 0, hasNotes: false },
]

const NARROWEST: Fit = { barCells: 0, barWidth: 0, hasNotes: false }

// A Hangul or other wide character takes two cells.
const cellsOf = (text: string) => {
  let cells = 0

  for (const character of text) {
    cells += (character.codePointAt(0) ?? 0) > 0x2e7f ? 2 : 1
  }

  return cells
}

const pct = (percent: number) =>
  Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`

const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const two = (n: number) => String(n).padStart(2, '0')

const parse = (resetsAt: string | undefined) => {
  if (resetsAt === undefined) {
    return null
  }

  const at = Date.parse(resetsAt)

  return Number.isFinite(at) ? at : null
}

// The reset as a clock time, the way the usage page shows it: `18:40` today,
// `월 12:00` on another day.
const resetAt = (resetsAt: string | undefined, now: number) => {
  const at = parse(resetsAt)

  if (at === null) {
    return null
  }

  const when = new Date(at)
  const today = new Date(now)
  const time = `${two(when.getHours())}:${two(when.getMinutes())}`
  const isToday =
    when.getFullYear() === today.getFullYear() &&
    when.getMonth() === today.getMonth() &&
    when.getDate() === today.getDate()

  return isToday ? time : `${WEEKDAYS[when.getDay()] ?? ''} ${time}`
}

const resetIn = (resetsAt: string | undefined, now: number) => {
  const at = parse(resetsAt)

  if (at === null) {
    return null
  }

  const minutes = Math.round((at - now) / 60000)

  if (minutes <= 0) {
    return '곧 초기화'
  }

  if (minutes < 60) {
    return `${minutes}분 남음`
  }

  const hours = Math.floor(minutes / 60)

  if (hours < 24) {
    return `${hours}시간 ${minutes % 60}분 남음`
  }

  return `${Math.floor(hours / 24)}일 ${hours % 24}시간 남음`
}

const toWindow = (w: SessionRateLimit): UsageWindow =>
  w.resetsAt === undefined
    ? { kind: w.kind, percentUsed: w.percentUsed }
    : { kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }

const take = (
  context: SessionContextUsage,
  rateLimits: readonly SessionRateLimit[],
  cost: SessionCost | undefined,
): UsageSnapshot => ({
  contextTokens: context.tokens ?? null,
  contextWindow: context.window,
  contextPercent: context.percent ?? null,
  rateLimits: rateLimits.map(toWindow),
  costUsd: cost?.usd ?? null,
})

const isEmpty = (shot: UsageSnapshot) =>
  shot.contextPercent === null && shot.rateLimits.length === 0 && shot.costUsd === null

type Gauge = { id: string; label: string; percent: number; note: string | null }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const displayName = (value: unknown) => {
  const name = isRecord(value) ? value['display_name'] : undefined

  return typeof name === 'string' && name !== '' ? name : null
}

// The limits the usage page lists beyond the session and the week, from the
// answer's `limits`: one per model (or surface) the plan caps on its own, named
// as the page names it (`Fable`), with the percent the page shows.
const scopedWindows = (body: unknown): UsageWindow[] => {
  const limits = isRecord(body) ? body['limits'] : undefined

  if (!Array.isArray(limits)) {
    return []
  }

  const windows: UsageWindow[] = []

  for (const limit of limits) {
    if (!isRecord(limit) || !isRecord(limit['scope'])) {
      continue
    }

    const label = displayName(limit['scope']['model']) ?? displayName(limit['scope']['surface'])
    const percent = limit['percent']
    const resetsAt = limit['resets_at']

    if (label === null || typeof percent !== 'number' || !Number.isFinite(percent)) {
      continue
    }

    const window = { kind: `scoped:${label}`, label, percentUsed: Math.round(percent * 10) / 10 }

    windows.push(typeof resetsAt === 'string' ? { ...window, resetsAt } : window)
  }

  return windows
}

const nameOf = (w: UsageWindow) => w.label ?? labelOf(w.kind)

// The engine follows `$` only into functions declared at the top of the file,
// so the ones that take `$`, and what they keep between calls, live here.
let refreshedAt = 0
const alerted = new Set<string>()

// One toast as a window passes the mark, armed again once it drops back.
function alertPast($: EngineInterface, windows: readonly UsageWindow[]) {
  for (const w of windows) {
    if (w.percentUsed >= ALERT_AT && !alerted.has(w.kind)) {
      alerted.add(w.kind)
      $.ui.toast(`${nameOf(w)} 한도 ${pct(w.percentUsed)} 사용`)
    } else if (w.percentUsed < ALERT_AT) {
      alerted.delete(w.kind)
    }
  }
}

// Asks the usage endpoint with the session's own login, which the host holds
// and sets on the request: the credential never reaches this module.
async function refreshExtras($: EngineInterface) {
  const now = await $.clock.now()

  if (now - refreshedAt < REFRESH_EVERY_MS) {
    return
  }

  refreshedAt = now

  const authorization = await $.session.authorize()

  if (authorization === null || authorization.kind !== 'bearer') {
    await update($, extrasNote, () => '모델별 한도: 구독 로그인이 아니라 조회할 수 없음')

    return
  }

  const response = await $.http.fetch(USAGE_URL, {
    auth: authorization.handle,
    headers: { 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' },
  })

  if (!response.ok) {
    await update($, extrasNote, () => `모델별 한도 조회 실패 (${response.status})`)

    return
  }

  const windows = scopedWindows(JSON.parse(response.text))

  await update($, extras, () => windows)
  await update($, extrasNote, () => null)
  alertPast($, windows)
}

async function refresh($: EngineInterface) {
  try {
    await refreshExtras($)
  } catch {
    await update($, extrasNote, () => '모델별 한도 조회 실패')
  }
}

export const register: Register = on => {
  let ticker: Timer | undefined

  on('session.start', async ($, e, next) => {
    try {
      const usage = await $.session.usage()
      await update($, snapshot, () => take(usage.context, usage.rateLimits, usage.cost))
    } catch {
      // No figures yet: the band stays quiet until the first measurement.
    }

    // Off the hook's own time: the band draws at once and the request, however
    // long it takes, holds nothing up.
    $.clock.after(1000, () => {
      void refresh($)
    })

    ticker?.cancel()
    // Keeps the reset times moving while the session sits idle.
    ticker = $.clock.every(60000, () => {
      void update($, tick, n => n + 1)
    })

    return next(e)
  })

  on('session.end', ($, e, next) => {
    ticker?.cancel()
    ticker = undefined

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, snapshot, () => take(e.context, e.rateLimits, e.cost))
    void refresh($)
    alertPast($, e.rateLimits.map(toWindow))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shot = await read($, snapshot)

    if (e.props.hasSurvey || shot === null || isEmpty(shot)) {
      return next(e)
    }

    // Read so the minute ticker redraws the reset times.
    await read($, tick)

    const detailed = await read($, isDetailed)
    const now = await $.clock.now()
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // The terminal has no Svg: its bar is drawn in cells.
    const Svg = 'Svg' in ui ? ui.Svg : undefined

    const context = shot.contextPercent
    const tokens = shot.contextTokens

    const note = await read($, extrasNote)
    const known = new Set(shot.rateLimits.map(w => w.kind))
    const perModel = (await read($, extras)).filter(w => !known.has(w.kind))
    const weekly = shot.rateLimits.find(w => w.kind === 'seven_day')
    const weekEnds = parse(weekly?.resetsAt)

    // A model's weekly window resets with the week (the two times differ by a
    // second or so): said once, on the week.
    const resetsWithWeek = (w: UsageWindow) => {
      const at = parse(w.resetsAt)

      return w !== weekly && at !== null && weekEnds !== null && Math.abs(at - weekEnds) < 300000
    }

    const limits: Gauge[] = [...shot.rateLimits, ...perModel].map(w => ({
      id: w.kind,
      label: nameOf(w),
      percent: w.percentUsed,
      note: resetsWithWeek(w) ? null : resetAt(w.resetsAt, now),
    }))

    // Off a subscription there are no limit windows: the line shows the
    // context window instead, so it is never bare.
    const gauges: Gauge[] =
      limits.length > 0 || context === null
        ? limits
        : [{ id: 'context', label: '컨텍스트', percent: context, note: null }]

    const countdowns = shot.rateLimits
      .map(w => ({ kind: w.kind, text: resetIn(w.resetsAt, now) }))
      .filter((r): r is { kind: string; text: string } => r.text !== null)

    const buttonLabel = detailed ? '간단히' : '자세히'

    // The cells the line takes at a fit: each gauge's label, bar, percent and
    // note with the gaps between them, the separators, and the button.
    const cellsAt = (fit: Fit) =>
      gauges.reduce(
        (cells, g, i) =>
          cells +
          (i === 0 ? 0 : 3) +
          cellsOf(g.label) +
          1 +
          (fit.barCells === 0 ? 0 : fit.barCells + 1) +
          cellsOf(pct(g.percent)) +
          1 +
          (fit.hasNotes && g.note !== null ? cellsOf(g.note) + 1 : 0),
        cellsOf(buttonLabel) + 6,
      )

    const room = e.props.bodyColumns
    const fit =
      Number.isFinite(room) && room > 0
        ? (FITS.find(candidate => cellsAt(candidate) <= room) ?? NARROWEST)
        : (FITS[0] ?? NARROWEST)

    const drawBar = (g: Gauge) =>
      Svg === undefined ? (
        <Box flexShrink={0}>
          <Text color={textTone(g.percent)}>
            {'━'.repeat(filledCells(g.percent, fit.barCells))}
          </Text>
          <Text dimColor>{'─'.repeat(fit.barCells - filledCells(g.percent, fit.barCells))}</Text>
        </Box>
      ) : (
        <Svg
          source={svgBar(g.percent, fit.barWidth)}
          alt={`${g.label} ${pct(g.percent)} 사용`}
          width={fit.barWidth}
          height={BAR_HEIGHT}
        />
      )

    return (
      <Box flexDirection="column">
        <Box gap={1} alignItems="center" flexWrap="nowrap">
          {gauges.map((g, i) => (
            <Box key={`gauge-${g.id}`} gap={1} alignItems="center" flexShrink={0} flexWrap="nowrap">
              {i === 0 ? null : <Text dimColor>│</Text>}
              <Text dimColor wrap="truncate-end">
                {g.label}
              </Text>
              {fit.barCells === 0 ? null : drawBar(g)}
              <Text color={textTone(g.percent)} bold wrap="truncate-end">
                {pct(g.percent)}
              </Text>
              {fit.hasNotes && g.note !== null ? (
                <Text dimColor wrap="truncate-end">
                  {g.note}
                </Text>
              ) : null}
            </Box>
          ))}

          <Button
            key="detail"
            label={buttonLabel}
            onPress={() => update($, isDetailed, v => !v)}
          />
        </Box>

        {detailed ? (
          <Box columnGap={1} flexWrap="wrap">
            <Text dimColor>
              {context === null || tokens === null
                ? `컨텍스트 창 ${grouped(shot.contextWindow)} 토큰`
                : `컨텍스트 ${pct(context)} (${grouped(tokens)} / ${grouped(shot.contextWindow)} 토큰)`}
            </Text>
            {shot.costUsd === null ? null : (
              <Text dimColor>{`· 비용 $${shot.costUsd.toFixed(2)}`}</Text>
            )}
            {countdowns.map(r => (
              <Text key={`left-${r.kind}`} dimColor>
                {`· ${labelOf(r.kind)} ${r.text}`}
              </Text>
            ))}
            {note === null || perModel.length > 0 ? null : (
              <Text color="warning">{`· ${note}`}</Text>
            )}
          </Box>
        ) : null}
      </Box>
    )
  })
}
