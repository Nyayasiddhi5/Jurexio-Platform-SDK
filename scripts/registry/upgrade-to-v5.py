#!/usr/bin/env python3
"""
upgrade-to-v5.py — Nyayavigya Registry v3 → v5.0.0 Transformer

Converts current v3-full-23section registries to v5.0.0 spec:
  - Renumbers sections to §0 + §1-§22 (Option B)
  - Prepends §0 Security Constitution (single flavor for entire ecosystem)
  - Adds 20 new top-level per-agent fields
  - Adds 18 new top-level registry blocks
  - Refreshes models to v5.0.0 catalog (latest as of May 1, 2026)
  - Preserves Queen agent (ns-queen) per-jurisdiction

Usage:
  python3 upgrade-to-v5.py --jurisdiction IN [--apply]
  python3 upgrade-to-v5.py --all-jurisdictions --apply

Without --apply: writes to .v5-staged/ for review.
With --apply: replaces production registry file (backup must exist).
"""

import json
import os
import sys
import re
import argparse
import shutil
from datetime import datetime
from copy import deepcopy

REGISTRY_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'config', 'agent-registries')
SPEC_PATH = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'attached_assets',
                          'nyayavigya-registry-v5.0.0_1777964709264.json')
STAGED_DIR = os.path.join(REGISTRY_DIR, '.v5-staged')
BACKUP_DIR = os.path.join(REGISTRY_DIR, '.archive-v3-pre-v5-upgrade')

# Jurisdiction code mapping (filename suffix → JCN code, deployment region)
JURISDICTION_MAP = {
    'IN': {'jcn': 'JCN-IN', 'region': 'ap-south-1', 'name': 'India',
           'fullName': 'Republic of India', 'slm': 'NS-SLM-IND',
           'voiceEngine': 'sarvam-m', 'currency': 'INR', 'languages': 41},
    'UK': {'jcn': 'JCN-UK', 'region': 'eu-west-2', 'name': 'United Kingdom',
           'fullName': 'United Kingdom of Great Britain and Northern Ireland',
           'slm': 'NS-SLM-UK', 'voiceEngine': 'azure-neural', 'currency': 'GBP', 'languages': 6},
    'US': {'jcn': 'JCN-US', 'region': 'us-east-1', 'name': 'United States',
           'fullName': 'United States of America', 'slm': 'NS-SLM-USA',
           'voiceEngine': 'azure-neural', 'currency': 'USD', 'languages': 8},
    'GC': {'jcn': 'JCN-GCC', 'region': 'me-south-1', 'name': 'GCC',
           'fullName': 'Gulf Cooperation Council', 'slm': 'NS-SLM-GCC',
           'voiceEngine': 'azure-neural', 'currency': 'AED', 'languages': 4},
    'EU': {'jcn': 'JCN-EU', 'region': 'eu-central-1', 'name': 'European Union',
           'fullName': 'European Union (27 Member States)', 'slm': 'NS-SLM-EUR',
           'voiceEngine': 'azure-neural', 'currency': 'EUR', 'languages': 24},
    'SG': {'jcn': 'JCN-SG', 'region': 'ap-southeast-1', 'name': 'Singapore',
           'fullName': 'Republic of Singapore', 'slm': 'NS-SLM-SGP',
           'voiceEngine': 'azure-neural', 'currency': 'SGD', 'languages': 4},
    'Default': {'jcn': 'DEFAULT', 'region': 'ap-south-1', 'name': 'Multi-jurisdiction',
                'fullName': 'Default (multi-jurisdiction overlay)',
                'slm': 'NS-SLM-IND', 'voiceEngine': 'sarvam-m', 'currency': 'USD', 'languages': 41},
}

# v5.0.0 model catalog — preserve v3 identifiers (already in lockdown allow-list at
# src/config/nyv-allowed-providers.ts). Empty map = identity transform on
# preferredModels/fallbackModels. The v5 spec source file (May 2026) embeds older
# names in §14/§22 prose — those are normalised via STALE_MODEL_REPLACEMENTS_PY
# below before write, so the lint stale-model rule passes.
V5_MODEL_CATALOG_REFRESH = {}

