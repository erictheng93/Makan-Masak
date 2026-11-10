// Runs best-effort work after the response when the runtime provides
// waitUntil; unit tests and local fallbacks have no ExecutionContext.
export function deferAfterResponse(c: {
  executionCtx: Pick<ExecutionContext, "waitUntil">;
}) {
  try {
    const ctx = c.executionCtx;
    return (work: Promise<unknown>) => ctx.waitUntil(work);
  } catch {
    return undefined;
  }
}
