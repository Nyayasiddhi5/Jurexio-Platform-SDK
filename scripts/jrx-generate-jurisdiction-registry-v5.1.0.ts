#!/usr/bin/env npx tsx
/**
 * Generate jurisdiction-primary registry files (164 agents each) from Default v5.1.0.
 * Same agent IDs — tuned §3 statute order, SLM binding, and metadata per deployment.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_PATH = path.join(ROOT, 'config', 'agent-registries', 'Jurexio-Legal-registry-Default.json');
const JCN_PATH = path.join(ROOT, 'config', 'jcn-nodes-v5.1.0.json');
const OUT_DIR = path.join(ROOT, 'config', 'agent-registries');

type JcnCode = 'IN' | 'UK' | 'US' | 'EU' | 'GC' | 'SG';

const JCN_META: Record<JcnCode, {
  code: JcnCode;
  jcnId: string;
  name: string;
  fullName: string;
  legalSystem: string;
  primarySLM: string;
  statuteLead: string;
  languageDefault: string;
}> = {
  IN: {
    code: 'IN',
    jcnId: 'JCN-IN',
    name: 'India',
    fullName: 'Republic of India',
    legalSystem: 'Common Law (British-derived) with codified statutes — BNS/BNSS/BSA 2023',
    primarySLM: 'NS-SLM-IND',
    statuteLead: 'PRIMARY JURISDICTION — INDIA (BNS 2023, BNSS 2023, BSA 2023, DPDP 2023, Companies Act 2013, IBC 2016, SEBI/RBI regulations). Cross-border references follow P19-BRIDGE.',
    languageDefault: 'en',
  },
  UK: {
    code: 'UK',
    jcnId: 'JCN-UK',
    name: 'United Kingdom',
    fullName: 'United Kingdom of Great Britain and Northern Ireland',
    legalSystem: 'Common Law — UK GDPR, SRA/BSB professional conduct',
    primarySLM: 'NS-SLM-UK',
    statuteLead: 'PRIMARY JURISDICTION — UNITED KINGDOM (Companies Act 2006, UK GDPR + DPA 2018, FSMA 2000, Employment Rights Act 1996, Arbitration Act 1996). Cross-border via P19-BRIDGE.',
    languageDefault: 'en',
  },
  US: {
    code: 'US',
    jcnId: 'JCN-US',
    name: 'United States',
    fullName: 'United States of America',
    legalSystem: 'Common Law federal + state — ABA Model Rules, UCC, federal securities',
    primarySLM: 'NS-SLM-USA',
    statuteLead: 'PRIMARY JURISDICTION — UNITED STATES (UCC, Securities Acts, HIPAA, Sherman Act, FCPA, Dodd-Frank, state privacy acts). Cross-border via P19-BRIDGE.',
    languageDefault: 'en',
  },
  EU: {
    code: 'EU',
    jcnId: 'JCN-EU',
    name: 'European Union',
    fullName: 'European Union',
    legalSystem: 'Civil + supranational — GDPR, EU AI Act, DORA, CCBE',
    primarySLM: 'NS-SLM-EUR',
    statuteLead: 'PRIMARY JURISDICTION — EUROPEAN UNION (GDPR, EU AI Act Art 14 HITL mandatory, DORA, DMA, ePrivacy). Cross-border via P19-BRIDGE.',
    languageDefault: 'en',
  },
  GC: {
    code: 'GC',
    jcnId: 'JCN-GCC',
    name: 'Gulf Cooperation Council',
    fullName: 'GCC / UAE — DIFC & ADGM',
    legalSystem: 'Mixed civil + common law free zones — UAE PDPL, DIFC/ADGM LPR',
    primarySLM: 'NS-SLM-GCC',
    statuteLead: 'PRIMARY JURISDICTION — GCC/UAE (DIFC Law, ADGM Regulations, UAE PDPL, Islamic finance AAOIFI where applicable). Cross-border via P19-BRIDGE.',
    languageDefault: 'en',
  },
  SG: {
    code: 'SG',
    jcnId: 'JCN-SG',
    name: 'Singapore',
    fullName: 'Republic of Singapore',
    legalSystem: 'Common Law — PDPA, Law Society PCR, MAS regulations',
    primarySLM: 'NS-SLM-SGP',
    statuteLead: 'PRIMARY JURISDICTION — SINGAPORE (Companies Act Cap 50, PDPA 2012, Contract Act, SIAC Rules 2016). Cross-border via P19-BRIDGE.',
    languageDefault: 'en',
  },
};

const BAR_COUNCIL_AGENT_IDS: Record<JcnCode, string[]> = {
  IN: ['A-149', 'A-150'],
  UK: ['A-151', 'A-152'],
  US: ['A-153', 'A-154'],
  EU: ['A-157', 'A-158'],
  GC: ['A-155', 'A-156'],
  SG: ['A-159', 'A-160'],
};

function tuneSection3(systemPrompt: string, meta: typeof JCN_META[JcnCode]): string {
  const marker = '<section_3_jurisdiction>';
  const endMarker = '</section_3_jurisdiction>';
  const start = systemPrompt.indexOf(marker);
  const end = systemPrompt.indexOf(endMarker);
  if (start === -1 || end === -1) return systemPrompt;

  const injection = `\n\n[JCN PRIMARY — ${meta.code}]\n${meta.statuteLead}\n`;
  const before = systemPrompt.slice(0, start + marker.length);
  const body = systemPrompt.slice(start + marker.length, end);
  const after = systemPrompt.slice(end);
  if (body.includes('[JCN PRIMARY —')) return systemPrompt;
  return before + injection + body + after;
}

function tuneAgent(agent: Record<string, any>, meta: typeof JCN_META[JcnCode]): Record<string, any> {
  const tuned = JSON.parse(JSON.stringify(agent)) as Record<string, any>;
  tuned.systemPrompt = tuneSection3(String(tuned.systemPrompt || ''), meta);

  if (tuned.slmBinding && typeof tuned.slmBinding === 'object') {
    tuned.slmBinding = {
      ...tuned.slmBinding,
      primarySLM: meta.primarySLM,
      deploymentPrimary: meta.code,
    };
  }

  if (Array.isArray(tuned.ragNamespaces)) {
    tuned.ragNamespaces = [
      `global:statutes:${meta.code}`,
      ...tuned.ragNamespaces.filter((n: string) => !n.endsWith(`:${meta.code}`)),
    ];
  }

  if (BAR_COUNCIL_AGENT_IDS[meta.code].includes(String(tuned.id))) {
    tuned.jurisdictionActivation = { primary: meta.code, priority: 'high' };
  }

  return tuned;
}

function main(): void {
  if (!fs.existsSync(DEFAULT_PATH)) {
    console.error('Default registry missing. Run: npx tsx scripts/jrx-apply-registry-patch-v5.1.0.ts');
    process.exit(1);
  }

  const defaultReg = JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf-8')) as {
    agents: Record<string, unknown>[];
    registryFormat: string;
    registryVersion: string;
    sdkVersion: string;
    romaDistribution: Record<string, number>;
  };

  let jcnNodes: Record<string, unknown> = {};
  if (fs.existsSync(JCN_PATH)) {
    jcnNodes = (JSON.parse(fs.readFileSync(JCN_PATH, 'utf-8')) as { jcnNodes: Record<string, unknown> }).jcnNodes;
  }

  for (const code of Object.keys(JCN_META) as JcnCode[]) {
    const meta = JCN_META[code];
    const jcnNode = jcnNodes[meta.jcnId] as Record<string, unknown> | undefined;

    const out = {
      registryFormat: defaultReg.registryFormat,
      registryVersion: defaultReg.registryVersion,
      generatedAt: new Date().toISOString(),
      platformVersion: '5.0.1',
      jurisdictionCode: code,
      jurisdictionName: meta.name,
      jurisdictionFullName: meta.fullName,
      legalSystem: meta.legalSystem,
      totalAgents: defaultReg.agents.length,
      primaryJurisdiction: code,
      sdkVersion: defaultReg.sdkVersion,
      romaDistribution: defaultReg.romaDistribution,
      jcnPrimary: meta.jcnId,
      jcnNode: jcnNode || null,
      languageDefault: meta.languageDefault,
      crossBorderEnabled: true,
      agents: defaultReg.agents.map(a => tuneAgent(a as Record<string, any>, meta)),
    };

    const outPath = path.join(OUT_DIR, `Jurexio-Legal-registry-${code}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log(`Wrote ${code}: ${out.agents.length} agents → ${outPath}`);
  }

  console.log('✅ Jurisdiction registries generated.');
}

main();
