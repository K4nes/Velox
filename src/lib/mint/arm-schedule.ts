// The chain reports whole-second block timestamps, so the local target derived
// from one sample can be up to a second early. Polling only in the last five
// seconds keeps that error small without a four-second blind period.
export const ARM_PREPARE_MS = 30_000
export const ARM_TIGHTEN_MS = 5_000
export const ARM_TICK_MS = 250

// setTimeout stores its delay in a signed 32-bit integer. A stage thirty days
// out overflows it and wakes immediately, so long waits sleep in bounded steps
// and re-evaluate the target when they wake.
export const ARM_MAX_SLEEP_MS = 60_000

export type ArmWait = { delayMs: number; tighten: boolean; prepare: boolean }

export function armWait(targetMs: number, nowMs: number): ArmWait {
  const remaining = targetMs - nowMs
  if (remaining > ARM_PREPARE_MS) {
    return {
      delayMs: Math.min(remaining - ARM_PREPARE_MS, ARM_MAX_SLEEP_MS),
      tighten: false,
      prepare: false,
    }
  }
  if (remaining > ARM_TIGHTEN_MS) {
    return {
      delayMs: Math.min(remaining - ARM_TIGHTEN_MS, ARM_MAX_SLEEP_MS),
      tighten: false,
      prepare: true,
    }
  }
  return {
    delayMs: Math.max(0, Math.min(ARM_TICK_MS, remaining)),
    tighten: true,
    prepare: true,
  }
}