# Mirror of scripts/lib/agent-model-tiers.ts STALE_MODEL_REPLACEMENTS — keep in sync.
# Applied to every <section_*> body in the assembled v5 systemPrompt so the lint
# stale-model rule (which only scans inside <section_*> tags) passes.
STALE_MODEL_REPLACEMENTS_PY = [
    (re.compile(r'\bclaude-sonnet-4(?!-)'), 'claude-sonnet-4-6'),
    (re.compile(r'\bclaude-sonnet-4-5\b'), 'claude-sonnet-4-6'),
    (re.compile(r'\bclaude-haiku-3\.5\b'), 'claude-haiku-4-5'),
    (re.compile(r'\bclaude-3-5-sonnet(?:-v2)?\b'), 'claude-sonnet-4-6'),
    (re.compile(r'\bgemini-2\.5-pro\b'), 'gemini-3.1-pro-preview'),
    (re.compile(r'\bgemini-2-5-pro\b'), 'gemini-3-pro-preview'),
    (re.compile(r'\bgemini-2-5-flash\b'), 'gemini-3-flash-preview'),
    (re.compile(r'\bgemini-1\.5-pro\b'), 'gemini-3-pro-preview'),
    (re.compile(r'\bdeepseek-r1\b'), 'qwen/qwen3-235b-instruct:free'),
    (re.compile(r'\bgpt-5\.2\b'), 'gpt-4.1'),
]


def apply_stale_model_replacements(prompt):
    """Normalise stale model names inside every <section_*> body of the systemPrompt.

    Mirrors lint Rule 2 in scripts/nv-registry-lint.ts which scans only inside
    <section_*>...</section_*> XML blocks (free-text/audit prose outside is exempt).
    """
    if not isinstance(prompt, str) or not prompt:
        return prompt
    section_re = re.compile(r'<(section_[^>\s]+)>([\s\S]*?)</\1>')

    def _rewrite(m):
        tag, body = m.group(1), m.group(2)
        for pat, repl in STALE_MODEL_REPLACEMENTS_PY:
            body = pat.sub(repl, body)
        return f'<{tag}>{body}</{tag}>'

    return section_re.sub(_rewrite, prompt)


def load_v5_spec():
    """Load attached v5.0.0 reference registry as the canonical source."""
    with open(SPEC_PATH) as f:
        return json.load(f)


def build_spec_agent_index(spec):
    """Index v5 spec agents by their canonical id."""
    return {a['id']: a for a in spec['agents']}


def refresh_models(model_list):
    """Update model identifiers to v5.0.0 catalog (latest May 1, 2026)."""
    if not isinstance(model_list, list):
        return model_list
    return [V5_MODEL_CATALOG_REFRESH.get(m, m) for m in model_list]


def derive_role(v3_agent):
    """Compute v5 'role' field from v3 tier/category."""
    tier = v3_agent.get('tier', '').lower()
    aid = v3_agent.get('id', '').lower()
    if 'queen' in aid or 'orchestrator' in aid:
        return 'Director'
    if tier == 'executive':
        return 'Director'
    if 'engine' in aid or 'router' in aid:
        return 'Engine'
    return 'Specialist'


def derive_failure_mode(practice_area):
    """Per-PA failure-mode strategy."""
    pa_failure_modes = {
        'Criminal Law': 'fail-secure-escalate-to-criminal-bench',
        'Family Law': 'fail-secure-escalate-to-family-counsellor',
        'Cyber Law': 'fail-secure-isolate-and-audit',
        'Compliance & Regulatory': 'fail-secure-escalate-to-compliance-officer',
        'Litigation': 'fail-secure-escalate-to-senior-counsel',
        'Tax Law': 'fail-soft-fallback-to-rule-engine',
        'Corporate & M&A': 'fail-soft-fallback-to-template-engine',
        'Legal Leadership': 'fail-secure-escalate-to-board',
    }
    return pa_failure_modes.get(practice_area, 'fail-soft-fallback-to-AgentZero')


def derive_confidence_thresholds(v3_agent):
    """Per-PA HITL confidence thresholds (CTO note locked values)."""
    pa = v3_agent.get('practiceArea', '')
    pa_thresholds = {
        'Criminal Law': {'deliver': 0.85, 'hitl': 0.82, 'refuse': 0.55},
        'Family Law': {'deliver': 0.85, 'hitl': 0.82, 'refuse': 0.55},
        'Compliance & Regulatory': {'deliver': 0.83, 'hitl': 0.80, 'refuse': 0.50},
        'Cyber Law': {'deliver': 0.83, 'hitl': 0.80, 'refuse': 0.50},
        'Litigation': {'deliver': 0.81, 'hitl': 0.78, 'refuse': 0.50},
    }
    return pa_thresholds.get(pa, {'deliver': 0.78, 'hitl': 0.75, 'refuse': 0.50})


