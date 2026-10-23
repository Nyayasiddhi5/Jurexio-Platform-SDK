/**
 * Type-level test for Queen lifecycle event contracts.
 *
 * JRX-ORCH-EVENT-CORRELATION-002 (Task #37): the Queen orchestrator stamps
 * `orchestrationId` on every lifecycle event so AG-UI listeners on the shared
 * global EventEmitter forward only their own run's events. Without that field,
 * concurrent /api/jrx/stream requests cross-receive each other's payloads and
 * leak data between users.
 *
 * This file is type-checked by `tsc --noEmit` (it lives under `src/` and is
 * NOT excluded by tsconfig). It contains `// @ts-expect-error` markers that
 * fail compilation if the lifecycle event contract is ever weakened — e.g. if
 * `orchestrationId` becomes optional, if a payload field is renamed, or if a
 * future emit loses its type narrowing. There is no runtime behaviour: this
 * file only declares assignments to assert shapes.
 */
import type {
  QueenLifecycleEventMap,
  QueenDecompositionCompleteEvent,
  QueenAgentStartedEvent,
  QueenAgentCompletedEvent,
  QueenAgentFailedEvent,
  QueenSynthesisStartedEvent,
  QueenSynthesisCompleteEvent,
  QueenLifecycleEmitter,
} from './jrx-queen-orchestrator.js';

// ============================================================================
// 1. Each lifecycle event REQUIRES `orchestrationId: string`.
// ============================================================================

// Well-formed payloads compile.
const _goodDecomp: QueenDecompositionCompleteEvent = {
  orchestrationId: 'orch-1',
  algorithm: 'HTA',
  pattern: 'sequential',
  complexity: 'simple',
  subtaskCount: 0,
  subtasks: [],
};
const _goodAgentStarted: QueenAgentStartedEvent = {
  orchestrationId: 'orch-1',
  subtaskId: 's1',
  subtaskType: 'analysis',
  agentId: 'a1',
  agentName: 'Alpha',
  description: 'd',
};
const _goodAgentCompleted: QueenAgentCompletedEvent = {
  orchestrationId: 'orch-1',
  subtaskId: 's1',
  agentId: 'a1',
  agentName: 'Alpha',
  durationMs: 100,
  outputPreview: 'preview',
  outputLength: 7,
  via: 'llm',
};
const _goodAgentFailed: QueenAgentFailedEvent = {
  orchestrationId: 'orch-1',
  subtaskId: 's1',
  agentId: 'a1',
  agentName: 'Alpha',
  error: 'boom',
  durationMs: 50,
};
const _goodSynthStarted: QueenSynthesisStartedEvent = {
  orchestrationId: 'orch-1',
  agentCount: 1,
  failedCount: 0,
  format: 'markdown',
  language: 'en',
};
const _goodSynthComplete: QueenSynthesisCompleteEvent = {
  orchestrationId: 'orch-1',
  length: 100,
  format: 'markdown',
  language: 'en',
};

// Payloads missing `orchestrationId` MUST NOT compile.
// @ts-expect-error - missing required orchestrationId
const _badDecomp: QueenDecompositionCompleteEvent = {
  algorithm: 'HTA',
  pattern: 'sequential',
  complexity: 'simple',
  subtaskCount: 0,
  subtasks: [],
};
// @ts-expect-error - missing required orchestrationId
const _badAgentStarted: QueenAgentStartedEvent = {
  subtaskId: 's1',
  subtaskType: 'analysis',
  agentId: 'a1',
  agentName: 'Alpha',
  description: 'd',
};
// @ts-expect-error - missing required orchestrationId
const _badAgentCompleted: QueenAgentCompletedEvent = {
  subtaskId: 's1',
  agentId: 'a1',
  agentName: 'Alpha',
  durationMs: 100,
  outputPreview: 'preview',
  outputLength: 7,
  via: 'llm',
};
// @ts-expect-error - missing required orchestrationId
const _badAgentFailed: QueenAgentFailedEvent = {
  subtaskId: 's1',
  agentId: 'a1',
  agentName: 'Alpha',
  error: 'boom',
  durationMs: 50,
};
// @ts-expect-error - missing required orchestrationId
const _badSynthStarted: QueenSynthesisStartedEvent = {
  agentCount: 1,
  failedCount: 0,
  format: 'markdown',
  language: 'en',
};
// @ts-expect-error - missing required orchestrationId
const _badSynthComplete: QueenSynthesisCompleteEvent = {
  length: 100,
  format: 'markdown',
  language: 'en',
};

// `orchestrationId` must be a string, not undefined or some other type.
// (Single-line forms so each `@ts-expect-error` marker attaches to the
// correct following line.)
// prettier-ignore
const _undefinedId: QueenAgentStartedEvent = { orchestrationId: undefined, subtaskId: 's1', subtaskType: 'analysis', agentId: 'a1', agentName: 'Alpha', description: 'd' };
// prettier-ignore
// @ts-expect-error - orchestrationId must be string, not number
const _numericId: QueenAgentStartedEvent = { orchestrationId: 123, subtaskId: 's1', subtaskType: 'analysis', agentId: 'a1', agentName: 'Alpha', description: 'd' };

// ============================================================================
// 2. The lifecycle map covers exactly the 6 known events.
// ============================================================================
type _ExpectedKeys =
  | 'decomposition_complete'
  | 'agent_started'
  | 'agent_completed'
  | 'agent_failed'
  | 'synthesis_started'
  | 'synthesis_token'
  | 'synthesis_final'
  | 'synthesis_complete';

// Bidirectional assignability proves the key sets match exactly.
type _AssertKeysMatch1 = _ExpectedKeys extends keyof QueenLifecycleEventMap ? true : never;
type _AssertKeysMatch2 = keyof QueenLifecycleEventMap extends _ExpectedKeys ? true : never;
const _keyMatch1: _AssertKeysMatch1 = true;
const _keyMatch2: _AssertKeysMatch2 = true;

// ============================================================================
// 3. The per-request `QueenLifecycleEmitter` enforces event-name + payload-
//    shape coupling for both `on(...)` listeners and `emit(...)` calls.
//    (Task #64 — the previous singleton-bound `onLifecycle` API was removed
//    in favour of per-request emitters.)
// ============================================================================
declare const _emitter: QueenLifecycleEmitter;

// Correct pairing compiles and the listener payload is narrowed.
_emitter.on('agent_started', (p) => {
  const _id: string = p.orchestrationId;
  const _name: string = p.agentName;
  void _id;
  void _name;
});

// Wrong listener shape (claims the wrong event's payload) does not compile.
_emitter.on(
  'agent_started',
  // @ts-expect-error - listener typed for the wrong event's payload
  (p: QueenSynthesisCompleteEvent) => {
    void p.length;
  },
);

// Unknown event name does not compile.
_emitter.on(
  // @ts-expect-error - 'not_a_lifecycle_event' is not a key of QueenLifecycleEventMap
  'not_a_lifecycle_event',
  () => undefined,
);

// `emit(...)` is also typed: a payload missing required fields fails.
// @ts-expect-error - emit payload missing required orchestrationId
_emitter.emit('agent_started', {
  subtaskId: 's1',
  subtaskType: 'analysis',
  agentId: 'a1',
  agentName: 'Alpha',
  description: 'd',
});

// And a payload bound to the wrong event also fails.
_emitter.emit(
  'agent_started',
  // @ts-expect-error - synthesis payload assigned to agent_started key
  { orchestrationId: 'o', length: 1, format: 'markdown', language: 'en' },
);
