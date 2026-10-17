-- NV-DC-STATUS-DECODE-001 (2026-09-25b) — widen the DC case-status STRING master.
--
-- Boundary B (user GO): WebSearch + NJDG docs confirm there is NO downloadable
-- national numeric `t_case_status` master (NJDG National-Master exports cover
-- case-type/purpose/adjourn/disposal/act only; the eCourts numeric status is an
-- establishment-scoped CIS FK). The public eCourtsIndia enum publishes 71
-- **string** status codes (2026-09-23 snapshot). We therefore seed the verifiable
-- STRING taxonomy (numeric_code stays NULL — no fabrication) to widen text-status
-- decode coverage beyond the original 13 rows. Numeric decode remains pending an
-- authoritative numeric master; the prior read-only RDS probe (Session-79, SSM
-- 61a81bbb) proved corpus numeric∧text pairs = 0 rows, so no 1:1 crosswalk is
-- derivable from the corpus either. Idempotent; extends 2026-09-25-nv-dc-case-status-codes.sql.
--
-- ssot_source = 'ecourtsindia_taxonomy_2026-09' (string labels; cited public source).

INSERT INTO public.nv_dc_case_status_codes (status_key, numeric_code, label, category, ssot_source) VALUES
  -- Active / Pending
  ('ADMITTED',                NULL, 'Admitted',                       'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('ARGUMENTS',               NULL, 'Arguments',                      'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('PART_HEARD',              NULL, 'Part Heard',                     'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('HEARING',                 NULL, 'Hearing',                        'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('EVIDENCE',                NULL, 'Evidence',                       'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('TRIAL',                   NULL, 'Trial',                          'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('FIRST_HEARING',           NULL, 'First Hearing',                  'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('APPEARANCE',              NULL, 'Appearance',                     'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('NOTICE_ISSUED',           NULL, 'Notice Issued',                  'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('FOR_ADMISSION',           NULL, 'For Admission',                  'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('FOR_JUDGMENT',            NULL, 'For Judgment',                   'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('RESERVED',                NULL, 'Reserved',                       'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('FOR_ORDERS',              NULL, 'For Orders',                     'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('FOR_STEPS',               NULL, 'For Steps',                      'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('REGISTERED',              NULL, 'Registered',                     'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('LISTED',                  NULL, 'Listed',                         'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('MENTIONED',               NULL, 'Mentioned',                      'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('FILED',                   NULL, 'Filed',                          'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('READY_FOR_REGISTRATION',  NULL, 'Ready For Registration',         'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('ADJOURNED',               NULL, 'Adjourned',                      'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('COMPLIANCE_PENDING',      NULL, 'Compliance Pending',             'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('CONTEMPT_PENDING',        NULL, 'Contempt Pending',               'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('CURATIVE_PENDING',        NULL, 'Curative Petition Pending',      'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('EXECUTION_PENDING',       NULL, 'Execution Pending',              'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('LPA_PENDING',             NULL, 'Letters Patent Appeal Pending',  'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('MAINTENANCE_PENDING',     NULL, 'Maintenance Pending',            'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('PIL_PENDING',             NULL, 'PIL Pending',                    'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('REVIEW_PENDING',          NULL, 'Review Pending',                 'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('SERVICE_PENDING',         NULL, 'Service Pending',                'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('PENDING_AFTER_NOTICE',    NULL, 'Pending After Notice',           'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('PENDING_BEFORE_NOTICE',   NULL, 'Pending Before Notice',          'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('INTERIM_ORDER_PASSED',    NULL, 'Interim Order Passed',           'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('FRAMING_OF_ISSUES',       NULL, 'Framing Of Issues',              'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('PLAINTIFF_EVIDENCE',      NULL, 'Plaintiff Evidence',             'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('DEFENCE_EVIDENCE',        NULL, 'Defence Evidence',               'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('PROSECUTION_EVIDENCE',    NULL, 'Prosecution Evidence',           'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('CROSS_EXAMINATION',       NULL, 'Cross Examination',              'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('COUNTER_AFFIDAVIT_FILED', NULL, 'Counter Affidavit Filed',        'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('REJOINDER_FILED',         NULL, 'Rejoinder Filed',                'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('WRITTEN_STATEMENT_FILED', NULL, 'Written Statement Filed',        'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('CHARGE_FRAMED',           NULL, 'Charge Framed',                  'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('SUMMONS_ISSUED',          NULL, 'Summons Issued',                 'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('STAYED',                  NULL, 'Stayed',                         'pending',  'ecourtsindia_taxonomy_2026-09'),
  -- Disposed / Final
  ('PARTLY_ALLOWED',          NULL, 'Partly Allowed',                 'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('REMANDED',                NULL, 'Remanded',                       'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('CLOSED',                  NULL, 'Closed',                         'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('DISMISSED_AS_WITHDRAWN',  NULL, 'Dismissed As Withdrawn',         'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('DISMISSED_IN_DEFAULT',    NULL, 'Dismissed In Default',           'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('DISMISSED_NO_COSTS',      NULL, 'Dismissed Without Costs',        'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('ALLOWED_NO_COSTS',        NULL, 'Allowed Without Costs',          'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('NOT_ADMITTED',            NULL, 'Not Admitted',                   'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('REJECTED',                NULL, 'Rejected',                       'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('INFRUCTUOUS',             NULL, 'Infructuous',                    'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('JUDGMENT',                NULL, 'Judgment Delivered',             'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('RULE_ABSOLUTE',           NULL, 'Rule Absolute',                  'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('RULE_DISCHARGED',         NULL, 'Rule Discharged',                'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('BAIL_GRANTED',            NULL, 'Bail Granted',                   'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('BAIL_REJECTED',           NULL, 'Bail Rejected',                  'disposed', 'ecourtsindia_taxonomy_2026-09'),
  -- Special / ADR
  ('LOK_ADALAT',              NULL, 'Lok Adalat Settlement',          'disposed', 'ecourtsindia_taxonomy_2026-09'),
  ('MEDIATION',               NULL, 'Referred To Mediation',          'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('DEFECTIVE',               NULL, 'Defective',                      'pending',  'ecourtsindia_taxonomy_2026-09'),
  ('UNKNOWN',                 NULL, 'Unknown',                        'unknown',  'ecourtsindia_taxonomy_2026-09')
ON CONFLICT (status_key) DO UPDATE
  SET label       = EXCLUDED.label,
      category    = EXCLUDED.category,
      ssot_source = EXCLUDED.ssot_source,
      updated_at  = NOW();