def derive_hitl_config(v3_agent):
    """Build hitlConfig block."""
    hil = v3_agent.get('operationModes', {}).get('humanInLoop', True)
    return {
        'enabled': bool(hil),
        'threshold': derive_confidence_thresholds(v3_agent)['hitl'],
        'riskClassification': {
            'HIGH': 'Legal output with court/regulatory filing intent → mandatory human approval',
            'MEDIUM': 'Strategic legal opinions → supervisor review',
            'LOW': 'Research, calculations, parsing → autonomous execution',
        },
        'autoApproveBelow': derive_confidence_thresholds(v3_agent)['hitl'],
        'reviewerRouting': 'agent.escalationPath → first available org reviewer → HITL_OPERATOR queue',
    }


def derive_iron_ledger_events():
    """Standard IronLedger event schema (constant across all agents)."""
    return {
        'onExecution': ['agent_id', 'matter_id', 'user_id', 'org_id', 'input_hash',
                        'output_hash', 'confidence_score', 'model_used', 'pattern_used',
                        'timestamp', 'hitl_triggered', 'jurisdiction', 'base_tokens',
                        'delta_tokens', 'cost_usd'],
        'onHITL': ['agent_id', 'matter_id', 'reviewer_id', 'decision', 'rationale',
                   'override_reason', 'timestamp', 'auto_approved', 'confidence_score'],
        'onFailure': ['agent_id', 'matter_id', 'failure_type', 'error_code',
                     'circuit_breaker_state', 'fallback_used', 'timestamp'],
        'onGRPOFeedback': ['agent_id', 'matter_id', 'reward_signal', 'human_correction',
                          'gradient_id', 'jcn_slm_target', 'timestamp'],
    }


def derive_governed_execution(v3_agent, jurisdiction_code):
    """v5 governedExecution block per agent."""
    aid = v3_agent.get('id', '').lower()
    if 'queen' in aid:
        layer = 'L1-GlobalGovernanceOrchestrator'
    elif 'jcn' in aid or v3_agent.get('practiceAreaId') in (28, 29):
        layer = 'L2-JurisdictionControlNode'
    else:
        layer = 'L3-DomainAgent'
    js = v3_agent.get('jurisdictionScope', {})
    restricted = not js.get('crossBorderEnabled', True)
    return {
        'architectureLayer': layer,
        'jurisdictionAware': layer in ('L1-GlobalGovernanceOrchestrator', 'L2-JurisdictionControlNode'),
        'jurisdictionInjectedByJCN': layer == 'L3-DomainAgent',
        'allowedJurisdictions': [jurisdiction_code] if restricted else ['ALL'],
        'jurisdictionRestricted': restricted,
        'requiresJurisdictionOverlay': layer == 'L3-DomainAgent',
        'policyGatesApplied': True,
        'inputContractRequired': True,
        'agentCustomisable': layer == 'L3-DomainAgent',
        'reportsTo': v3_agent.get('reportsTo', []),
        'manages': v3_agent.get('manages', []),
        'collaboratesWith': v3_agent.get('collaboratesWith', []),
    }


# v5 section number → XML tag name (v5 semantics; preserves v3 tag names where compatible)
V5_SECTION_XML_TAGS = {
    0:  'section_0_security_constitution',
    1:  'section_1_identity',          # v3 lint Rule 5 compat — semantically same in v5
    2:  'section_2_core_mandate',
    3:  'section_3_jurisdiction',
    4:  'section_4_reasoning',
    5:  'section_5_evidence',
    6:  'section_6_citation',          # v5 moved citation from §10 to §6
    7:  'section_7_language',
    8:  'section_8_anti_hallucination',
    9:  'section_9_bias_avoidance',
    10: 'section_10_pii',              # v5 §10 = PII Protocol (v3 had this at §23)
    11: 'section_11_confidentiality',
    12: 'section_12_disclaimer',
    13: 'section_13_escalation',
    14: 'section_14_cost',
    15: 'section_15_memory',
    16: 'section_16_tools',
    17: 'section_17_output',
    18: 'section_18_quality_checklist',
    19: 'section_19_grpo',
    20: 'section_20_handoff',  # avoid digits in topic name (resolver regex compat)
    21: 'section_21_audit',
    22: 'section_22_version_slm',
}

# Default §0 body (cached on first use)
_DEFAULT_S0 = None


