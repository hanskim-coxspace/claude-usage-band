export type UsageWindow = {
  kind: string
  percentUsed: number
  resetsAt?: string
  label?: string
}

export type UsageSnapshot = {
  contextTokens: number | null
  contextWindow: number
  contextPercent: number | null
  rateLimits: UsageWindow[]
  costUsd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      snapshot: UsageSnapshot | null
      isDetailed: boolean
      tick: number
      extras: UsageWindow[]
      extrasNote: string | null
    }
  }
}
