/**
 * Jurexio Platform 3.1.2 — Jurisdictions Seed
 * JRX-SCRIPT-SEED-JURISDICTIONS-001
 *
 * Canonical 6 Jurisdictions: India, UK, GCC, Europe, USA, Singapore
 * ─────────────────────────────────────────────────────────────────────────────
 * MIGRATION NOTE v2026.04:
 *   UAE (AE) → GCC (GC) — Gulf Cooperation Council consolidation
 *   Saudi Arabia (SA) → removed, merged into GCC
 *   UK added as new canonical jurisdiction
 * ─────────────────────────────────────────────────────────────────────────────
 * SLM Bindings:
 *   NS-SLM-IND | NS-SLM-UK | NS-SLM-GCC | NS-SLM-EUR | NS-SLM-USA | NS-SLM-SGP
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_jurisdiction_configs': [
    'jurisdiction', 'name', 'legal_framework', 'languages', 'currency',
  ],
} as const;
import * as dotenv from 'dotenv';

dotenv.config();

const sql = makePgSql();

/**
 * CANONICAL_JURISDICTIONS — single source of truth for all 6 Jurexio jurisdictions.
 * Any jurisdiction code change requires full migration audit across ALL files.
 */
const CANONICAL_JURISDICTIONS = [
  {
    jurisdiction: 'IN',
    name: 'India',
    slm_binding: 'NS-SLM-IND',
    legal_framework: [
      'Constitution of India 1950',
      'BNS 2023 (Bharatiya Nyaya Sanhita)',
      'BNSS 2023 (Bharatiya Nagarik Suraksha Sanhita)',
      'BSA 2023 (Bharatiya Sakshya Adhiniyam)',
      'CPC 1908',
      'Companies Act 2013',
      'DPDPA 2023 (Digital Personal Data Protection Act)',
      'Income Tax Act 1961',
      'GST Laws 2017',
      'Arbitration and Conciliation Act 1996',
    ],
    languages: ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'pa', 'bn', 'or', 'as', 'ur', 'sa', 'kok', 'mai', 'mni', 'ks', 'sd', 'doi', 'sat'],
    currency: 'INR',
  },
  {
    jurisdiction: 'UK',
    name: 'United Kingdom',
    slm_binding: 'NS-SLM-UK',
    legal_framework: [
      'UK GDPR',
      'Data Protection Act 2018',
      'Companies Act 2006',
      'Employment Rights Act 1996',
      'Equality Act 2010',
      'Arbitration Act 1996',
      'Financial Services and Markets Act 2000',
      'Proceeds of Crime Act 2002',
      'Consumer Rights Act 2015',
      'UK AI Regulation Framework 2024',
    ],
    languages: ['en', 'cy', 'gd'],
    currency: 'GBP',
  },
  {
    jurisdiction: 'GC',
    name: 'GCC (Gulf Cooperation Council)',
    slm_binding: 'NS-SLM-GCC',
    legal_framework: [
      'UAE Federal Law',
      'UAE Civil Code (Federal Law No. 5/1985)',
      'DIFC Laws and Regulations',
      'ADGM Laws and Regulations',
      'Saudi Commercial Law',
      'Saudi Labor Law',
      'GCC Common Market Agreement',
      'GCC Cybercrime Law',
      'PDPL (Saudi Personal Data Protection Law)',
      'UAE Federal Decree-Law No. 45/2021 (Data Protection)',
    ],
    languages: ['en', 'ar'],
    currency: 'AED',
  },
  {
    jurisdiction: 'EU',
    name: 'European Union',
    slm_binding: 'NS-SLM-EUR',
    legal_framework: [
      'GDPR (General Data Protection Regulation)',
      'EU AI Act 2024',
      'Digital Services Act (DSA)',
      'Digital Markets Act (DMA)',
      'NIS2 Directive',
      'ePrivacy Directive',
      'ECHR (European Convention on Human Rights)',
      'EU Consumer Rights Directive',
    ],
    languages: ['en', 'fr', 'de', 'es', 'it', 'nl', 'pl', 'pt', 'ro', 'sv', 'da', 'fi'],
    currency: 'EUR',
  },
  {
    jurisdiction: 'US',
    name: 'United States',
    slm_binding: 'NS-SLM-USA',
    legal_framework: [
      'US Federal Constitution',
      'Uniform Commercial Code (UCC)',
      'CCPA (California Consumer Privacy Act)',
      'HIPAA',
      'SOX (Sarbanes-Oxley Act)',
      'SEC Regulations',
      'Federal Rules of Civil Procedure',
      'Federal Rules of Evidence',
      'State Laws (50 states)',
    ],
    languages: ['en', 'es'],
    currency: 'USD',
  },
  {
    jurisdiction: 'SG',
    name: 'Singapore',
    slm_binding: 'NS-SLM-SGP',
    legal_framework: [
      'Singapore Companies Act 1967',
      'PDPA (Personal Data Protection Act 2012)',
      'Employment Act (Cap. 91)',
      'Electronic Transactions Act',
      'Securities and Futures Act',
      'Arbitration Act',
      'MAS (Monetary Authority of Singapore) Regulations',
    ],
    languages: ['en', 'zh', 'ms', 'ta'],
    currency: 'SGD',
  },
];

async function seedJurisdictions(): Promise<void> {
  console.log('  Seeding: Jurisdiction Configs...');
  await assertColumns(sql, './jrx-seed-jurisdictions', REQUIRED_COLUMNS);

  for (const j of CANONICAL_JURISDICTIONS) {
    try {
      await sql`
        INSERT INTO nv_jurisdiction_configs (jurisdiction, name, legal_framework, languages, currency)
        VALUES (${j.jurisdiction}, ${j.name}, ${j.legal_framework}, ${j.languages}, ${j.currency})
        ON CONFLICT (jurisdiction) DO UPDATE
          SET name = EXCLUDED.name,
              legal_framework = EXCLUDED.legal_framework,
              languages = EXCLUDED.languages
      `;
      console.log(`    ✓ ${j.jurisdiction}: ${j.name} [${j.slm_binding}]`);
    } catch (err: any) {
      console.error(`    ✗ Failed to seed ${j.jurisdiction}: ${err.message}`);
      throw err;
    }
  }

  console.log(`  ✓ ${CANONICAL_JURISDICTIONS.length} jurisdictions seeded`);
  console.log('  ✓ Jurisdiction Configs seeded');
}

seedJurisdictions().catch((err) => {
  console.error('Jurisdiction seeding failed:', err);
  process.exit(1);
}).finally(() => sql.end());