def get_default_s0(spec):
    global _DEFAULT_S0
    if _DEFAULT_S0 is None:
        sample = spec['agents'][0]['systemPrompt']
        m = re.search(r'(§0 SECURITY CONSTITUTION.*?)(?=\n§1\s)', sample, re.DOTALL)
        _DEFAULT_S0 = m.group(1).rstrip() if m else ''
    return _DEFAULT_S0


def split_v5_sections(prompt):
    """Split a v5 plaintext systemPrompt (with §N markers) into a dict of section bodies."""
    positions = []
    seen = set()
    for m in re.finditer(r'§(\d+)\s', prompt):
        n = int(m.group(1))
        if n > 22 or n in seen:
            continue
        seen.add(n)
        positions.append((m.start(), n))
    positions.sort()
    sections = {}
    for i, (pos, n) in enumerate(positions):
        end = positions[i + 1][0] if i + 1 < len(positions) else len(prompt)
        sections[n] = prompt[pos:end].rstrip()
    return sections


def extract_v3_subblock(v3_prompt, tag_name):
    """Pull a named XML sub-block out of a v3 prompt (e.g. role_narrative, jurisdictional_case_authorities)."""
    if not v3_prompt:
        return None
    m = re.search(rf'<{tag_name}[^>]*>([\s\S]*?)</{tag_name}>', v3_prompt)
    if not m:
        return None
    # Return entire block including its tags (verbatim)
    return v3_prompt[m.start():m.end()]


def build_jurisdiction_aware_prompt(spec_prompt, v3_agent, jurisdiction_code, spec):
    """Take v5 spec systemPrompt and emit a v5-compliant XML-wrapped prompt.

    Structure: 23 XML <section_N_v5topic>...content with §N marker...</section_N_v5topic>
    Carries forward v3 sub-blocks: <role_narrative> into §1, <jurisdictional_case_authorities> into §6.
    """
    juris = JURISDICTION_MAP.get(jurisdiction_code, JURISDICTION_MAP['Default'])

    # Customise jurisdiction-specific bits in plaintext first
    prompt = spec_prompt
    orig_id = v3_agent.get('originalAgentId', '')
    new_id = v3_agent.get('id', '')
    if orig_id and new_id and orig_id != new_id:
        prompt = prompt.replace(f'ID: {orig_id}', f'ID: {new_id}')
    prompt = prompt.replace(
        'Jurisdiction Scope: Active in all deployed jurisdictions',
        f'Jurisdiction Scope: {juris["fullName"]} ({juris["jcn"]}) — primary; cross-border via JCN overlay'
    )
    prompt = re.sub(r'JCN SLM Binding: NS-SLM-\w+', f'JCN SLM Binding: {juris["slm"]}', prompt)
    prompt = re.sub(r'Voice Engine: \S+', f'Voice Engine: {juris["voiceEngine"]}', prompt)
    prompt = re.sub(r'Data Residency: \S+', f'Data Residency: {juris["region"]}', prompt)

    # Split v5 plaintext into sections
    sections = split_v5_sections(prompt)

    # Pull v3 sub-blocks
    v3_prompt = v3_agent.get('systemPrompt', '')
    role_narrative = extract_v3_subblock(v3_prompt, 'role_narrative')
    case_authorities = extract_v3_subblock(v3_prompt, 'jurisdictional_case_authorities')

    # Fallback role_narrative if v3 missing
    if not role_narrative:
        nm = v3_agent.get('name', new_id)
        role_narrative = (f'<role_narrative>\n  You are the {nm}, a specialised legal AI agent '
                          f'in the Nyayavigya Legal AI ecosystem operating under {juris["jcn"]}. '
                          f'You operate at ROMA L5 and follow the §0 Security Constitution absolutely.\n</role_narrative>')

    if not case_authorities:
        pa = v3_agent.get('practiceArea', 'General Legal')
        case_authorities = (f'<jurisdictional_case_authorities jurisdiction="{jurisdiction_code}" practice_area="{pa}">\n'
                            f'  <description>Foundational and practice-specific case-law authorities '
                            f'(May 2026 vintage). Cite explicitly on every legal opinion. Verify pin-cites before output.</description>\n'
                            f'  <cases>\n    <case>Refer to JCN-injected jurisdictional case overlay at runtime</case>\n  </cases>\n'
                            f'</jurisdictional_case_authorities>')

    # Ensure §0 exists (use default Security Constitution if missing)
    if 0 not in sections or not sections[0].strip():
        sections[0] = get_default_s0(spec)

    # Ensure all 23 sections (§0-§22) present — synthesize stubs for any missing
    for n in range(0, 23):
        if n not in sections or not sections.get(n, '').strip():
            tag_topic = V5_SECTION_XML_TAGS[n].split('_', 2)[2].replace('_', ' ').upper()
            sections[n] = f'§{n} {tag_topic}\n\n[Inherited from basePrompt and §0 Security Constitution.]'

    # Inject sub-blocks
    sections[1] = sections[1] + '\n\n' + role_narrative
    sections[6] = sections[6] + '\n\n' + case_authorities

    # Assemble: 23 XML-wrapped sections in §0..§22 order
    parts = []
    for n in range(0, 23):
        tag = V5_SECTION_XML_TAGS[n]
        parts.append(f'<{tag}>\n{sections[n]}\n</{tag}>')
    return '\n\n'.join(parts)


