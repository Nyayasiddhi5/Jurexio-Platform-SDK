/**
 * Jurexio v5.0.1 — Prompt-body enrichment templates (T12).
 *
 * Adds case-law citations + v2-style narrative depth INSIDE existing
 * §10 (citation) and §1 (identity) sections without breaking idempotency.
 */

const IN_FOUNDATIONAL_CASES = [
  'Kesavananda Bharati v. State of Kerala AIR 1973 SC 1461 (basic structure doctrine)',
  'Maneka Gandhi v. Union of India AIR 1978 SC 597 (Article 21 procedural fairness)',
  'Vishaka v. State of Rajasthan AIR 1997 SC 3011 (workplace harassment guidelines)',
  'Olga Tellis v. Bombay Municipal Corp. AIR 1986 SC 180 (right to livelihood)',
  'I.R. Coelho v. State of Tamil Nadu (2007) 2 SCC 1 (judicial review of Ninth Schedule)',
];

const IN_PRACTICE_AREA_CASES: Record<string, string[]> = {
  'Contract Law': [
    'Bhagwandas Goverdhandas Kedia v. Girdharilal Parshottamdas AIR 1966 SC 543 (instantaneous communication)',
    'Mohori Bibee v. Dharmodas Ghose ILR (1903) 30 Cal 539 (PC) (minor\'s contracts)',
    'Satyabrata Ghose v. Mugneeram Bangur AIR 1954 SC 44 (frustration under §56 ICA)',
  ],
  'Litigation': [
    'Anita Kushwaha v. Pushap Sudan (2016) 8 SCC 509 (access to justice)',
    'Salem Advocate Bar Assn. v. Union of India (2005) 6 SCC 344 (CPC reforms)',
  ],
  'Corporate & M&A': [
    'Salomon v. A. Salomon & Co. Ltd. [1897] AC 22 (separate legal personality)',
    'Vodafone International Holdings v. UoI (2012) 6 SCC 613 (offshore M&A taxation)',
    'Tata Consultancy Services v. Cyrus Investments (2021) 9 SCC 449 (oppression & mismanagement)',
  ],
  'Tax Law': [
    'McDowell & Co. v. CTO (1985) 3 SCC 230 (substance over form)',
    'Vodafone International Holdings v. UoI (2012) 6 SCC 613 (indirect transfer)',
    'Union of India v. Mohit Minerals (2022) 10 SCC 700 (GST on ocean freight)',
  ],
  'Criminal Law': [
    'State of Punjab v. Baldev Singh (1999) 6 SCC 172 (NDPS §50)',
    'Lalita Kumari v. Govt. of UP (2014) 2 SCC 1 (mandatory FIR registration)',
    'Arnesh Kumar v. State of Bihar (2014) 8 SCC 273 (arrest §41A CrPC)',
  ],
  'Banking & Finance': [
    'Mardia Chemicals v. UoI (2004) 4 SCC 311 (SARFAESI constitutional validity)',
    'Innoventive Industries v. ICICI Bank (2018) 1 SCC 407 (IBC §7 trigger)',
    'Swiss Ribbons v. UoI (2019) 4 SCC 17 (IBC constitutional validity)',
  ],
  'Labor & Employment': [
    'Bandhua Mukti Morcha v. UoI AIR 1984 SC 802 (bonded labour)',
    'Air India Statutory Corp. v. United Labour Union (1997) 9 SCC 377 (regularisation)',
    'Secretary, State of Karnataka v. Umadevi (2006) 4 SCC 1 (regularisation of irregular appointments)',
  ],
  'IP & Patents': [
    'Novartis AG v. UoI (2013) 6 SCC 1 (§3(d) Patents Act)',
    'Bayer Corp. v. Natco Pharma 2014 (60) PTC 277 (IPAB) (compulsory licence)',
    'Toyota Jidosha Kabushiki Kaisha v. Prius Auto Industries (2018) 2 SCC 1 (trademark passing off)',
  ],
  'Cyber & Data Privacy': [
    'K.S. Puttaswamy v. UoI (2017) 10 SCC 1 (right to privacy)',
    'Anvar P.V. v. P.K. Basheer (2014) 10 SCC 473 (electronic evidence §65B)',
    'Shreya Singhal v. UoI (2015) 5 SCC 1 (§66A IT Act struck down)',
  ],
  'Arbitration & ADR': [
    'BALCO v. Kaiser Aluminium (2012) 9 SCC 552 (seat vs. venue)',
    'Bharat Aluminium v. Kaiser Aluminium Technical Services (2016) 4 SCC 126',
    'Vidya Drolia v. Durga Trading Corp. (2021) 2 SCC 1 (arbitrability tests)',
  ],
  'Insolvency & Bankruptcy': [
    'Innoventive Industries v. ICICI Bank (2018) 1 SCC 407',
    'Essar Steel India v. Satish Kumar Gupta (2020) 8 SCC 531 (CoC commercial wisdom)',
    'Vidarbha Industries v. Axis Bank (2022) 8 SCC 352 (§7 discretion)',
  ],
  'Real Estate': [
    'Pioneer Urban Land v. Govindan Raghavan (2019) 5 SCC 725 (RERA homebuyer remedies)',
    'Newtech Promoters v. State of UP (2021) 13 SCALE 502 (RERA refund)',
  ],
  'Consumer Protection': [
    'Indian Medical Assn. v. V.P. Shantha (1995) 6 SCC 651 (medical services as consumer)',
    'Lucknow Development Authority v. M.K. Gupta (1994) 1 SCC 243',
  ],
  'Environmental Law': [
    'M.C. Mehta v. UoI AIR 1987 SC 1086 (absolute liability)',
    'T.N. Godavarman Thirumulpad v. UoI (1997) 2 SCC 267 (forest conservation)',
    'Vellore Citizens Welfare Forum v. UoI (1996) 5 SCC 647 (precautionary principle)',
  ],
  'Family Law': [
    'Shayara Bano v. UoI (2017) 9 SCC 1 (triple talaq)',
    'Joseph Shine v. UoI (2019) 3 SCC 39 (§497 IPC adultery struck down)',
    'Indra Sarma v. V.K.V. Sarma (2013) 15 SCC 755 (live-in relationships)',
  ],
};

