import { describe, expect, it } from 'vitest';
import { mapAguiEventToTimeline } from '../../client/src/services/jrx-admin-agui-map.ts';

describe('./jrx-admin-agui-map (Console adapter, partner APIs untouched)', () => {
  it('maps run_started → request_received', () => {
    const e = mapAguiEventToTimeline(
      { type: 'run_started', pattern: 'P11', jurisdiction: 'IN', orchestrationId: 'o1' },
      'fallback',
    );
    expect(e?.step).toBe('request_received');
    expect(e?.data?.jurisdiction).toBe('IN');
    expect(e?.orchestrationId).toBe('o1');
  });

  it('maps timeline_step directly with durationMs', () => {
    const e = mapAguiEventToTimeline(
      {
        type: 'timeline_step',
        orchestrationId: 'o2',
        step: 'rag_retrieval',
        status: 'ok',
        ts: 1000,
        durationMs: 1252,
        data: { chunks: 6 },
      },
      'fb',
    );
    expect(e?.step).toBe('rag_retrieval');
    expect(e?.durationMs).toBe(1252);
    expect(e?.data?.chunks).toBe(6);
  });

  it('maps queen_decomposition via subtype → agent_selection', () => {
    const e = mapAguiEventToTimeline(
      {
        type: 'pattern_event',
        subtype: 'queen_decomposition',
        data: { algorithm: 'ADaPT', pattern: 'parallel', subtaskCount: 2, subtasks: [{ id: 't1' }] },
      },
      'fb',
    );
    expect(e?.step).toBe('agent_selection');
    expect(e?.data?.algorithm).toBe('ADaPT');
    expect(e?.data?.tasks).toBe(2);
  });

  it('maps synthesis_started subtype → llm_stream_started', () => {
    const e = mapAguiEventToTimeline(
      { type: 'pattern_event', subtype: 'synthesis_started', data: { agentCount: 3 } },
      'fb',
    );
    expect(e?.step).toBe('llm_stream_started');
    expect(e?.data?.agentCount).toBe(3);
  });

  it('maps tool_call agent:* → prompt_compiled', () => {
    const e = mapAguiEventToTimeline(
      { type: 'tool_call', tool: 'agent:StatuteAnalyst', data: { agentId: 'a1', subtaskId: 's1' } },
      'fb',
    );
    expect(e?.step).toBe('prompt_compiled');
    expect(e?.data?.agentName).toBe('StatuteAnalyst');
    expect(e?.data?.taskId).toBe('s1');
  });

  it('maps run_completed → run_complete with answer', () => {
    const e = mapAguiEventToTimeline(
      { type: 'run_completed', answer: 'Section 103…', model: 'claude' },
      'fb',
    );
    expect(e?.step).toBe('run_complete');
    expect(e?.data?.response).toBe('Section 103…');
  });

  it('maps synthesis_final subtype → llm_stream_completed with response', () => {
    const e = mapAguiEventToTimeline(
      {
        type: 'pattern_event',
        subtype: 'synthesis_final',
        data: { content: 'Final gated answer…', length: 21, gated: true },
      },
      'fb',
    );
    expect(e?.step).toBe('llm_stream_completed');
    expect(e?.data?.response).toBe('Final gated answer…');
    expect(e?.data?.source).toBe('synthesis_final');
  });

  it('maps text_delta accumulated tokens for outcome assembly', () => {
    const e = mapAguiEventToTimeline(
      { type: 'text_delta', delta: 'more', accumulated: 'hello more' },
      'fb',
    );
    expect(e?.step).toBe('llm_stream_token');
    expect(e?.data?.accumulated).toBe('hello more');
  });

  it('ignores empty text_delta frames', () => {
    expect(mapAguiEventToTimeline({ type: 'text_delta' }, 'fb')).toBeNull();
  });
});