def build_queen_prompt(jurisdiction_code, spec):
    """Build Queen (ns-queen) systemPrompt — special L1 agent. Returns XML-wrapped 23-section prompt."""
    juris = JURISDICTION_MAP.get(jurisdiction_code, JURISDICTION_MAP['Default'])
    s0 = get_default_s0(spec)

    queen_sections = {
        0: s0,
        1: f"""§1 ROLE IDENTITY

Agent: Nyayavigya Queen ({juris['name']}) | ID: ns-queen
Practice Area: Global Governance Orchestration | Role: Director
Architecture Layer: L1 — Global Governance Orchestrator (GGO)
ROMA Level: L5 — Sovereign Adaptive Governance
Tier Access: platform-internal | Swarm Role: orchestrator
Jurisdiction Scope: {juris['fullName']} ({juris['jcn']}) — global routing authority
Supported Patterns: P1 (ROUTER), P22 (ADVISOR)
Reports To: platform-operator
Manages: All 148 ROMA L5 domain agents
Voice Enabled: No (orchestration only) | Digital Twin: No

<role_narrative>
  You are the Nyayavigya Queen for {juris['fullName']} ({juris['jcn']}), the L1 Global Governance Orchestrator. You ROUTE requests to JCNs and domain agents — you NEVER perform legal reasoning, draft documents, or call LLMs directly. You enforce tenant isolation, jurisdiction routing, and global audit chain integrity. The §0 Security Constitution is absolute.
</role_narrative>""",
        2: """§2 CORE MANDATE

Primary Objective: Route every request to the correct JCN, enforce global compliance, maintain global audit chain, enforce tenant isolation. NEVER does legal reasoning, document drafting, or LLM calls directly.

Required Input Contract (mandatory; reject if missing):
- tenant_id, jurisdiction, matter_id, user_role, intent_type, subscription_tier""",
        3: f"""§3 JURISDICTION RULES

Routes to: JCN-IN, JCN-UK, JCN-US, JCN-GCC, JCN-EU, JCN-SG. Active routing target: {juris['jcn']}.""",
        4: """§4 REASONING PROTOCOL

Routing Logic Only — no reasoning. Route → JCN; JCN routes → Domain Agent.""",
        5: "§5 EVIDENCE STANDARDS\n\nNot applicable to L1 (no evidence handling).",
        6: f"""§6 CITATION FORMAT

Not applicable to L1 (no citations).

<jurisdictional_case_authorities jurisdiction="{jurisdiction_code}" practice_area="Global Governance Orchestration">
  <description>Queen agent does not cite case authorities — it routes to domain agents which carry their own.</description>
  <cases><case>N/A — orchestration layer</case></cases>
</jurisdictional_case_authorities>""",
        7: f"§7 LANGUAGE POLICY\n\nRouting accepts all {juris['languages']} supported languages. Forwards detected language to JCN.",
        8: "§8 ANTI-HALLUCINATION PROTOCOL\n\nInherited from §0 + basePrompt.",
        9: "§9 BIAS AVOIDANCE PROTOCOL\n\nInherited from §0 + basePrompt.",
        10: "§10 PII PROTOCOL\n\nInherited from §0 + basePrompt.",
        11: "§11 CONFIDENTIALITY PROTOCOL\n\nInherited from §0 + basePrompt.",
        12: "§12 DISCLAIMER PROTOCOL\n\nInherited from §0 + basePrompt.",
        13: "§13 ESCALATION RULES\n\nRoute to platform-operator on policy gate failure.",
        14: "§14 COST AWARENESS\n\nRouting has near-zero LLM cost (no LLM calls).",
        15: "§15 MEMORY INTEGRATION\n\nMaintains global audit chain only.",
        16: "§16 TOOL USAGE\n\nJCN routing tool, audit chain tool only.",
        17: "§17 OUTPUT FORMAT\n\nRouting decision JSON envelope.",
        18: "§18 QUALITY CHECKLIST\n\nInherited from basePrompt.",
        19: "§19 GRPO FEEDBACK\n\nInherited from basePrompt.",
        20: "§20 A2A HANDOFF PROTOCOL\n\nAuthoritative routing source for all A2A messages.",
        21: "§21 AUDIT TRAIL\n\nInherited from basePrompt.",
        22: f"""§22 VERSION AND SLM BINDING

System Prompt Version: 5.0.0
JCN SLM Binding: {juris['slm']}
Voice Engine: {juris['voiceEngine']}
Data Residency: {juris['region']}
Platform Identity: Nyayavigya SDK v5.0.0 — Backed by Nyayasiddhi™ — Justice. Powered by Precision.
© 2026 Nyayasiddhi Legaltech LLP | nyayasiddhi.ai""",
    }

    parts = []
    for n in range(0, 23):
        tag = V5_SECTION_XML_TAGS[n]
        parts.append(f'<{tag}>\n{queen_sections[n]}\n</{tag}>')
    return '\n\n'.join(parts)


