// The chain reports whole-second block timestamps, so the local target derived
// from one sample can be up to a second early. Polling only in the last five
// seconds keeps that error small without a four-second blind period.
export const ARM_TIGHTEN_MS = 5_000
export const ARM_TICK_MS = 250

export type ArmWait = { delayMs: number; tighten: boolean }

export function armWait(targetMs: number, nowMs: number): ArmWait {
  const remaining = targetMs - nowMs
  if (remaining > ARM_TIGHTEN_MS) {
    return { delayMs: remaining - ARM_TIGHTEN_MS, tighten: false }
  }
  return {
    delayMs: Math.max(0, Math.min(ARM_TICK_MS, remaining)),
    tighten: true,
  }
}
