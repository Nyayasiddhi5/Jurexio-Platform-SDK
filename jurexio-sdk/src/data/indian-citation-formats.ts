export interface CitationFormat {
  id: string;
  name: string;
  abbreviation: string;
  description: string;
  court: string;
  format: string;
  example: string;
  notes?: string;
}

export const INDIAN_CITATION_FORMATS: CitationFormat[] = [
  {
    id: 'scc',
    name: 'Supreme Court Cases',
    abbreviation: 'SCC',
    description: 'Premier law report for Supreme Court of India judgments published by Eastern Book Company',
    court: 'Supreme Court of India',
    format: '(YYYY) Volume SCC Page',
    example: '(2023) 5 SCC 1',
    notes: 'Most widely cited. Volume numbers reset each year. SCC Online also available for unreported judgments.'
  },
  {
    id: 'air',
    name: 'All India Reporter',
    abbreviation: 'AIR',
    description: 'Oldest and most respected law report covering Supreme Court and all High Courts',
    court: 'Supreme Court and High Courts',
    format: 'AIR YYYY Court Page',
    example: 'AIR 2023 SC 1234',
    notes: 'Court abbreviations: SC (Supreme Court), Del (Delhi HC), Bom (Bombay HC), Mad (Madras HC), Cal (Calcutta HC), Kar (Karnataka HC), etc.'
  },
  {
    id: 'scr',
    name: 'Supreme Court Reports',
    abbreviation: 'SCR',
    description: 'Official law report of the Supreme Court of India',
    court: 'Supreme Court of India',
    format: '(YYYY) Volume SCR Page',
    example: '(2023) 2 SCR 567',
    notes: 'Official reports but published with delay. SCC preferred for recent citations.'
  },
  {
    id: 'scc_online',
    name: 'SCC Online',
    abbreviation: 'SCC OnLine',
    description: 'Online database of unreported and reported judgments across all courts',
    court: 'All Courts',
    format: 'YYYY SCC OnLine Court Number',
    example: '2023 SCC OnLine SC 789',
    notes: 'Used for unreported judgments. Court codes: SC, Del, Bom, Mad, Cal, NCLAT, NCLT, SAT, etc.'
  },
  {
    id: 'crilj',
    name: 'Criminal Law Journal',
    abbreviation: 'CriLJ',
    description: 'Specialized law report for criminal law judgments',
    court: 'Supreme Court and High Courts',
    format: 'YYYY CriLJ Page',
    example: '2023 CriLJ 1456',
    notes: 'Covers criminal law across Supreme Court and High Courts'
  },
  {
    id: 'bom_lr',
    name: 'Bombay Law Reporter',
    abbreviation: 'Bom LR',
    description: 'Law report for Bombay High Court judgments',
    court: 'Bombay High Court',
    format: 'YYYY (Volume) Bom LR Page',
    example: '2023 (3) Bom LR 245',
  },
  {
    id: 'dlr',
    name: 'Delhi Law Reporter',
    abbreviation: 'DLR',
    description: 'Unofficial law report for Delhi High Court',
    court: 'Delhi High Court',
    format: 'YYYY DLR Page',
    example: '2023 DLR 789',
  },
  {
    id: 'mad_lw',
    name: 'Madras Law Weekly',
    abbreviation: 'MLW',
    description: 'Law report for Madras High Court judgments',
    court: 'Madras High Court',
    format: '(YYYY) Volume MLW Page',
    example: '(2023) 2 MLW 345',
  },
  {
    id: 'comp_cas',
    name: 'Company Cases',
    abbreviation: 'Comp Cas',
    description: 'Specialized law report for company law judgments including NCLT/NCLAT',
    court: 'Supreme Court, High Courts, NCLT, NCLAT',
    format: '(YYYY) Volume Comp Cas Page',
    example: '(2023) 185 Comp Cas 456',
    notes: 'Covers Companies Act, IBC, SEBI matters'
  },
  {
    id: 'taxmann',
    name: 'Taxmann',
    abbreviation: 'Taxmann',
    description: 'Comprehensive tax law database and reports',
    court: 'ITAT, High Courts, Supreme Court',
    format: '[YYYY] Volume Taxmann Page (Court)',
    example: '[2023] 145 Taxmann 678 (SC)',
    notes: 'Leading resource for income tax, GST, company law, FEMA, IBC matters'
  },
  {
    id: 'itr',
    name: 'Income Tax Reports',
    abbreviation: 'ITR',
    description: 'Specialized tax law reports',
    court: 'ITAT, High Courts, Supreme Court',
    format: '(YYYY) Volume ITR Page',
    example: '(2023) 456 ITR 123',
  },
  {
    id: 'eld',
    name: 'Employment Law Digest',
    abbreviation: 'ELD',
    description: 'Reports covering employment and labour law judgments',
    court: 'Labour Courts, Industrial Tribunals, High Courts',
    format: 'YYYY ELD Page',
    example: '2023 ELD 567',
  },
  {
    id: 'arb_lr',
    name: 'Arbitration Law Reporter',
    abbreviation: 'Arb LR',
    description: 'Specialized reports for arbitration law',
    court: 'Supreme Court, High Courts',
    format: '(YYYY) Volume Arb LR Page',
    example: '(2023) 3 Arb LR 89',
  },
  {
    id: 'scale',
    name: 'Supreme Court Almanac',
    abbreviation: 'SCALE',
    description: 'Quick publication of Supreme Court judgments before formal reporting',
    court: 'Supreme Court of India',
    format: '(YYYY) Volume SCALE Page',
    example: '(2023) 8 SCALE 234',
    notes: 'Published quickly after judgment. Later replaced by SCC citation.'
  },
  {
    id: 'manu',
    name: 'Manupatra',
    abbreviation: 'MANU',
    description: 'Online legal database with unique identifier for each judgment',
    court: 'All Courts and Tribunals',
    format: 'MANU/Court/Number/YYYY',
    example: 'MANU/SC/0123/2023',
    notes: 'Court codes: SC, DE (Delhi), MH (Maharashtra), KA (Karnataka), TN (Tamil Nadu), etc.'
  },
  {
    id: 'neutral_citation',
    name: 'Neutral Citation (Supreme Court)',
    abbreviation: 'NC',
    description: 'Court-assigned neutral citation adopted by Supreme Court from 2024',
    court: 'Supreme Court of India',
    format: 'YYYY INSC Number',
    example: '2024 INSC 123',
    notes: 'New system adopted from January 2024. Court-assigned, publication-neutral.'
  },
];

