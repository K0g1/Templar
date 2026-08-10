/**
 * Runs a fire-and-forget async operation with a guaranteed rejection
 * boundary. Event handlers and command callbacks frequently invoke style
 * mutations with `void`; without a boundary a rejected promise becomes an
 * unhandled rejection and the UI refresh that would surface the error never
 * runs.
 *
 * The callback receives a small reporter so handlers can perform partial
 * cleanup or status updates before the error is surfaced.
 */
export async function runTask(
  operation: () => Promise<void>,
  context: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    console.error(`[Templar] ${context} failed:`, error);
  }
}