# (legacy _unused_old_queen_block removed — superseded by XML-wrapped queen_sections above)


def upgrade_agent(v3_agent, spec_index, jurisdiction_code, spec):
    """Transform a single v3 agent to v5.0.0 schema."""
    out = deepcopy(v3_agent)
    orig_id = v3_agent.get('originalAgentId', '')
    spec_agent = spec_index.get(orig_id)

    # Bump per-agent version
    out['version'] = '5.0.0'
    out['sdkVersion'] = 'NYV-SDK-v5.0.0'

    # Refresh models to v5.0.0 catalog
    out['preferredModels'] = refresh_models(v3_agent.get('preferredModels', []))
    out['fallbackModels'] = refresh_models(v3_agent.get('fallbackModels', []))

    # Inject systemPrompt — v5.0.0 §0 + §1-§22
    if spec_agent:
        # Use v5 spec's systemPrompt, customised for this jurisdiction
        out['systemPrompt'] = build_jurisdiction_aware_prompt(
            spec_agent['systemPrompt'], v3_agent, jurisdiction_code, spec
        )
    elif 'queen' in v3_agent.get('id', '').lower():
        # Queen agent: build from template
        out['systemPrompt'] = build_queen_prompt(jurisdiction_code, spec)
    # else: keep v3 prompt (orphan agent — should not happen)

    # Normalise stale model identifiers inside <section_*> bodies so the
    # registry-lint stale-model rule passes (May-2026 v5 spec source carries
    # older names like claude-sonnet-4-5/gemini-2-5-pro/deepseek-r1 in §14/§22).
    if isinstance(out.get('systemPrompt'), str):
        out['systemPrompt'] = apply_stale_model_replacements(out['systemPrompt'])

    # ── 20 NEW v5.0.0 TOP-LEVEL FIELDS ─────────────────────────────────────
    out['role'] = derive_role(v3_agent)
    out['failureMode'] = derive_failure_mode(v3_agent.get('practiceArea', ''))
    out['confidenceThresholds'] = derive_confidence_thresholds(v3_agent)
    out['hitlConfig'] = derive_hitl_config(v3_agent)
    out['ironLedgerEvents'] = derive_iron_ledger_events()
    out['governedExecution'] = derive_governed_execution(v3_agent, jurisdiction_code)
    out['jurisdictionActivation'] = {
        'phase1': ['IN'], 'phase2': ['UK', 'GCC'], 'phase3': ['EU', 'SG', 'US']
    }
    out['versionIsolation'] = {'enabled': True, 'currentVersion': '5.0.0',
                                'rollbackEnabled': True, 'archiveLocation': '.archive-v3-pre-v5-upgrade/'}
    out['subscriptionGating'] = {'tierMinimum': v3_agent.get('tier', 'professional'),
                                  'governmentTierEligible': True}
    out['customAgentSupport'] = {'extendable': True, 'overridableSections': [1, 2, 3, 7, 16],
                                  'lockedSections': [0, 8, 9, 10, 11, 12, 18, 19, 21]}
    out['centralisedLearning'] = {
        'jcnSlmTarget': JURISDICTION_MAP[jurisdiction_code]['slm'],
        'gradientSharing': 'federated', 'rawDataSharing': False,
        'humanReviewRequired': True
    }
    out['systemPromptMeta'] = {
        'version': '5.0.0', 'sections': 23, 'basePromptId': 'legal-base-v1',
        'extraSection': '§0 Security Constitution (immutable)',
        'basePromptSections': ['§8', '§9', '§10', '§11', '§12', '§18', '§19', '§21'],
        'roleDeltaSections': ['§1', '§2', '§3', '§4', '§5', '§6', '§7', '§13', '§14',
                              '§15', '§16', '§17', '§20', '§22'],
        'estimatedTokens': 7295, 'basePromptCached': True,
        'immutableSections': ['§0', '§8', '§9', '§10', '§11', '§12', '§18', '§19', '§21'],
        'backedBy': 'Nyayasiddhi™',
        'securityStandard': 'NSS v1.0 — OWASP LLM Top 10 2025 compliant',
        'comprehensiveVersion': True, 'sdkVersion': 'NYV-SDK-v5.0.0'
    }
    out['sdkBranding'] = {
        'sdk': 'NYV-SDK-v5.0.0', 'sdkName': 'Nyayavigya SDK',
        'backedBy': 'Nyayasiddhi™', 'apiBase': '/api/nv/',
        'note': 'The SDK is Nyayavigya. The platform brand is Nyayasiddhi™. Never renamed.'
    }
    out['backedBy'] = 'Nyayasiddhi™'
    out['sdkNamingRule'] = "The SDK is always named 'Nyayavigya SDK' regardless of the product consuming it."

    # Carry over from spec where relevant
    if spec_agent:
        for f in ['agenticPatterns', 'promptArchitecture', 'routingSequence',
                  'agentSkills', 'mcpToolsAllowed', 'outputFormats', 'inputTypes',
                  'swarmRole', 'ragNamespaces', 'memoryConfig', 'performanceTargets',
                  'safetyPipeline', 'enterpriseGuardrails', 'jurisdictionIntelligence',
                  'agentNaming', 'digitalTwinCapable', 'voiceEnabled', 'tierMinimum']:
            if f in spec_agent:
                out[f] = spec_agent[f]

    return out


