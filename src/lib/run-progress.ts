// Every run module publishes a progress record as `{ steps }` and moves it
// forward one step at a time, so the record can grow a field without a commit
// erasing it.
export type RunSteps<S> = { steps: readonly S[] }

export function stepById<S extends { id: string }>(
  progress: RunSteps<S>,
  id: string
): S | null {
  return progress.steps.find((step) => step.id === id) ?? null
}

export function withStep<
  P extends RunSteps<{ id: string }>,
  S extends P['steps'][number],
>(progress: P, step: S): P {
  const steps = progress.steps.map((current) =>
    current.id === step.id ? step : current
  )
  return { ...progress, steps }
}
