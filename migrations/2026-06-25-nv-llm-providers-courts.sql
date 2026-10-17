-- NV-MIGRATION 2026-06-25 — nv_llm_providers + nv_courts (master data)
-- Run as the privileged role (DATABASE_URL_ADMIN / nyvadmin): the runtime role
-- nv_app has USAGE but not CREATE on public, so these migration-provisioned
-- tables were absent on prod RDS (providers tile + courts/jurisdiction counts
-- degraded). Idempotent: safe to re-run. Grants read/write to nv_app at the end.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. nv_llm_providers  (schema mirrors scripts/nv-migrate.ts)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nv_llm_providers (
  id                     SERIAL PRIMARY KEY,
  provider_id            VARCHAR(100) UNIQUE NOT NULL,
  name                   VARCHAR(255) NOT NULL,
  api_base_url           VARCHAR(500),
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  capabilities           TEXT[] DEFAULT '{}',
  supported_models       JSONB DEFAULT '[]',
  rate_limits            JSONB DEFAULT '{}',
  cost_per_1k_tokens_in  FLOAT,
  cost_per_1k_tokens_out FLOAT,
  avg_latency_ms         FLOAT,
  created_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Canonical 23 supported providers (mirrors scripts/nv-seed-llm-providers.ts).
INSERT INTO public.nv_llm_providers (provider_id, name, capabilities, is_active, cost_per_1k_tokens_in, cost_per_1k_tokens_out, avg_latency_ms) VALUES
  ('openai',       'OpenAI',           ARRAY['chat','vision','tools','embeddings','tts','stt'],      TRUE, 0.005,   0.015,   800),
  ('anthropic',    'Anthropic',        ARRAY['chat','vision','tools','long-context'],                TRUE, 0.003,   0.015,   1200),
  ('google',       'Google GenAI',     ARRAY['chat','vision','tools','long-context','multimodal'],   TRUE, 0.0015,  0.006,   700),
  ('openrouter',   'OpenRouter',       ARRAY['chat','vision','tools','multi-model'],                 TRUE, 0.001,   0.003,   900),
  ('groq',         'Groq',             ARRAY['chat','fast-inference','tools'],                       TRUE, 0.0001,  0.0001,  200),
  ('perplexity',   'Perplexity AI',    ARRAY['chat','search','real-time'],                           TRUE, 0.001,   0.001,   1500),
  ('mistral',      'Mistral AI',       ARRAY['chat','tools','embeddings'],                           TRUE, 0.0002,  0.0006,  600),
  ('sarvam',       'Sarvam AI',        ARRAY['chat','tts','stt','translation','indic-languages'],    TRUE, 0.0001,  0.0002,  500),
  ('replicate',    'Replicate',        ARRAY['image-gen','video-gen','audio','custom-models'],       TRUE, 0.0005,  0.001,   3000),
  ('together',     'Together AI',      ARRAY['chat','tools','fine-tuning','embeddings'],             TRUE, 0.0002,  0.0002,  400),
  ('cohere',       'Cohere',           ARRAY['chat','embeddings','rerank','classification'],         TRUE, 0.0003,  0.0015,  700),
  ('fireworks',    'Fireworks AI',     ARRAY['chat','fast-inference','tools'],                       TRUE, 0.0001,  0.0001,  250),
  ('deepseek',     'DeepSeek',         ARRAY['chat','reasoning','tools','code'],                     TRUE, 0.00014, 0.00028, 800),
  ('qwen',         'Alibaba Qwen',     ARRAY['chat','vision','tools','long-context'],                TRUE, 0.0002,  0.0006,  900),
  ('kimi',         'Kimi (Moonshot)',  ARRAY['chat','long-context','tools'],                         TRUE, 0.0001,  0.0003,  1000),
  ('llama',        'Meta LLaMA',       ARRAY['chat','tools','open-source'],                          TRUE, 0.0001,  0.0001,  300),
  ('gemma',        'Google Gemma',     ARRAY['chat','open-source','lightweight'],                    TRUE, 0.00005, 0.0001,  200),
  ('nvidia',       'NVIDIA NIM',       ARRAY['chat','vision','tools','enterprise'],                  TRUE, 0.0003,  0.0009,  500),
  ('azure-openai', 'Azure OpenAI',     ARRAY['chat','vision','tools','enterprise'],                  TRUE, 0.005,   0.015,   900),
  ('aws-bedrock',  'AWS Bedrock',      ARRAY['chat','vision','tools','enterprise'],                  TRUE, 0.003,   0.015,   1000),
  ('huggingface',  'Hugging Face',     ARRAY['chat','embeddings','custom-models','open-source'],     TRUE, 0.0001,  0.0001,  2000),
  ('exa',          'Exa (Search AI)',  ARRAY['search','retrieval','rag'],                            TRUE, 0.001,   0.001,   800),
  ('tavily',       'Tavily Search',    ARRAY['search','retrieval','real-time'],                      TRUE, 0.0005,  0.0005,  1000)
ON CONFLICT (provider_id) DO UPDATE
  SET name = EXCLUDED.name,
      capabilities = EXCLUDED.capabilities,
      cost_per_1k_tokens_in = EXCLUDED.cost_per_1k_tokens_in,
      cost_per_1k_tokens_out = EXCLUDED.cost_per_1k_tokens_out,
      avg_latency_ms = EXCLUDED.avg_latency_ms,
      updated_at = NOW();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. nv_courts  (schema mirrors the SELECT in src/routes/nv-core-routes.ts)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nv_courts (
  id              SERIAL PRIMARY KEY,
  court_id        VARCHAR(80) UNIQUE NOT NULL,
  name            VARCHAR(300) NOT NULL,
  code            VARCHAR(60),
  court_type      VARCHAR(40) NOT NULL DEFAULT 'court',
  state           VARCHAR(120),
  jurisdiction    VARCHAR(8) NOT NULL,
  e_filing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nv_courts_jurisdiction ON public.nv_courts (jurisdiction);

INSERT INTO public.nv_courts (court_id, name, code, court_type, state, jurisdiction, e_filing_enabled) VALUES
  -- India: Supreme Court
  ('IN-SC',        'Supreme Court of India',                       'SCI',    'supreme',     'National',          'IN', TRUE),
  -- India: High Courts (25)
  ('IN-HC-ALD',    'Allahabad High Court',                         'HC-ALD', 'high',        'Uttar Pradesh',     'IN', TRUE),
  ('IN-HC-AP',     'Andhra Pradesh High Court',                    'HC-AP',  'high',        'Andhra Pradesh',    'IN', TRUE),
  ('IN-HC-BOM',    'Bombay High Court',                            'HC-BOM', 'high',        'Maharashtra',       'IN', TRUE),
  ('IN-HC-CAL',    'Calcutta High Court',                          'HC-CAL', 'high',        'West Bengal',       'IN', TRUE),
  ('IN-HC-CHH',    'Chhattisgarh High Court',                      'HC-CHH', 'high',        'Chhattisgarh',      'IN', TRUE),
  ('IN-HC-DEL',    'Delhi High Court',                             'HC-DEL', 'high',        'Delhi',             'IN', TRUE),
  ('IN-HC-GAU',    'Gauhati High Court',                           'HC-GAU', 'high',        'Assam',             'IN', TRUE),
  ('IN-HC-GUJ',    'Gujarat High Court',                           'HC-GUJ', 'high',        'Gujarat',           'IN', TRUE),
  ('IN-HC-HP',     'Himachal Pradesh High Court',                  'HC-HP',  'high',        'Himachal Pradesh',  'IN', TRUE),
  ('IN-HC-JK',     'High Court of Jammu & Kashmir and Ladakh',     'HC-JK',  'high',        'Jammu & Kashmir',   'IN', TRUE),
  ('IN-HC-JHK',    'Jharkhand High Court',                         'HC-JHK', 'high',        'Jharkhand',         'IN', TRUE),
  ('IN-HC-KAR',    'Karnataka High Court',                         'HC-KAR', 'high',        'Karnataka',         'IN', TRUE),
  ('IN-HC-KER',    'Kerala High Court',                            'HC-KER', 'high',        'Kerala',            'IN', TRUE),
  ('IN-HC-MP',     'Madhya Pradesh High Court',                    'HC-MP',  'high',        'Madhya Pradesh',    'IN', TRUE),
  ('IN-HC-MAD',    'Madras High Court',                            'HC-MAD', 'high',        'Tamil Nadu',        'IN', TRUE),
  ('IN-HC-MAN',    'Manipur High Court',                           'HC-MAN', 'high',        'Manipur',           'IN', TRUE),
  ('IN-HC-MEG',    'Meghalaya High Court',                         'HC-MEG', 'high',        'Meghalaya',         'IN', TRUE),
  ('IN-HC-ORI',    'Orissa High Court',                            'HC-ORI', 'high',        'Odisha',            'IN', TRUE),
  ('IN-HC-PAT',    'Patna High Court',                             'HC-PAT', 'high',        'Bihar',             'IN', TRUE),
  ('IN-HC-PH',     'Punjab & Haryana High Court',                  'HC-PH',  'high',        'Punjab & Haryana',  'IN', TRUE),
  ('IN-HC-RAJ',    'Rajasthan High Court',                         'HC-RAJ', 'high',        'Rajasthan',         'IN', TRUE),
  ('IN-HC-SIK',    'Sikkim High Court',                            'HC-SIK', 'high',        'Sikkim',            'IN', TRUE),
  ('IN-HC-TEL',    'Telangana High Court',                         'HC-TEL', 'high',        'Telangana',         'IN', TRUE),
  ('IN-HC-TRI',    'Tripura High Court',                           'HC-TRI', 'high',        'Tripura',           'IN', TRUE),
  ('IN-HC-UTT',    'Uttarakhand High Court',                       'HC-UTT', 'high',        'Uttarakhand',       'IN', TRUE),
  -- India: key tribunals
  ('IN-NCLT',      'National Company Law Tribunal',                'NCLT',   'tribunal',    'National',          'IN', TRUE),
  ('IN-NCLAT',     'National Company Law Appellate Tribunal',      'NCLAT',  'tribunal',    'National',          'IN', TRUE),
  ('IN-NGT',       'National Green Tribunal',                      'NGT',    'tribunal',    'National',          'IN', TRUE),
  ('IN-ITAT',      'Income Tax Appellate Tribunal',                'ITAT',   'tribunal',    'National',          'IN', TRUE),
  ('IN-CESTAT',    'Customs, Excise & Service Tax Appellate Trib.','CESTAT', 'tribunal',    'National',          'IN', TRUE),
  ('IN-DRT',       'Debts Recovery Tribunal',                      'DRT',    'tribunal',    'National',          'IN', TRUE),
  ('IN-SAT',       'Securities Appellate Tribunal',                'SAT',    'tribunal',    'National',          'IN', TRUE),
  ('IN-CAT',       'Central Administrative Tribunal',              'CAT',    'tribunal',    'National',          'IN', TRUE),
  ('IN-TDSAT',     'Telecom Disputes Settlement & Appellate Trib.','TDSAT',  'tribunal',    'National',          'IN', TRUE),
  ('IN-NCDRC',     'National Consumer Disputes Redressal Comm.',   'NCDRC',  'tribunal',    'National',          'IN', TRUE),
  -- United Kingdom
  ('UK-SC',        'Supreme Court of the United Kingdom',          'UKSC',   'supreme',     'United Kingdom',    'UK', FALSE),
  ('UK-COA',       'Court of Appeal (England & Wales)',            'EWCA',   'appellate',   'England & Wales',   'UK', FALSE),
  ('UK-HC',        'High Court of Justice',                        'EWHC',   'high',        'England & Wales',   'UK', FALSE),
  ('UK-CROWN',     'Crown Court',                                  'CROWN',  'court',       'England & Wales',   'UK', FALSE),
  ('UK-COUNTY',    'County Court',                                 'COUNTY', 'court',       'England & Wales',   'UK', FALSE),
  ('UK-MAG',       'Magistrates Court',                            'MAG',    'court',       'England & Wales',   'UK', FALSE),
  ('UK-UT',        'Upper Tribunal',                               'UKUT',   'tribunal',    'United Kingdom',    'UK', FALSE),
  ('UK-ET',        'Employment Tribunal',                          'ET',     'tribunal',    'United Kingdom',    'UK', FALSE),
  -- United States
  ('US-SCOTUS',    'Supreme Court of the United States',           'SCOTUS', 'supreme',     'Federal',           'US', TRUE),
  ('US-CA-FED',    'U.S. Court of Appeals for the Federal Circuit','CAFC',   'appellate',   'Federal',           'US', TRUE),
  ('US-CA-DC',     'U.S. Court of Appeals for the D.C. Circuit',   'CADC',   'appellate',   'Federal',           'US', TRUE),
  ('US-CA-2',      'U.S. Court of Appeals for the Second Circuit', 'CA2',    'appellate',   'Federal',           'US', TRUE),
  ('US-CA-9',      'U.S. Court of Appeals for the Ninth Circuit',  'CA9',    'appellate',   'Federal',           'US', TRUE),
  ('US-DC-SDNY',   'U.S. District Court, S.D. New York',           'SDNY',   'district',    'New York',          'US', TRUE),
  ('US-DC-NDCAL',  'U.S. District Court, N.D. California',         'NDCAL',  'district',    'California',        'US', TRUE),
  ('US-TAX',       'United States Tax Court',                      'USTC',   'specialized', 'Federal',           'US', TRUE),
  ('US-CFC',       'U.S. Court of Federal Claims',                 'CFC',    'specialized', 'Federal',           'US', TRUE),
  -- European Union
  ('EU-CJEU',      'Court of Justice of the European Union',       'CJEU',   'supreme',     'European Union',    'EU', FALSE),
  ('EU-GC',        'General Court of the European Union',          'EGC',    'appellate',   'European Union',    'EU', FALSE),
  ('EU-ECTHR',     'European Court of Human Rights',               'ECTHR',  'international','Council of Europe', 'EU', FALSE),
  -- Singapore
  ('SG-CA',        'Singapore Court of Appeal',                    'SGCA',   'supreme',     'Singapore',         'SG', TRUE),
  ('SG-HC',        'General Division of the High Court',           'SGHC',   'high',        'Singapore',         'SG', TRUE),
  ('SG-SICC',      'Singapore International Commercial Court',      'SICC',   'specialized', 'Singapore',         'SG', TRUE),
  ('SG-STATE',     'State Courts of Singapore',                    'SGSTATE','court',       'Singapore',         'SG', TRUE),
  ('SG-FJC',       'Family Justice Courts',                        'SGFJC',  'specialized', 'Singapore',         'SG', TRUE),
  -- Gulf Cooperation Council
  ('GC-UAE-FSC',   'UAE Federal Supreme Court',                    'UAEFSC', 'supreme',     'United Arab Emirates','GC', FALSE),
  ('GC-DIFC',      'DIFC Courts',                                  'DIFC',   'specialized', 'Dubai (UAE)',       'GC', TRUE),
  ('GC-ADGM',      'ADGM Courts',                                  'ADGM',   'specialized', 'Abu Dhabi (UAE)',   'GC', TRUE),
  ('GC-SA-SC',     'Supreme Court (Saudi Arabia)',                 'SASC',   'supreme',     'Saudi Arabia',      'GC', FALSE),
  ('GC-SA-BOG',    'Board of Grievances (Diwan al-Mazalim)',       'SABOG',  'specialized', 'Saudi Arabia',      'GC', FALSE),
  ('GC-QA-QIC',    'Qatar International Court',                     'QICDRC', 'specialized', 'Qatar',             'GC', FALSE),
  ('GC-BH-CC',     'Court of Cassation (Bahrain)',                 'BHCC',   'supreme',     'Bahrain',           'GC', FALSE),
  ('GC-KW-CC',     'Court of Cassation (Kuwait)',                  'KWCC',   'supreme',     'Kuwait',            'GC', FALSE),
  ('GC-OM-SC',     'Supreme Court (Oman)',                         'OMSC',   'supreme',     'Oman',              'GC', FALSE)
ON CONFLICT (court_id) DO UPDATE
  SET name = EXCLUDED.name,
      code = EXCLUDED.code,
      court_type = EXCLUDED.court_type,
      state = EXCLUDED.state,
      jurisdiction = EXCLUDED.jurisdiction,
      e_filing_enabled = EXCLUDED.e_filing_enabled,
      is_active = TRUE;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Grant runtime role (nv_app) read/write so the gateway can read these.
--    Guarded on the role existing so the checked-in migration set stays
--    self-contained on a fresh `createdb + psql -f` run (where nv_app is not
--    provisioned). On the live RDS the role exists and grants apply.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nv_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.nv_llm_providers TO nv_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.nv_courts TO nv_app';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.nv_llm_providers_id_seq TO nv_app';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.nv_courts_id_seq TO nv_app';
  END IF;
END $$;