export const COURT_ABBREVIATIONS: Record<string, string> = {
  'SC': 'Supreme Court of India',
  'Del': 'Delhi High Court',
  'Bom': 'Bombay High Court',
  'Mad': 'Madras High Court',
  'Cal': 'Calcutta High Court',
  'Kar': 'Karnataka High Court',
  'Ker': 'Kerala High Court',
  'All': 'Allahabad High Court',
  'Pat': 'Patna High Court',
  'AP': 'Andhra Pradesh High Court',
  'Tel': 'Telangana High Court',
  'Guj': 'Gujarat High Court',
  'Raj': 'Rajasthan High Court',
  'P&H': 'Punjab & Haryana High Court',
  'Ori': 'Orissa High Court',
  'Gau': 'Gauhati High Court',
  'J&K': 'Jammu & Kashmir High Court',
  'HP': 'Himachal Pradesh High Court',
  'MP': 'Madhya Pradesh High Court',
  'Chh': 'Chhattisgarh High Court',
  'Jhar': 'Jharkhand High Court',
  'Utt': 'Uttarakhand High Court',
  'Tri': 'Tripura High Court',
  'Meg': 'Meghalaya High Court',
  'Mani': 'Manipur High Court',
  'Sik': 'Sikkim High Court',
  'NCLT': 'National Company Law Tribunal',
  'NCLAT': 'National Company Law Appellate Tribunal',
  'ITAT': 'Income Tax Appellate Tribunal',
  'SAT': 'Securities Appellate Tribunal',
  'NCDRC': 'National Consumer Disputes Redressal Commission',
  'CAT': 'Central Administrative Tribunal',
  'DRT': 'Debt Recovery Tribunal',
  'DRAT': 'Debt Recovery Appellate Tribunal',
  'NGT': 'National Green Tribunal',
  'RERA': 'Real Estate Regulatory Authority',
  'CESTAT': 'Customs, Excise & Service Tax Appellate Tribunal',
};

export function searchCitations(query: string): CitationFormat[] {
  const q = query.toLowerCase();
  return INDIAN_CITATION_FORMATS.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.abbreviation.toLowerCase().includes(q) ||
    c.description.toLowerCase().includes(q)
  );
}

export function getCourtAbbreviation(code: string): string | undefined {
  return COURT_ABBREVIATIONS[code];
}
