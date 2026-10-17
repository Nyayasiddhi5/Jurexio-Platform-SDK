/**
 * Stub for the legacy `OrchestrationFacade` class.
 *
 * Background: Task #104 (commit 1e9da64) archived the original
 * `jrx-orchestration-facade.ts` along with the V9 dead-stubs cleanup, but
 * the read-only metadata router at `src/routes/nv5/internal/index.ts`
 * still imports `OrchestrationFacade` (only as a `void` reference for
 * BFS-auditor visibility + a `service: './jrx-orchestration-facade'` JSON
 * literal — see comment at line 632 of `src/index.ts` flagging this as
 * a deferred orphan). After the rebase that brought Task #104 onto the
 * Task #114 branch, the dangling import broke gateway boot.
 *
 * This stub restores the missing export with a minimal no-op class so
 * the static ESM import resolves. It deliberately exposes NO methods —
 * any call into it will throw, surfacing the real follow-up work
 * (NV-FOLLOWUP-ORCHESTRATION-FACADE) instead of silently masking it.
 *
 * NV-LLM-001: stub class never emits LLM traffic. The real
 * orchestration entry point is `JurexioOrchestrationCoreV9` in
 * `src/orchestration/jurexio-orchestration-core-v9.ts`.
 */
export class OrchestrationFacade {
  constructor() {
    // No-op. Construction is permitted so the metadata route can describe
    // the symbol; any attempt to actually use it should reach for the
    // canonical V9 core instead.
  }

  static readonly __isStub = true;
}

export default OrchestrationFacade;