const UK_FOUNDATIONAL_CASES = [
  'Donoghue v. Stevenson [1932] AC 562 (negligence neighbour principle)',
  'Carlill v. Carbolic Smoke Ball Co. [1893] 1 QB 256 (unilateral contracts)',
  'R (Miller) v. Secretary of State for Exiting the EU [2017] UKSC 5',
  'Pepper v. Hart [1993] AC 593 (Hansard in statutory interpretation)',
];

const US_FOUNDATIONAL_CASES = [
  'Marbury v. Madison 5 U.S. 137 (1803) (judicial review)',
  'Brown v. Board of Education 347 U.S. 483 (1954)',
  'Citizens United v. FEC 558 U.S. 310 (2010)',
  'West Virginia v. EPA 597 U.S. ___ (2022) (major-questions doctrine)',
];

const EU_FOUNDATIONAL_CASES = [
  'Costa v. ENEL Case 6/64 [1964] ECR 585 (primacy of EU law)',
  'Van Gend en Loos Case 26/62 [1963] ECR 1 (direct effect)',
  'Schrems II Case C-311/18 [2020] (data transfers)',
];

const SG_FOUNDATIONAL_CASES = [
  'PP v. Taw Cheng Kong [1998] 2 SLR(R) 489 (Article 12 equality)',
  'Tan Cheng Bock v. AG [2017] SGCA 50 (purposive interpretation)',
];

const GC_FOUNDATIONAL_CASES = [
  'Aramco v. Government of Saudi Arabia (1958) (sovereign immunity in arbitration)',
  'Dallah Real Estate v. Pakistan [2010] UKSC 46 (recognition of GCC arbitral awards)',
];

export function getCaseLawCitations(jurisdiction: string, practiceArea: string): string[] {
  const found = jurisdiction === 'IN' || jurisdiction === 'Default' ? IN_FOUNDATIONAL_CASES :
    jurisdiction === 'UK' ? UK_FOUNDATIONAL_CASES :
    jurisdiction === 'US' ? US_FOUNDATIONAL_CASES :
    jurisdiction === 'EU' ? EU_FOUNDATIONAL_CASES :
    jurisdiction === 'SG' ? SG_FOUNDATIONAL_CASES :
    jurisdiction === 'GC' ? GC_FOUNDATIONAL_CASES :
    IN_FOUNDATIONAL_CASES;

  const practiceCases = (jurisdiction === 'IN' || jurisdiction === 'Default')
    ? (IN_PRACTICE_AREA_CASES[practiceArea] || [])
    : [];

  return [...found.slice(0, 3), ...practiceCases.slice(0, 3)];
}

export function buildCaseAuthoritiesBlock(jurisdiction: string, practiceArea: string): string {
  const cases = getCaseLawCitations(jurisdiction, practiceArea);
  if (!cases.length) return '';
  const items = cases.map(c => `      <case>${escapeXml(c)}</case>`).join('\n');
  return `  <jurisdictional_case_authorities jurisdiction="${jurisdiction}" practice_area="${escapeXml(practiceArea)}">
    <description>Foundational and practice-specific case-law authorities (April 2026 vintage). Cite explicitly on every legal opinion. Verify pin-cites before output.</description>
    <cases>
${items}
    </cases>
  </jurisdictional_case_authorities>`;
}

export function buildRoleNarrativeBlock(args: {
  agentName: string;
  agentId: string;
  tier: string;
  practiceArea: string;
  jurisdiction: string;
  description?: string;
}): string {
  const tierUpper = args.tier.toUpperCase();
  const desc = args.description || `Specialized legal AI agent operating in ${args.practiceArea} for the ${args.jurisdiction} jurisdiction.`;
  return `  <role_narrative>
    You are the **${args.agentName}**, a specialized legal AI agent in the Jurexio Legal AI ecosystem. You provide expert ${args.practiceArea} services with ${tierUpper}-tier autonomy, operating within the ${args.jurisdiction} legal framework.

    ${escapeXml(desc)}

    Your operating philosophy: rigorous legal reasoning (IRAC: Issue, Rule, Application, Conclusion); explicit citation of every authority; humility about jurisdictional variations and conflict-of-laws; immediate escalation when client matter exceeds your tier's autonomy ceiling; and absolute fidelity to the §23 Data Privacy & PII Charter on every input you process.

    Decision authority: strategic decisions within ${args.practiceArea} for ${args.jurisdiction}; resource allocation and sub-agent delegation within your team; external counsel engagement recommendations; immediate escalation of constitutional, criminal-defense, or matters with potential liability above tier ceilings to the jurisdiction orchestrator (Queen agent).
  </role_narrative>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
