export const NV_AGENT_CAPABILITY_BINDINGS_V510 = {
  'A-029': ['conflict-detector', 'jurisdiction-conflict-analysis'],
  'A-057': ['treaty-rag', 'cross-jurisdiction-research'],
  'A-064': ['regulatory-monitor', 'regulatory-update-monitor'],
  'A-127': ['multilingual', 'cross-language-communication'],
  'A-134': ['hitl-workflow', 'escalation-orchestration'],
} as const;

export type NvAgentCapabilityBindingId = keyof typeof NV_AGENT_CAPABILITY_BINDINGS_V510;

export function getBoundCapabilitiesForAgent(agentId: string): string[] {
  return [...(NV_AGENT_CAPABILITY_BINDINGS_V510[agentId as NvAgentCapabilityBindingId] || [])];
}