def build_registry_top_blocks(spec, jurisdiction_code):
    """Build the 18 new top-level registry blocks, jurisdiction-localised."""
    juris = JURISDICTION_MAP[jurisdiction_code]
    blocks = {}
    # Pull these directly from the v5.0.0 spec (jurisdiction-agnostic)
    for k in ['governedExecutionArchitecture', 'customAgentFramework', 'policyEngine',
              'tokenOptimisation', 'centralisedLearning', 'modelCatalog',
              'defaultRoutingSequences', 'agenticPatterns', 'subscriptionTiers',
              'practiceAreas', 'systemPromptStats', 'agentNamingConvention',
              'safetyPipeline', 'ragPipeline', 'memoryConfig', 'voiceConfig',
              'digitalTwinConfig', 'skillsCatalogue', 'mcpToolsCatalogue',
              'performanceBenchmarks', 'apiSurface', 'swarmTopologies',
              'frontendInventory', 'productionReadinessAudit', 'competitiveMoat',
              'brand', 'securityFramework', 'basePrompt']:
        if k in spec:
            blocks[k] = spec[k]
    # Branding fields
    blocks['nyayasiddhiTrademark'] = spec.get('nyayasiddhiTrademark',
        'Nyayavigya™ is a product of Nyayasiddhi Legaltech LLP. All rights reserved.')
    blocks['sdkNamingRule'] = spec.get('sdkNamingRule',
        "The SDK is always named 'Nyayavigya SDK' regardless of the product consuming it.")
    blocks['backedBy'] = 'Nyayasiddhi™'
    blocks['legalEntity'] = 'Nyayasiddhi Legaltech LLP'
    blocks['sdkNote'] = spec.get('sdkNote', '')

    # Jurisdiction-localised JCN block (subset of full jurisdictions)
    blocks['jurisdictions'] = spec.get('jurisdictions', {})

    return blocks


