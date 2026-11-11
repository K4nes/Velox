// Every batch run reports the same way: a step list that grows in place, an outcome that
// pairs that list with the one error that stopped it, and a failure count the surfaces
// phrase the same way. Naming the shape once stops a new run kind from inventing its own.

export type RunStep = { readonly id: string; readonly status: string }

export type RunProgress<S extends RunStep> = { readonly steps: readonly S[] }

export type RunOutcome<P> = { readonly progress: P; readonly error: string | null }

export function countFailed(steps: readonly RunStep[]): number {
  let total = 0
  for (const step of steps) {
    if (step.status === 'failed') total += 1
  }
  return total
}

// One sentence for every surface that has to tell the operator how many broke, so the
// wording cannot drift between the scans and the runs. `first` carries the first
// failure's message when the surface has room for it.
export function failureLine(
  failed: number,
  total: number,
  noun: string,
  first: string | null = null
): string {
  const line = `${failed} of ${total} ${noun} failed`
  return first === null || first === '' ? line : `${line} — ${first}`
}
