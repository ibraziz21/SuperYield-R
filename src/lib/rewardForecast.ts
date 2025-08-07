// src/lib/rewardForecast.ts
export function rewardForecast(
    totalUsd: number,
    apyPct:    number,
  ) {
    const yearly  = totalUsd * apyPct / 100
    const monthly = yearly / 12
    const daily   = yearly / 365
    return { daily, monthly, yearly }
  }