def upgrade_registry(jurisdiction_code, apply=False):
    """Transform a single jurisdiction's registry to v5.0.0.

    Always loads the v3 source from BACKUP_DIR if a backup exists — this makes
    the script idempotent across re-runs even after a previous --apply has
    already overwritten production with v5 output. Falls back to REGISTRY_DIR
    only on the very first invocation (when no backup exists yet).
    """
    fname = f'Nyayavigya-Legal-registry-{jurisdiction_code}.json'
    backup_path = os.path.join(BACKUP_DIR, fname)
    prod_path = os.path.join(REGISTRY_DIR, fname)
    if os.path.exists(backup_path):
        src_path = backup_path
        print(f'  Reading v3 source from backup: {os.path.relpath(backup_path, REGISTRY_DIR)}')
    elif os.path.exists(prod_path):
        src_path = prod_path
    else:
        print(f'  ⚠ Source not found: {prod_path}')
        return False

    with open(src_path) as f:
        v3_reg = json.load(f)

    spec = load_v5_spec()
    spec_index = build_spec_agent_index(spec)

    print(f'  Loading {len(v3_reg["agents"])} v3 agents from {jurisdiction_code}...')

    # Build new registry
    new_reg = deepcopy(v3_reg)
    new_reg['registryVersion'] = '5.0.0'
    new_reg['registryFormat'] = 'v5-governed-execution-network-nyayasiddhi-comprehensive'
    new_reg['platformVersion'] = '3.1.2'
    new_reg['sdkVersion'] = 'NYV-SDK-v5.0.0'
    new_reg['product'] = 'Nyayavigya'
    new_reg['gaDate'] = '2026-05-15'
    new_reg['romaLevel'] = 'L5'
    new_reg['lastUpdated'] = datetime.utcnow().isoformat() + 'Z'
    new_reg['noteRevision'] = ('v5.0.0 COMPREHENSIVE — §0 Security Constitution on all 148 agents. '
                                'OWASP LLM Top 10 2025. Nyayasiddhi™ branding locked. '
                                'NSS v1.0. Migrated from v3-full-23section by upgrade-to-v5.py.')
    new_reg['generatedAt'] = datetime.utcnow().isoformat() + 'Z'

    # Add 18+ top-level blocks
    top_blocks = build_registry_top_blocks(spec, jurisdiction_code)
    for k, v in top_blocks.items():
        new_reg[k] = v

    # Transform every agent
    upgraded_agents = []
    matched = 0
    queens = 0
    for v3_agent in v3_reg['agents']:
        upgraded = upgrade_agent(v3_agent, spec_index, jurisdiction_code, spec)
        upgraded_agents.append(upgraded)
        if v3_agent.get('originalAgentId') in spec_index:
            matched += 1
        elif 'queen' in v3_agent.get('id', '').lower():
            queens += 1
    new_reg['agents'] = upgraded_agents

    print(f'  Transformed: {matched} matched + {queens} Queen = {len(upgraded_agents)} total')

    # Output: ALWAYS write to REGISTRY_DIR (production) — never to BACKUP_DIR.
    # This is true even when src_path points at the backup, because the script
    # is a v3→v5 transformer and BACKUP_DIR holds the immutable v3 source.
    if apply:
        out_path = os.path.join(REGISTRY_DIR, fname)
        if not os.path.exists(backup_path):
            print(f'  ⚠ Backup missing at {backup_path} — refusing to apply')
            return False
        print(f'  Backup verified: {backup_path}')
    else:
        os.makedirs(STAGED_DIR, exist_ok=True)
        out_path = os.path.join(STAGED_DIR, fname)

    with open(out_path, 'w') as f:
        json.dump(new_reg, f, indent=2, ensure_ascii=False)
    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print(f'  Wrote: {out_path} ({size_mb:.2f} MB)')
    return True


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--jurisdiction', help='Single jurisdiction code (IN, UK, US, GC, EU, SG, Default)')
    p.add_argument('--all-jurisdictions', action='store_true', help='Process all 7 registries')
    p.add_argument('--apply', action='store_true', help='Replace production files (requires backup)')
    args = p.parse_args()

    targets = []
    if args.all_jurisdictions:
        targets = ['IN', 'UK', 'US', 'GC', 'EU', 'SG', 'Default']
    elif args.jurisdiction:
        targets = [args.jurisdiction]
    else:
        p.error('Specify --jurisdiction <CODE> or --all-jurisdictions')

    print(f'═══ v3 → v5.0.0 Registry Upgrade ═══')
    print(f'Mode: {"APPLY (production)" if args.apply else "STAGED (.v5-staged/)"}')
    print(f'Targets: {targets}\n')

    results = {}
    for j in targets:
        print(f'── {j} ──')
        results[j] = upgrade_registry(j, apply=args.apply)
        print()

    print('═══ Summary ═══')
    for j, ok in results.items():
        print(f'  {j}: {"✓" if ok else "✗"}')


if __name__ == '__main__':
    main()
