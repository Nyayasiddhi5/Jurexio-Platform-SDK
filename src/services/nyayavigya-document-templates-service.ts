/**
 * Jurexio Indian Legal Document Templates Service
 * 
 * Comprehensive legal document templates for Indian jurisdiction:
 * - FIR templates
 * - Court orders
 * - Affidavits
 * - Contracts
 * - Legal notices
 * - Petitions and plaints
 */

export interface DocumentTemplate {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  description: string;
  fields: TemplateField[];
  template: string;
  jurisdiction: string;
  language: string;
  version: string;
  lastUpdated: string;
}

export interface TemplateField {
  id: string;
  label: string;
  type: 'text' | 'date' | 'number' | 'select' | 'textarea' | 'checkbox' | 'address' | 'party';
  required: boolean;
  placeholder?: string;
  options?: string[];
  validation?: string;
  defaultValue?: string;
}

export interface GeneratedDocument {
  id: string;
  templateId: string;
  content: string;
  format: 'text' | 'html' | 'markdown' | 'pdf';
  metadata: {
    generatedAt: Date;
    fields: Record<string, any>;
    wordCount: number;
    pageCount: number;
  };
}

const INDIAN_LEGAL_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'fir_template',
    name: 'First Information Report (FIR)',
    category: 'Criminal Law',
    subcategory: 'Police Complaints',
    description: 'Template for filing FIR at police station under CrPC/BNSS',
    jurisdiction: 'India',
    language: 'en',
    version: '2.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'police_station', label: 'Police Station Name', type: 'text', required: true },
      { id: 'district', label: 'District', type: 'text', required: true },
      { id: 'state', label: 'State', type: 'text', required: true },
      { id: 'complainant_name', label: 'Complainant Name', type: 'text', required: true },
      { id: 'complainant_address', label: 'Complainant Address', type: 'address', required: true },
      { id: 'incident_date', label: 'Date of Incident', type: 'date', required: true },
      { id: 'incident_time', label: 'Time of Incident', type: 'text', required: false },
      { id: 'incident_place', label: 'Place of Incident', type: 'textarea', required: true },
      { id: 'accused_details', label: 'Details of Accused (if known)', type: 'textarea', required: false },
      { id: 'incident_description', label: 'Description of Incident', type: 'textarea', required: true },
      { id: 'sections', label: 'Applicable Sections', type: 'text', required: false, placeholder: 'e.g., Section 302 BNS' },
      { id: 'witnesses', label: 'Witness Details', type: 'textarea', required: false },
      { id: 'evidence', label: 'Evidence/Documents', type: 'textarea', required: false }
    ],
    template: `FIRST INFORMATION REPORT (FIR)

Police Station: {{police_station}}
District: {{district}}, State: {{state}}

Date of FIR: {{current_date}}
FIR No: _______________

COMPLAINANT DETAILS:
Name: {{complainant_name}}
Address: {{complainant_address}}

INCIDENT DETAILS:
Date: {{incident_date}}
Time: {{incident_time}}
Place: {{incident_place}}

DETAILS OF ACCUSED (if known):
{{accused_details}}

DESCRIPTION OF INCIDENT:
{{incident_description}}

APPLICABLE SECTIONS:
{{sections}}

WITNESSES:
{{witnesses}}

EVIDENCE/DOCUMENTS:
{{evidence}}

I hereby declare that the above information is true and correct to the best of my knowledge.

Signature of Complainant: _______________
Date: {{current_date}}

Received by:
Name & Designation: _______________
Signature: _______________
Date & Time: _______________`
  },
  {
    id: 'affidavit_general',
    name: 'General Affidavit',
    category: 'General',
    description: 'General purpose affidavit for sworn statements',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'deponent_name', label: 'Deponent Name', type: 'text', required: true },
      { id: 'father_name', label: 'Father\'s/Husband\'s Name', type: 'text', required: true },
      { id: 'age', label: 'Age', type: 'number', required: true },
      { id: 'address', label: 'Address', type: 'address', required: true },
      { id: 'occupation', label: 'Occupation', type: 'text', required: true },
      { id: 'purpose', label: 'Purpose of Affidavit', type: 'text', required: true },
      { id: 'statements', label: 'Sworn Statements', type: 'textarea', required: true },
      { id: 'place', label: 'Place', type: 'text', required: true }
    ],
    template: `AFFIDAVIT

I, {{deponent_name}}, S/o / D/o / W/o {{father_name}}, aged {{age}} years, residing at {{address}}, occupation {{occupation}}, do hereby solemnly affirm and declare as follows:

PURPOSE: {{purpose}}

STATEMENTS:
{{statements}}

I hereby declare that the contents of this affidavit are true and correct to the best of my knowledge and belief, and nothing material has been concealed therefrom.

VERIFICATION
I, the above-named deponent, do hereby verify that the contents of paragraphs above are true and correct to the best of my knowledge and belief and nothing material has been concealed therefrom.

Verified at {{place}} on this {{current_date}}.

DEPONENT
Signature: _______________
Name: {{deponent_name}}

BEFORE ME:
Notary Public / Oath Commissioner
Signature: _______________
Seal: _______________`
  },
  {
    id: 'legal_notice',
    name: 'Legal Notice',
    category: 'Civil Law',
    description: 'Legal notice template for civil matters',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'sender_name', label: 'Sender Name', type: 'text', required: true },
      { id: 'sender_address', label: 'Sender Address', type: 'address', required: true },
      { id: 'recipient_name', label: 'Recipient Name', type: 'text', required: true },
      { id: 'recipient_address', label: 'Recipient Address', type: 'address', required: true },
      { id: 'subject', label: 'Subject', type: 'text', required: true },
      { id: 'facts', label: 'Facts of the Matter', type: 'textarea', required: true },
      { id: 'demands', label: 'Demands/Relief Sought', type: 'textarea', required: true },
      { id: 'reply_period', label: 'Reply Period (days)', type: 'number', required: true, defaultValue: '15' },
      { id: 'advocate_name', label: 'Advocate Name', type: 'text', required: true },
      { id: 'bar_council_no', label: 'Bar Council Number', type: 'text', required: true }
    ],
    template: `LEGAL NOTICE

Date: {{current_date}}

To,
{{recipient_name}}
{{recipient_address}}

Subject: {{subject}}

UNDER INSTRUCTIONS AND ON BEHALF OF MY CLIENT:
{{sender_name}}
{{sender_address}}

Dear Sir/Madam,

I, {{advocate_name}}, Advocate, having enrollment No. {{bar_council_no}}, do hereby serve upon you the following Legal Notice on behalf of my above-named client:

FACTS OF THE MATTER:
{{facts}}

DEMANDS/RELIEF SOUGHT:
{{demands}}

You are hereby called upon to comply with the above demands within {{reply_period}} days from the receipt of this notice, failing which my client shall be constrained to initiate appropriate legal proceedings against you, civil and/or criminal, at your risk, cost and consequences.

This notice is issued without prejudice to all other rights and remedies available to my client under law.

Yours faithfully,

{{advocate_name}}
Advocate
Enrollment No.: {{bar_council_no}}

On behalf of: {{sender_name}}`
  },
  {
    id: 'sale_deed',
    name: 'Sale Deed',
    category: 'Property Law',
    description: 'Property sale deed template',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'vendor_name', label: 'Vendor (Seller) Name', type: 'text', required: true },
      { id: 'vendor_address', label: 'Vendor Address', type: 'address', required: true },
      { id: 'vendee_name', label: 'Vendee (Buyer) Name', type: 'text', required: true },
      { id: 'vendee_address', label: 'Vendee Address', type: 'address', required: true },
      { id: 'property_description', label: 'Property Description', type: 'textarea', required: true },
      { id: 'property_address', label: 'Property Address', type: 'address', required: true },
      { id: 'sale_consideration', label: 'Sale Consideration (Amount)', type: 'number', required: true },
      { id: 'payment_mode', label: 'Mode of Payment', type: 'text', required: true },
      { id: 'stamp_duty', label: 'Stamp Duty Amount', type: 'number', required: true }
    ],
    template: `SALE DEED

This Sale Deed is executed on {{current_date}}

BETWEEN:

VENDOR (SELLER):
Name: {{vendor_name}}
Address: {{vendor_address}}
(hereinafter called the "VENDOR", which expression shall include heirs, executors, administrators and assigns)

AND

VENDEE (BUYER):
Name: {{vendee_name}}
Address: {{vendee_address}}
(hereinafter called the "VENDEE", which expression shall include heirs, executors, administrators and assigns)

PROPERTY DESCRIPTION:
{{property_description}}

Property Address: {{property_address}}

SALE CONSIDERATION:
Rs. {{sale_consideration}}/- (Rupees _________________________ only)

MODE OF PAYMENT: {{payment_mode}}

STAMP DUTY PAID: Rs. {{stamp_duty}}/-

TERMS AND CONDITIONS:
[Standard sale deed terms would be inserted here]

IN WITNESS WHEREOF, the parties have set their hands on the day, month and year first above written.

VENDOR:
Signature: _______________
Name: {{vendor_name}}

VENDEE:
Signature: _______________
Name: {{vendee_name}}

WITNESSES:
1. Name: _______________ Signature: _______________
2. Name: _______________ Signature: _______________`
  },
  {
    id: 'vakalatnama',
    name: 'Vakalatnama',
    category: 'Court Documents',
    description: 'Power of attorney for court representation',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'court_name', label: 'Court Name', type: 'text', required: true },
      { id: 'case_type', label: 'Case Type', type: 'select', required: true, options: ['Civil', 'Criminal', 'Writ', 'Appeal', 'Revision'] },
      { id: 'case_number', label: 'Case Number', type: 'text', required: false },
      { id: 'client_name', label: 'Client Name', type: 'text', required: true },
      { id: 'client_address', label: 'Client Address', type: 'address', required: true },
      { id: 'advocate_name', label: 'Advocate Name', type: 'text', required: true },
      { id: 'bar_council_no', label: 'Bar Council Number', type: 'text', required: true },
      { id: 'advocate_address', label: 'Advocate Address', type: 'address', required: true },
      { id: 'opposite_party', label: 'Opposite Party', type: 'text', required: true }
    ],
    template: `VAKALATNAMA

IN THE {{court_name}}

{{case_type}} Case No.: {{case_number}}

{{client_name}} ............. Petitioner/Plaintiff/Appellant
Versus
{{opposite_party}} ............. Respondent/Defendant

I/We, {{client_name}}, residing at {{client_address}}, do hereby appoint and authorize {{advocate_name}}, Advocate, having enrollment No. {{bar_council_no}}, with address at {{advocate_address}}, to appear, act, plead and conduct the above case on my/our behalf.

I/We authorize the said Advocate to:
1. Appear in court and represent me/us
2. File applications, petitions, and documents
3. Examine and cross-examine witnesses
4. Make statements and admissions
5. Receive notices and summons
6. Compromise, settle, or withdraw the case with my/our consent
7. Engage another advocate if necessary

I/We agree to pay the professional fees as agreed upon.

Dated: {{current_date}}

Client:
Signature: _______________
Name: {{client_name}}

Accepted:
Signature: _______________
Name: {{advocate_name}}
Enrollment No.: {{bar_council_no}}`
  },
  {
    id: 'bail_application',
    name: 'Bail Application',
    category: 'Criminal Law',
    description: 'Application for bail under CrPC/BNSS',
    jurisdiction: 'India',
    language: 'en',
    version: '2.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'court_name', label: 'Court Name', type: 'text', required: true },
      { id: 'fir_number', label: 'FIR Number', type: 'text', required: true },
      { id: 'police_station', label: 'Police Station', type: 'text', required: true },
      { id: 'sections', label: 'Sections Charged', type: 'text', required: true },
      { id: 'accused_name', label: 'Accused Name', type: 'text', required: true },
      { id: 'accused_address', label: 'Accused Address', type: 'address', required: true },
      { id: 'custody_date', label: 'Date of Custody', type: 'date', required: true },
      { id: 'grounds', label: 'Grounds for Bail', type: 'textarea', required: true },
      { id: 'surety_details', label: 'Surety Details', type: 'textarea', required: true }
    ],
    template: `IN THE {{court_name}}

BAIL APPLICATION
Under Section 439 of CrPC / Section 483 of BNSS

FIR No.: {{fir_number}}
Police Station: {{police_station}}
Under Sections: {{sections}}

IN THE MATTER OF:
{{accused_name}} ............. Applicant/Accused

APPLICATION FOR BAIL

RESPECTFULLY SHOWETH:

1. That the applicant {{accused_name}} has been arrested in connection with FIR No. {{fir_number}} dated __________ registered at Police Station {{police_station}}.

2. That the applicant has been in custody since {{custody_date}}.

3. Address of the Applicant: {{accused_address}}

GROUNDS FOR BAIL:
{{grounds}}

SURETY DETAILS:
{{surety_details}}

PRAYER:
It is, therefore, most respectfully prayed that this Hon'ble Court may be pleased to:
(a) Grant regular bail to the applicant in the above-mentioned case;
(b) Pass any other order as this Hon'ble Court may deem fit and proper in the interest of justice.

Date: {{current_date}}
Place: _______________

Applicant/Accused
Through Counsel

VERIFICATION:
I, {{accused_name}}, do hereby verify that the contents of this application are true and correct to the best of my knowledge and belief.

Verified at _______________ on {{current_date}}.

Applicant`
  },
  {
    id: 'writ_petition_art226',
    name: 'Writ Petition (Article 226)',
    category: 'Constitutional Law',
    subcategory: 'High Court',
    description: 'Writ petition under Article 226 of the Constitution of India before the High Court',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'high_court', label: 'High Court Name', type: 'text', required: true, placeholder: 'e.g., Hon\'ble High Court of Delhi' },
      { id: 'writ_type', label: 'Type of Writ', type: 'select', required: true, options: ['Habeas Corpus', 'Mandamus', 'Certiorari', 'Prohibition', 'Quo Warranto'] },
      { id: 'petitioner_name', label: 'Petitioner Name', type: 'text', required: true },
      { id: 'petitioner_address', label: 'Petitioner Address', type: 'address', required: true },
      { id: 'respondent_name', label: 'Respondent Name', type: 'text', required: true },
      { id: 'respondent_designation', label: 'Respondent Designation', type: 'text', required: true },
      { id: 'facts', label: 'Statement of Facts', type: 'textarea', required: true },
      { id: 'grounds', label: 'Grounds', type: 'textarea', required: true },
      { id: 'fundamental_rights', label: 'Fundamental Rights Violated', type: 'text', required: true, placeholder: 'e.g., Article 14, 19, 21' },
      { id: 'prayer', label: 'Prayer/Relief Sought', type: 'textarea', required: true },
      { id: 'advocate_name', label: 'Advocate Name', type: 'text', required: true }
    ],
    template: `IN THE HON'BLE {{high_court}}
(WRIT JURISDICTION)

WRIT PETITION (CIVIL/CRIMINAL) NO. _______ OF _______

IN THE MATTER OF:
{{petitioner_name}} ............. Petitioner
Versus
{{respondent_name}}, {{respondent_designation}} ............. Respondent(s)

WRIT PETITION UNDER ARTICLE 226 OF THE CONSTITUTION OF INDIA
FOR ISSUANCE OF A WRIT OF {{writ_type}}

To,
THE HON'BLE CHIEF JUSTICE AND HIS COMPANION JUDGES OF THE {{high_court}}

THE HUMBLE PETITION OF THE PETITIONER ABOVE-NAMED

MOST RESPECTFULLY SHOWETH:

1. That the petitioner is a citizen of India and is filing this petition under Article 226 of the Constitution of India seeking a writ of {{writ_type}}.

2. That the petitioner resides at {{petitioner_address}}.

STATEMENT OF FACTS:
{{facts}}

GROUNDS:
{{grounds}}

FUNDAMENTAL RIGHTS VIOLATED:
The impugned action/order violates the fundamental rights of the petitioner guaranteed under {{fundamental_rights}} of the Constitution of India.

PRAYER:
In the facts and circumstances stated above, it is most respectfully prayed that this Hon'ble Court may graciously be pleased to:
{{prayer}}

And pass such other and further order(s) as this Hon'ble Court may deem fit and proper in the interest of justice.

AND FOR THIS ACT OF KINDNESS THE PETITIONER AS IS DUTY BOUND SHALL EVER PRAY.

Date: {{current_date}}
Place: _______________

{{advocate_name}}
Advocate for the Petitioner

VERIFICATION:
I, {{petitioner_name}}, the petitioner above-named, do hereby verify that the contents of paragraphs ___ to ___ are true and correct to the best of my knowledge and belief.

Verified at _______________ on {{current_date}}.

Petitioner`
  },
  {
    id: 'slp_supreme_court',
    name: 'Special Leave Petition (SLP)',
    category: 'Constitutional Law',
    subcategory: 'Supreme Court',
    description: 'Special Leave Petition under Article 136 of the Constitution before the Supreme Court of India',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'petitioner_name', label: 'Petitioner Name', type: 'text', required: true },
      { id: 'respondent_name', label: 'Respondent Name', type: 'text', required: true },
      { id: 'impugned_order', label: 'Details of Impugned Order', type: 'textarea', required: true },
      { id: 'high_court', label: 'Court which passed the impugned order', type: 'text', required: true },
      { id: 'case_number_below', label: 'Case Number in Court Below', type: 'text', required: true },
      { id: 'date_of_order', label: 'Date of Impugned Order', type: 'date', required: true },
      { id: 'questions_of_law', label: 'Substantial Questions of Law', type: 'textarea', required: true },
      { id: 'grounds', label: 'Grounds for Special Leave', type: 'textarea', required: true },
      { id: 'prayer', label: 'Prayer', type: 'textarea', required: true },
      { id: 'advocate_on_record', label: 'Advocate on Record (AOR)', type: 'text', required: true }
    ],
    template: `IN THE SUPREME COURT OF INDIA
CIVIL/CRIMINAL APPELLATE JURISDICTION

SPECIAL LEAVE PETITION (CIVIL/CRIMINAL) NO. _______ OF _______

(Arising out of the impugned final judgment and order dated {{date_of_order}} passed by the {{high_court}} in {{case_number_below}})

{{petitioner_name}} ............. Petitioner(s)
Versus
{{respondent_name}} ............. Respondent(s)

PETITION FOR SPECIAL LEAVE TO APPEAL UNDER ARTICLE 136 OF THE CONSTITUTION OF INDIA

TO,
THE HON'BLE THE CHIEF JUSTICE OF INDIA AND HIS COMPANION JUDGES OF THE SUPREME COURT OF INDIA

THE HUMBLE PETITION OF THE PETITIONER(S) ABOVE NAMED

MOST RESPECTFULLY SHOWETH:

1. The petitioner(s) is/are aggrieved by the impugned order dated {{date_of_order}} passed by the {{high_court}} in {{case_number_below}}.

DETAILS OF IMPUGNED ORDER:
{{impugned_order}}

SUBSTANTIAL QUESTIONS OF LAW:
{{questions_of_law}}

GROUNDS FOR SPECIAL LEAVE:
{{grounds}}

PRAYER:
{{prayer}}

AND FOR THIS ACT OF KINDNESS, THE PETITIONER(S) SHALL EVER PRAY.

Filed by:
{{advocate_on_record}}
Advocate on Record for the Petitioner(s)

Date: {{current_date}}
New Delhi`
  },
  {
    id: 'pil_petition',
    name: 'Public Interest Litigation (PIL)',
    category: 'Constitutional Law',
    subcategory: 'High Court / Supreme Court',
    description: 'Public Interest Litigation petition template',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'court_name', label: 'Court Name', type: 'text', required: true },
      { id: 'petitioner_name', label: 'Petitioner Name', type: 'text', required: true },
      { id: 'petitioner_description', label: 'Petitioner Description', type: 'textarea', required: true },
      { id: 'respondent_details', label: 'Respondent Details', type: 'textarea', required: true },
      { id: 'public_issue', label: 'Public Issue/Grievance', type: 'textarea', required: true },
      { id: 'facts', label: 'Statement of Facts', type: 'textarea', required: true },
      { id: 'legal_provisions', label: 'Legal Provisions Violated', type: 'textarea', required: true },
      { id: 'prayer', label: 'Prayer/Directions Sought', type: 'textarea', required: true },
      { id: 'advocate_name', label: 'Advocate Name', type: 'text', required: true }
    ],
    template: `IN THE {{court_name}}
(PUBLIC INTEREST LITIGATION JURISDICTION)

WRIT PETITION (PIL) NO. _______ OF _______

IN THE MATTER OF:
{{petitioner_name}} ............. Petitioner
Versus
{{respondent_details}} ............. Respondent(s)

PUBLIC INTEREST LITIGATION UNDER ARTICLE 226/32 OF THE CONSTITUTION OF INDIA

MOST RESPECTFULLY SHOWETH:

1. ABOUT THE PETITIONER:
{{petitioner_description}}

2. The petitioner has no personal interest in the outcome of this petition and is filing this petition in larger public interest.

3. PUBLIC ISSUE:
{{public_issue}}

4. STATEMENT OF FACTS:
{{facts}}

5. LEGAL PROVISIONS VIOLATED:
{{legal_provisions}}

PRAYER:
In the facts and circumstances mentioned above, it is most respectfully prayed that this Hon'ble Court may be pleased to:
{{prayer}}

And pass such other and further order(s) as may be deemed fit and proper in the interest of justice.

Date: {{current_date}}

{{advocate_name}}
Advocate for the Petitioner`
  },
  {
    id: 'civil_suit_plaint',
    name: 'Civil Suit Plaint',
    category: 'Civil Law',
    subcategory: 'District Court',
    description: 'Plaint for filing a civil suit under Order VII Rule 1 CPC',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'court_name', label: 'Court Name', type: 'text', required: true },
      { id: 'suit_type', label: 'Type of Suit', type: 'select', required: true, options: ['Recovery of Money', 'Specific Performance', 'Declaration', 'Injunction', 'Partition', 'Possession', 'Damages'] },
      { id: 'plaintiff_name', label: 'Plaintiff Name', type: 'text', required: true },
      { id: 'plaintiff_address', label: 'Plaintiff Address', type: 'address', required: true },
      { id: 'defendant_name', label: 'Defendant Name', type: 'text', required: true },
      { id: 'defendant_address', label: 'Defendant Address', type: 'address', required: true },
      { id: 'cause_of_action', label: 'Cause of Action', type: 'textarea', required: true },
      { id: 'facts', label: 'Material Facts', type: 'textarea', required: true },
      { id: 'relief_sought', label: 'Relief Sought', type: 'textarea', required: true },
      { id: 'suit_value', label: 'Suit Valuation (Rs.)', type: 'number', required: true },
      { id: 'court_fee', label: 'Court Fee Paid (Rs.)', type: 'number', required: true },
      { id: 'advocate_name', label: 'Advocate Name', type: 'text', required: true }
    ],
    template: `IN THE COURT OF {{court_name}}

CIVIL SUIT NO. _______ OF _______
(Suit for {{suit_type}})

{{plaintiff_name}} ............. Plaintiff
Address: {{plaintiff_address}}

Versus

{{defendant_name}} ............. Defendant
Address: {{defendant_address}}

SUIT VALUATION: Rs. {{suit_value}}/-
COURT FEE PAID: Rs. {{court_fee}}/-

PLAINT UNDER ORDER VII RULE 1 OF CPC

The plaintiff above-named most respectfully submits as follows:

1. That the plaintiff is a citizen of India residing at the above-mentioned address.

2. That the defendant is residing/carrying on business at the above-mentioned address.

CAUSE OF ACTION:
{{cause_of_action}}

MATERIAL FACTS:
{{facts}}

JURISDICTION:
This Hon'ble Court has territorial and pecuniary jurisdiction to try this suit as the cause of action has arisen within the jurisdiction of this Court.

LIMITATION:
The suit is within the period of limitation prescribed under the Limitation Act, 1963.

RELIEF SOUGHT:
{{relief_sought}}

PRAYER:
In the facts and circumstances stated above, it is most respectfully prayed that this Hon'ble Court may be pleased to:
(a) Pass a decree in favour of the plaintiff and against the defendant;
(b) Award cost of this suit to the plaintiff;
(c) Pass any other order as this Hon'ble Court may deem fit and proper.

Date: {{current_date}}
Place: _______________

{{advocate_name}}
Advocate for the Plaintiff

VERIFICATION:
I, {{plaintiff_name}}, the plaintiff above-named, do hereby verify that the contents of this plaint are true and correct to the best of my knowledge and belief.

Verified at _______________ on {{current_date}}.

Plaintiff`
  },
  {
    id: 'written_statement',
    name: 'Written Statement (Defence)',
    category: 'Civil Law',
    subcategory: 'District Court',
    description: 'Written statement in defence under Order VIII Rule 1 CPC',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'court_name', label: 'Court Name', type: 'text', required: true },
      { id: 'suit_number', label: 'Suit Number', type: 'text', required: true },
      { id: 'plaintiff_name', label: 'Plaintiff Name', type: 'text', required: true },
      { id: 'defendant_name', label: 'Defendant Name', type: 'text', required: true },
      { id: 'defendant_address', label: 'Defendant Address', type: 'address', required: true },
      { id: 'preliminary_objections', label: 'Preliminary Objections', type: 'textarea', required: false },
      { id: 'parawise_reply', label: 'Para-wise Reply to Plaint', type: 'textarea', required: true },
      { id: 'additional_facts', label: 'Additional Facts in Defence', type: 'textarea', required: false },
      { id: 'advocate_name', label: 'Advocate Name', type: 'text', required: true }
    ],
    template: `IN THE COURT OF {{court_name}}

CIVIL SUIT NO.: {{suit_number}}

{{plaintiff_name}} ............. Plaintiff
Versus
{{defendant_name}} ............. Defendant

WRITTEN STATEMENT ON BEHALF OF THE DEFENDANT
Under Order VIII Rule 1 of the Code of Civil Procedure, 1908

The defendant above-named most respectfully submits as follows:

PRELIMINARY OBJECTIONS:
{{preliminary_objections}}

PARA-WISE REPLY TO THE PLAINT:
{{parawise_reply}}

ADDITIONAL FACTS IN DEFENCE:
{{additional_facts}}

PRAYER:
It is most respectfully prayed that this Hon'ble Court may be pleased to:
(a) Dismiss the suit of the plaintiff with costs;
(b) Pass any other order as this Hon'ble Court may deem fit and proper.

Date: {{current_date}}
Place: _______________

{{advocate_name}}
Advocate for the Defendant

VERIFICATION:
I, {{defendant_name}}, the defendant above-named, residing at {{defendant_address}}, do hereby verify that the contents of this written statement are true and correct to the best of my knowledge and belief.

Verified at _______________ on {{current_date}}.

Defendant`
  },
  {
    id: 'appeal_memo',
    name: 'Memorandum of Appeal',
    category: 'Civil Law',
    subcategory: 'Appellate Court',
    description: 'Memorandum of appeal under Section 96 CPC / Order XLI Rule 1',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'appellate_court', label: 'Appellate Court Name', type: 'text', required: true },
      { id: 'appellant_name', label: 'Appellant Name', type: 'text', required: true },
      { id: 'respondent_name', label: 'Respondent Name', type: 'text', required: true },
      { id: 'lower_court', label: 'Court Below', type: 'text', required: true },
      { id: 'suit_number_below', label: 'Suit/Case Number Below', type: 'text', required: true },
      { id: 'decree_date', label: 'Date of Decree/Judgment', type: 'date', required: true },
      { id: 'grounds_of_appeal', label: 'Grounds of Appeal', type: 'textarea', required: true },
      { id: 'prayer', label: 'Prayer', type: 'textarea', required: true },
      { id: 'advocate_name', label: 'Advocate Name', type: 'text', required: true }
    ],
    template: `IN THE {{appellate_court}}

FIRST APPEAL NO. _______ OF _______
(Against the judgment and decree dated {{decree_date}} passed by {{lower_court}} in {{suit_number_below}})

{{appellant_name}} ............. Appellant
Versus
{{respondent_name}} ............. Respondent

MEMORANDUM OF APPEAL UNDER SECTION 96 / ORDER XLI RULE 1 CPC

The appellant above-named most respectfully submits as follows:

1. That the learned trial court passed the impugned judgment and decree dated {{decree_date}} in {{suit_number_below}}, which is erroneous both in law and on facts.

GROUNDS OF APPEAL:
The impugned judgment and decree is liable to be set aside on the following grounds:

{{grounds_of_appeal}}

PRAYER:
{{prayer}}

Date: {{current_date}}

{{advocate_name}}
Advocate for the Appellant`
  },
  {
    id: 'cheque_bounce_complaint',
    name: 'Complaint under Section 138 NI Act',
    category: 'Criminal Law',
    subcategory: 'Magistrate Court',
    description: 'Complaint for dishonour of cheque under Section 138 of the Negotiable Instruments Act',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'court_name', label: 'Court Name', type: 'text', required: true },
      { id: 'complainant_name', label: 'Complainant Name', type: 'text', required: true },
      { id: 'complainant_address', label: 'Complainant Address', type: 'address', required: true },
      { id: 'accused_name', label: 'Accused Name', type: 'text', required: true },
      { id: 'accused_address', label: 'Accused Address', type: 'address', required: true },
      { id: 'cheque_number', label: 'Cheque Number', type: 'text', required: true },
      { id: 'cheque_date', label: 'Cheque Date', type: 'date', required: true },
      { id: 'cheque_amount', label: 'Cheque Amount (Rs.)', type: 'number', required: true },
      { id: 'bank_name', label: 'Drawn on Bank', type: 'text', required: true },
      { id: 'dishonour_date', label: 'Date of Dishonour', type: 'date', required: true },
      { id: 'dishonour_reason', label: 'Reason for Dishonour', type: 'text', required: true },
      { id: 'notice_date', label: 'Date of Demand Notice', type: 'date', required: true },
      { id: 'purpose_of_cheque', label: 'Purpose/Consideration for Cheque', type: 'textarea', required: true },
      { id: 'advocate_name', label: 'Advocate Name', type: 'text', required: true }
    ],
    template: `IN THE COURT OF {{court_name}}

COMPLAINT CASE NO. _______ OF _______
Under Section 138 read with Sections 141 and 142 of the Negotiable Instruments Act, 1881

{{complainant_name}} ............. Complainant
Address: {{complainant_address}}

Versus

{{accused_name}} ............. Accused
Address: {{accused_address}}

COMPLAINT UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS ACT, 1881

The complainant above-named most respectfully submits as follows:

1. That the accused issued a cheque bearing No. {{cheque_number}} dated {{cheque_date}} for Rs. {{cheque_amount}}/- drawn on {{bank_name}} in favour of the complainant.

2. PURPOSE/CONSIDERATION: {{purpose_of_cheque}}

3. That the said cheque was presented for encashment but was dishonoured/returned unpaid on {{dishonour_date}} with the endorsement: "{{dishonour_reason}}".

4. That on receipt of the dishonour memo, the complainant issued a legal demand notice dated {{notice_date}} to the accused demanding payment of the cheque amount within 15 days from the date of receipt of the said notice.

5. That despite receipt of the said notice, the accused has failed to make payment of the said amount within the statutory period of 15 days, thereby committing an offence punishable under Section 138 of the Negotiable Instruments Act, 1881.

PRAYER:
It is most respectfully prayed that this Hon'ble Court may be pleased to:
(a) Take cognizance of the offence under Section 138 of the NI Act;
(b) Summon the accused to face trial;
(c) Convict and sentence the accused;
(d) Direct the accused to pay compensation under Section 357 CrPC;
(e) Pass any other order as deemed fit.

Date: {{current_date}}

{{advocate_name}}
Advocate for the Complainant`
  },
  {
    id: 'consumer_complaint',
    name: 'Consumer Complaint',
    category: 'Consumer Law',
    subcategory: 'Consumer Forum',
    description: 'Complaint before Consumer Disputes Redressal Commission under Consumer Protection Act 2019',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'commission_name', label: 'Consumer Commission', type: 'select', required: true, options: ['District Consumer Disputes Redressal Commission', 'State Consumer Disputes Redressal Commission', 'National Consumer Disputes Redressal Commission'] },
      { id: 'district', label: 'District', type: 'text', required: true },
      { id: 'complainant_name', label: 'Complainant Name', type: 'text', required: true },
      { id: 'complainant_address', label: 'Complainant Address', type: 'address', required: true },
      { id: 'opposite_party_name', label: 'Opposite Party Name', type: 'text', required: true },
      { id: 'opposite_party_address', label: 'Opposite Party Address', type: 'address', required: true },
      { id: 'product_service', label: 'Product/Service Details', type: 'textarea', required: true },
      { id: 'deficiency_defect', label: 'Deficiency in Service / Defect in Product', type: 'textarea', required: true },
      { id: 'compensation_amount', label: 'Compensation Sought (Rs.)', type: 'number', required: true },
      { id: 'facts', label: 'Statement of Facts', type: 'textarea', required: true }
    ],
    template: `BEFORE THE {{commission_name}}, {{district}}

CONSUMER COMPLAINT NO. _______ OF _______
Under Section 35 of the Consumer Protection Act, 2019

{{complainant_name}} ............. Complainant
Address: {{complainant_address}}

Versus

{{opposite_party_name}} ............. Opposite Party
Address: {{opposite_party_address}}

CONSUMER COMPLAINT

The complainant above-named most respectfully submits as follows:

1. That the complainant is a "consumer" as defined under Section 2(7) of the Consumer Protection Act, 2019.

2. PRODUCT/SERVICE DETAILS: {{product_service}}

3. STATEMENT OF FACTS: {{facts}}

4. DEFICIENCY IN SERVICE / DEFECT IN PRODUCT:
{{deficiency_defect}}

5. That the complainant has suffered loss and mental agony due to the above deficiency/defect.

JURISDICTION:
This Hon'ble Commission has jurisdiction to entertain this complaint as the value of goods/services does not exceed the prescribed limit and the opposite party resides/carries on business within the jurisdiction.

PRAYER:
It is most respectfully prayed that this Hon'ble Commission may be pleased to:
(a) Direct the opposite party to remove the deficiency/replace the defective product;
(b) Direct the opposite party to pay compensation of Rs. {{compensation_amount}}/- to the complainant;
(c) Direct the opposite party to pay cost of litigation;
(d) Pass any other order as deemed fit.

Date: {{current_date}}

Complainant`
  },
  {
    id: 'nclt_company_petition',
    name: 'Company Petition (NCLT)',
    category: 'Corporate Law',
    subcategory: 'NCLT',
    description: 'Company petition before National Company Law Tribunal under Companies Act / IBC',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'nclt_bench', label: 'NCLT Bench', type: 'text', required: true, placeholder: 'e.g., NCLT Mumbai Bench' },
      { id: 'petition_type', label: 'Type of Petition', type: 'select', required: true, options: ['CIRP under Section 7 IBC', 'CIRP under Section 9 IBC', 'CIRP under Section 10 IBC', 'Oppression & Mismanagement (Sec 241-242)', 'Winding Up', 'Scheme of Arrangement (Sec 230-232)'] },
      { id: 'petitioner_name', label: 'Petitioner/Applicant Name', type: 'text', required: true },
      { id: 'petitioner_description', label: 'Petitioner Description', type: 'textarea', required: true },
      { id: 'respondent_company', label: 'Respondent/Corporate Debtor', type: 'text', required: true },
      { id: 'cin', label: 'CIN of Company', type: 'text', required: true },
      { id: 'facts', label: 'Statement of Facts', type: 'textarea', required: true },
      { id: 'default_amount', label: 'Amount of Default (Rs.)', type: 'number', required: false },
      { id: 'prayer', label: 'Prayer/Relief Sought', type: 'textarea', required: true },
      { id: 'advocate_name', label: 'Advocate Name', type: 'text', required: true }
    ],
    template: `BEFORE THE NATIONAL COMPANY LAW TRIBUNAL
{{nclt_bench}}

COMPANY PETITION NO. _______ OF _______
({{petition_type}})

IN THE MATTER OF:
{{petitioner_name}} ............. Petitioner/Applicant
{{petitioner_description}}

AND

IN THE MATTER OF:
{{respondent_company}} (CIN: {{cin}}) ............. Respondent/Corporate Debtor

COMPANY PETITION

The petitioner/applicant above-named most respectfully submits as follows:

STATEMENT OF FACTS:
{{facts}}

AMOUNT OF DEFAULT: Rs. {{default_amount}}/-

PRAYER:
{{prayer}}

Date: {{current_date}}

{{advocate_name}}
Advocate for the Petitioner/Applicant`
  },
  {
    id: 'divorce_petition_mutual',
    name: 'Divorce Petition (Mutual Consent)',
    category: 'Family Law',
    subcategory: 'Family Court',
    description: 'Joint petition for divorce by mutual consent under Section 13B of Hindu Marriage Act',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'court_name', label: 'Family Court', type: 'text', required: true },
      { id: 'husband_name', label: 'Husband Name', type: 'text', required: true },
      { id: 'husband_address', label: 'Husband Address', type: 'address', required: true },
      { id: 'wife_name', label: 'Wife Name', type: 'text', required: true },
      { id: 'wife_address', label: 'Wife Address', type: 'address', required: true },
      { id: 'marriage_date', label: 'Date of Marriage', type: 'date', required: true },
      { id: 'marriage_place', label: 'Place of Marriage', type: 'text', required: true },
      { id: 'separation_date', label: 'Date of Separation', type: 'date', required: true },
      { id: 'children_details', label: 'Details of Children (if any)', type: 'textarea', required: false },
      { id: 'settlement_terms', label: 'Settlement Terms', type: 'textarea', required: true },
      { id: 'maintenance_terms', label: 'Alimony/Maintenance Terms', type: 'textarea', required: true }
    ],
    template: `IN THE FAMILY COURT AT {{court_name}}

HINDU MARRIAGE PETITION NO. _______ OF _______

JOINT PETITION FOR DIVORCE BY MUTUAL CONSENT
Under Section 13B of the Hindu Marriage Act, 1955

Petitioner No. 1 (Husband):
{{husband_name}}, residing at {{husband_address}}

Petitioner No. 2 (Wife):
{{wife_name}}, residing at {{wife_address}}

JOINT PETITION FOR DIVORCE BY MUTUAL CONSENT

The petitioners above-named most respectfully submit as follows:

1. That the marriage between the petitioners was solemnized on {{marriage_date}} at {{marriage_place}} according to Hindu rites and ceremonies.

2. That the petitioners have been living separately since {{separation_date}}, i.e., for more than one year, and it has not been possible for the petitioners to live together.

3. That the petitioners have mutually agreed that the marriage between them be dissolved by a decree of divorce.

4. CHILDREN: {{children_details}}

5. SETTLEMENT TERMS: {{settlement_terms}}

6. ALIMONY/MAINTENANCE: {{maintenance_terms}}

7. That no coercion, fraud, or undue influence has been used by either party and this petition is being filed of their free will and consent.

PRAYER:
It is most respectfully prayed that this Hon'ble Court may be pleased to pass a decree of divorce dissolving the marriage between the petitioners.

Date: {{current_date}}

Petitioner No. 1 (Husband): _______________
Petitioner No. 2 (Wife): _______________`
  },
  {
    id: 'maintenance_application',
    name: 'Maintenance Application (Section 125 CrPC)',
    category: 'Family Law',
    subcategory: 'Family Court / Magistrate',
    description: 'Application for maintenance under Section 125 CrPC / Section 144 BNSS',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'court_name', label: 'Court Name', type: 'text', required: true },
      { id: 'applicant_name', label: 'Applicant Name', type: 'text', required: true },
      { id: 'applicant_relation', label: 'Relation (Wife/Child/Parent)', type: 'select', required: true, options: ['Wife', 'Minor Child', 'Major Child (unable to maintain)', 'Parents'] },
      { id: 'applicant_address', label: 'Applicant Address', type: 'address', required: true },
      { id: 'respondent_name', label: 'Respondent Name', type: 'text', required: true },
      { id: 'respondent_address', label: 'Respondent Address', type: 'address', required: true },
      { id: 'facts', label: 'Statement of Facts', type: 'textarea', required: true },
      { id: 'respondent_income', label: 'Respondent\'s Approximate Income', type: 'text', required: true },
      { id: 'maintenance_amount', label: 'Maintenance Amount Sought (Rs./month)', type: 'number', required: true },
      { id: 'expenses_details', label: 'Monthly Expenses Breakdown', type: 'textarea', required: true }
    ],
    template: `IN THE COURT OF {{court_name}}

APPLICATION UNDER SECTION 125 OF CrPC / SECTION 144 OF BNSS

{{applicant_name}} ............. Applicant ({{applicant_relation}})
Address: {{applicant_address}}

Versus

{{respondent_name}} ............. Respondent
Address: {{respondent_address}}

APPLICATION FOR MAINTENANCE

The applicant above-named most respectfully submits as follows:

STATEMENT OF FACTS:
{{facts}}

RESPONDENT'S INCOME:
The respondent has sufficient means. His/Her approximate monthly income is Rs. {{respondent_income}}/-.

MONTHLY EXPENSES OF THE APPLICANT:
{{expenses_details}}

MAINTENANCE SOUGHT:
The applicant is unable to maintain herself/himself and requires maintenance of Rs. {{maintenance_amount}}/- per month.

PRAYER:
It is most respectfully prayed that this Hon'ble Court may be pleased to:
(a) Direct the respondent to pay interim maintenance of Rs. {{maintenance_amount}}/- per month to the applicant during the pendency of this application;
(b) Direct the respondent to pay permanent maintenance;
(c) Pass any other order as deemed fit in the interest of justice.

Date: {{current_date}}

Applicant`
  },
  {
    id: 'rti_application',
    name: 'RTI Application',
    category: 'Administrative Law',
    subcategory: 'Right to Information',
    description: 'Application under Right to Information Act, 2005',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'pio_designation', label: 'Central/State Public Information Officer Designation', type: 'text', required: true },
      { id: 'department', label: 'Department/Ministry/Authority', type: 'text', required: true },
      { id: 'department_address', label: 'Department Address', type: 'address', required: true },
      { id: 'applicant_name', label: 'Applicant Name', type: 'text', required: true },
      { id: 'applicant_address', label: 'Applicant Address', type: 'address', required: true },
      { id: 'information_sought', label: 'Information Sought', type: 'textarea', required: true },
      { id: 'time_period', label: 'Time Period for Information', type: 'text', required: false },
      { id: 'fee_amount', label: 'Application Fee (Rs.)', type: 'number', required: true, defaultValue: '10' },
      { id: 'bpl', label: 'Below Poverty Line', type: 'checkbox', required: false }
    ],
    template: `APPLICATION UNDER RIGHT TO INFORMATION ACT, 2005

To,
The {{pio_designation}},
{{department}},
{{department_address}}

Date: {{current_date}}

Subject: Application under Section 6(1) of the RTI Act, 2005

Sir/Madam,

I, {{applicant_name}}, residing at {{applicant_address}}, am a citizen of India and hereby request for the following information under the Right to Information Act, 2005:

INFORMATION SOUGHT:
{{information_sought}}

TIME PERIOD: {{time_period}}

I am enclosing an application fee of Rs. {{fee_amount}}/- by way of _______________ (IPO/DD/Cash/Court Fee Stamp).

I would prefer to receive the information in the following mode: (Paper copies / Inspection / Electronic format)

Yours faithfully,

{{applicant_name}}
Address: {{applicant_address}}
Contact: _______________`
  },
  {
    id: 'anticipatory_bail',
    name: 'Anticipatory Bail Application',
    category: 'Criminal Law',
    subcategory: 'Sessions Court / High Court',
    description: 'Application for anticipatory bail under Section 438 CrPC / Section 482 BNSS',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'court_name', label: 'Court Name', type: 'text', required: true },
      { id: 'applicant_name', label: 'Applicant Name', type: 'text', required: true },
      { id: 'applicant_address', label: 'Applicant Address', type: 'address', required: true },
      { id: 'fir_number', label: 'FIR Number (if registered)', type: 'text', required: false },
      { id: 'police_station', label: 'Police Station', type: 'text', required: true },
      { id: 'sections', label: 'Sections Alleged', type: 'text', required: true },
      { id: 'apprehension_grounds', label: 'Grounds of Apprehension of Arrest', type: 'textarea', required: true },
      { id: 'grounds_for_bail', label: 'Grounds for Anticipatory Bail', type: 'textarea', required: true },
      { id: 'advocate_name', label: 'Advocate Name', type: 'text', required: true }
    ],
    template: `IN THE {{court_name}}

CRIMINAL MISCELLANEOUS APPLICATION NO. _______ OF _______

APPLICATION FOR ANTICIPATORY BAIL
Under Section 438 CrPC / Section 482 BNSS

{{applicant_name}} ............. Applicant
Versus
State of _______________ ............. Respondent

FIR No.: {{fir_number}} (if registered)
Police Station: {{police_station}}
Under Sections: {{sections}}

MOST RESPECTFULLY SHOWETH:

1. That the applicant {{applicant_name}} apprehends arrest in connection with the above FIR/complaint.

2. Address of the Applicant: {{applicant_address}}

GROUNDS OF APPREHENSION:
{{apprehension_grounds}}

GROUNDS FOR ANTICIPATORY BAIL:
{{grounds_for_bail}}

PRAYER:
It is most respectfully prayed that this Hon'ble Court may be pleased to:
(a) Grant anticipatory bail to the applicant directing that in the event of arrest, the applicant shall be released on bail;
(b) Pass any other order as deemed fit in the interest of justice.

Date: {{current_date}}

{{advocate_name}}
Advocate for the Applicant`
  },
  {
    id: 'rent_agreement',
    name: 'Rent/Lease Agreement',
    category: 'Property Law',
    subcategory: 'Real Estate',
    description: 'Standard rent/lease agreement for residential and commercial property',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'landlord_name', label: 'Landlord Name', type: 'text', required: true },
      { id: 'landlord_address', label: 'Landlord Address', type: 'address', required: true },
      { id: 'tenant_name', label: 'Tenant Name', type: 'text', required: true },
      { id: 'tenant_address', label: 'Tenant Permanent Address', type: 'address', required: true },
      { id: 'property_description', label: 'Property Description', type: 'textarea', required: true },
      { id: 'property_address', label: 'Property Address', type: 'address', required: true },
      { id: 'property_type', label: 'Property Type', type: 'select', required: true, options: ['Residential', 'Commercial', 'Industrial'] },
      { id: 'monthly_rent', label: 'Monthly Rent (Rs.)', type: 'number', required: true },
      { id: 'security_deposit', label: 'Security Deposit (Rs.)', type: 'number', required: true },
      { id: 'lease_start', label: 'Lease Start Date', type: 'date', required: true },
      { id: 'lease_duration', label: 'Lease Duration (months)', type: 'number', required: true, defaultValue: '11' },
      { id: 'rent_due_date', label: 'Rent Due Date (day of month)', type: 'number', required: true, defaultValue: '5' }
    ],
    template: `RENT / LEASE AGREEMENT

This Rent Agreement is executed on {{current_date}} at _______________

BETWEEN:

LANDLORD/LESSOR:
Name: {{landlord_name}}
Address: {{landlord_address}}
(hereinafter referred to as the "LANDLORD/LESSOR")

AND

TENANT/LESSEE:
Name: {{tenant_name}}
Permanent Address: {{tenant_address}}
(hereinafter referred to as the "TENANT/LESSEE")

WHEREAS the Landlord is the owner of the property described below and has agreed to let out the same to the Tenant on the terms and conditions mentioned herein:

PROPERTY DETAILS:
Description: {{property_description}}
Address: {{property_address}}
Type: {{property_type}}

TERMS AND CONDITIONS:

1. TERM: This agreement shall be for a period of {{lease_duration}} months commencing from {{lease_start}}.

2. RENT: The monthly rent shall be Rs. {{monthly_rent}}/- payable on or before the {{rent_due_date}}th of each calendar month.

3. SECURITY DEPOSIT: The Tenant has paid a security deposit of Rs. {{security_deposit}}/- which shall be refunded at the time of vacating the premises after deducting any dues.

4. MAINTENANCE: The Tenant shall maintain the premises in good condition and shall not make any structural changes without prior written consent of the Landlord.

5. SUB-LETTING: The Tenant shall not sub-let or assign the premises or any part thereof to any third party.

6. TERMINATION: Either party may terminate this agreement by giving one month's written notice.

7. UTILITIES: Electricity, water and other utility charges shall be borne by the Tenant.

8. DISPUTES: Any disputes arising out of this agreement shall be subject to the jurisdiction of courts at _______________.

IN WITNESS WHEREOF, the parties have signed this agreement on the date first above written.

LANDLORD: _______________
Name: {{landlord_name}}

TENANT: _______________
Name: {{tenant_name}}

WITNESSES:
1. Name: _______________ Signature: _______________
2. Name: _______________ Signature: _______________`
  },
  {
    id: 'power_of_attorney',
    name: 'General Power of Attorney (GPA)',
    category: 'General',
    subcategory: 'Property / Business',
    description: 'General Power of Attorney for property or business transactions',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'principal_name', label: 'Principal (Executant) Name', type: 'text', required: true },
      { id: 'principal_address', label: 'Principal Address', type: 'address', required: true },
      { id: 'attorney_name', label: 'Attorney (Agent) Name', type: 'text', required: true },
      { id: 'attorney_address', label: 'Attorney Address', type: 'address', required: true },
      { id: 'purpose', label: 'Purpose / Scope of Authority', type: 'textarea', required: true },
      { id: 'property_details', label: 'Property/Business Details (if applicable)', type: 'textarea', required: false },
      { id: 'duration', label: 'Duration of Power', type: 'text', required: false, placeholder: 'e.g., Until revoked / 2 years' }
    ],
    template: `GENERAL POWER OF ATTORNEY

This Power of Attorney is executed on {{current_date}}

BY:
{{principal_name}} (hereinafter called the "PRINCIPAL/EXECUTANT")
Address: {{principal_address}}

IN FAVOUR OF:
{{attorney_name}} (hereinafter called the "ATTORNEY/AGENT")
Address: {{attorney_address}}

WHEREAS the Principal is desirous of appointing the Attorney to act on his/her behalf for the purposes mentioned herein.

NOW KNOW ALL MEN BY THESE PRESENTS that I, {{principal_name}}, do hereby constitute, nominate and appoint {{attorney_name}} as my true and lawful Attorney to do and execute on my behalf the following acts, deeds and things:

PURPOSE AND SCOPE OF AUTHORITY:
{{purpose}}

PROPERTY/BUSINESS DETAILS:
{{property_details}}

DURATION: {{duration}}

The Attorney is authorized to sign all papers, documents, applications, and to do all such acts and things as may be necessary for carrying out the above purposes.

I hereby agree to ratify and confirm whatever my said Attorney shall lawfully do or cause to be done by virtue of these presents.

IN WITNESS WHEREOF, I have executed this Power of Attorney on the day and date first above written.

PRINCIPAL/EXECUTANT:
Signature: _______________
Name: {{principal_name}}

WITNESSES:
1. Name: _______________ Signature: _______________
2. Name: _______________ Signature: _______________

ACCEPTED BY ATTORNEY:
Signature: _______________
Name: {{attorney_name}}`
  },
  {
    id: 'partnership_deed',
    name: 'Partnership Deed',
    category: 'Commercial Law',
    subcategory: 'Business Formation',
    description: 'Partnership deed for establishing a partnership firm under Indian Partnership Act',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'firm_name', label: 'Partnership Firm Name', type: 'text', required: true },
      { id: 'business_nature', label: 'Nature of Business', type: 'text', required: true },
      { id: 'business_address', label: 'Principal Place of Business', type: 'address', required: true },
      { id: 'partner1_name', label: 'Partner 1 Name', type: 'text', required: true },
      { id: 'partner1_address', label: 'Partner 1 Address', type: 'address', required: true },
      { id: 'partner1_share', label: 'Partner 1 Profit Share (%)', type: 'number', required: true },
      { id: 'partner2_name', label: 'Partner 2 Name', type: 'text', required: true },
      { id: 'partner2_address', label: 'Partner 2 Address', type: 'address', required: true },
      { id: 'partner2_share', label: 'Partner 2 Profit Share (%)', type: 'number', required: true },
      { id: 'capital_contribution', label: 'Capital Contribution Details', type: 'textarea', required: true },
      { id: 'commencement_date', label: 'Date of Commencement', type: 'date', required: true }
    ],
    template: `PARTNERSHIP DEED

This Partnership Deed is executed on {{current_date}} at _______________

BETWEEN:

PARTNER 1:
Name: {{partner1_name}}
Address: {{partner1_address}}

AND

PARTNER 2:
Name: {{partner2_name}}
Address: {{partner2_address}}

(Collectively referred to as "Partners")

WHEREAS the Partners have mutually agreed to carry on business in partnership under the following terms and conditions:

1. NAME OF FIRM: {{firm_name}}

2. NATURE OF BUSINESS: {{business_nature}}

3. PRINCIPAL PLACE OF BUSINESS: {{business_address}}

4. DATE OF COMMENCEMENT: {{commencement_date}}

5. CAPITAL CONTRIBUTION:
{{capital_contribution}}

6. PROFIT AND LOSS SHARING:
   Partner 1 ({{partner1_name}}): {{partner1_share}}%
   Partner 2 ({{partner2_name}}): {{partner2_share}}%

7. MANAGEMENT: All Partners shall have equal right to participate in the management and conduct of the business.

8. BANK ACCOUNT: The firm's bank account shall be operated jointly by the Partners.

9. DRAWINGS: Partners may draw such amounts as may be mutually agreed upon.

10. ACCOUNTS: Proper books of accounts shall be maintained and the financial year shall be from April to March.

11. RETIREMENT/ADMISSION: Any Partner may retire from the firm by giving three months' notice in writing. New partners may be admitted with the consent of all existing Partners.

12. DISSOLUTION: The firm may be dissolved by mutual consent of all Partners.

13. ARBITRATION: Any dispute arising between the Partners shall be referred to arbitration under the Arbitration and Conciliation Act, 1996.

IN WITNESS WHEREOF, the parties have set their hands on the day and date first above written.

Partner 1: _______________ ({{partner1_name}})
Partner 2: _______________ ({{partner2_name}})

WITNESSES:
1. Name: _______________ Signature: _______________
2. Name: _______________ Signature: _______________`
  },
  {
    id: 'quashing_petition',
    name: 'Petition for Quashing (Section 482 CrPC)',
    category: 'Criminal Law',
    subcategory: 'High Court',
    description: 'Petition under Section 482 CrPC / Section 528 BNSS for quashing of FIR/criminal proceedings',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'high_court', label: 'High Court Name', type: 'text', required: true },
      { id: 'petitioner_name', label: 'Petitioner Name', type: 'text', required: true },
      { id: 'fir_number', label: 'FIR Number', type: 'text', required: true },
      { id: 'police_station', label: 'Police Station', type: 'text', required: true },
      { id: 'sections', label: 'Sections Charged', type: 'text', required: true },
      { id: 'respondent_state', label: 'State (Respondent)', type: 'text', required: true },
      { id: 'grounds_for_quashing', label: 'Grounds for Quashing', type: 'textarea', required: true },
      { id: 'advocate_name', label: 'Advocate Name', type: 'text', required: true }
    ],
    template: `IN THE HON'BLE {{high_court}}

CRIMINAL MISCELLANEOUS PETITION NO. _______ OF _______

PETITION UNDER SECTION 482 CrPC / SECTION 528 BNSS

{{petitioner_name}} ............. Petitioner
Versus
State of {{respondent_state}} and Anr. ............. Respondent(s)

FIR No.: {{fir_number}}
Police Station: {{police_station}}
Under Sections: {{sections}}

FOR QUASHING OF FIR AND CRIMINAL PROCEEDINGS

MOST RESPECTFULLY SHOWETH:

1. That the petitioner is aggrieved by the registration of FIR No. {{fir_number}} at Police Station {{police_station}} under Sections {{sections}}.

2. That the continuation of the criminal proceedings would amount to abuse of the process of the Court.

GROUNDS FOR QUASHING:
{{grounds_for_quashing}}

PRAYER:
It is most respectfully prayed that this Hon'ble Court may be pleased to:
(a) Quash the FIR No. {{fir_number}} and all proceedings arising therefrom;
(b) Stay further investigation/proceedings during the pendency of this petition;
(c) Pass any other order as deemed fit.

Date: {{current_date}}

{{advocate_name}}
Advocate for the Petitioner`
  },
  {
    id: 'rera_complaint',
    name: 'RERA Complaint',
    category: 'Real Estate Law',
    subcategory: 'RERA Authority',
    description: 'Complaint before Real Estate Regulatory Authority under RERA 2016',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'rera_authority', label: 'RERA Authority', type: 'text', required: true, placeholder: 'e.g., Maharashtra RERA' },
      { id: 'complainant_name', label: 'Complainant (Allottee) Name', type: 'text', required: true },
      { id: 'complainant_address', label: 'Complainant Address', type: 'address', required: true },
      { id: 'promoter_name', label: 'Promoter/Builder Name', type: 'text', required: true },
      { id: 'rera_registration', label: 'RERA Registration Number', type: 'text', required: true },
      { id: 'project_name', label: 'Project Name', type: 'text', required: true },
      { id: 'unit_details', label: 'Unit/Flat Details', type: 'textarea', required: true },
      { id: 'agreement_date', label: 'Date of Agreement', type: 'date', required: true },
      { id: 'promised_possession', label: 'Promised Possession Date', type: 'date', required: true },
      { id: 'amount_paid', label: 'Total Amount Paid (Rs.)', type: 'number', required: true },
      { id: 'grievance', label: 'Grievance/Violation', type: 'textarea', required: true },
      { id: 'relief_sought', label: 'Relief Sought', type: 'textarea', required: true }
    ],
    template: `BEFORE THE {{rera_authority}}

COMPLAINT NO. _______ OF _______
Under Section 31 of the Real Estate (Regulation and Development) Act, 2016

{{complainant_name}} ............. Complainant (Allottee)
Address: {{complainant_address}}

Versus

{{promoter_name}} ............. Respondent (Promoter)
RERA Reg. No.: {{rera_registration}}

COMPLAINT

1. ABOUT THE PROJECT:
Project Name: {{project_name}}
RERA Registration: {{rera_registration}}

2. UNIT DETAILS: {{unit_details}}

3. Date of Agreement: {{agreement_date}}
   Promised Possession Date: {{promised_possession}}
   Total Amount Paid: Rs. {{amount_paid}}/-

4. GRIEVANCE:
{{grievance}}

5. RELIEF SOUGHT:
{{relief_sought}}

Date: {{current_date}}

Complainant`
  },
  {
    id: 'arbitration_clause',
    name: 'Arbitration Agreement/Clause',
    category: 'Arbitration',
    subcategory: 'Commercial',
    description: 'Standard arbitration agreement/clause under the Arbitration and Conciliation Act, 1996',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'party1_name', label: 'Party 1 Name', type: 'text', required: true },
      { id: 'party2_name', label: 'Party 2 Name', type: 'text', required: true },
      { id: 'seat', label: 'Seat of Arbitration', type: 'text', required: true, placeholder: 'e.g., Mumbai' },
      { id: 'language', label: 'Language of Arbitration', type: 'text', required: true, defaultValue: 'English' },
      { id: 'num_arbitrators', label: 'Number of Arbitrators', type: 'select', required: true, options: ['Sole Arbitrator', 'Three Arbitrators'] },
      { id: 'governing_law', label: 'Governing Law', type: 'text', required: true, defaultValue: 'Laws of India' },
      { id: 'institution', label: 'Arbitration Institution (if institutional)', type: 'text', required: false, placeholder: 'e.g., SIAC, ICC, MCIA' }
    ],
    template: `ARBITRATION AGREEMENT

This Arbitration Agreement is entered into between:

Party 1: {{party1_name}}
Party 2: {{party2_name}}

ARBITRATION CLAUSE:

Any dispute, controversy or claim arising out of or relating to this contract/agreement, or the breach, termination or invalidity thereof, shall be settled by arbitration in accordance with the Arbitration and Conciliation Act, 1996.

1. SEAT OF ARBITRATION: {{seat}}

2. LANGUAGE: The arbitration proceedings shall be conducted in {{language}}.

3. ARBITRAL TRIBUNAL: The arbitral tribunal shall consist of {{num_arbitrators}}.

4. GOVERNING LAW: This agreement and any dispute arising hereunder shall be governed by the {{governing_law}}.

5. INSTITUTION: {{institution}}

6. The award rendered by the arbitral tribunal shall be final and binding on the parties. Judgment upon the award may be entered in any court having jurisdiction thereof.

7. The arbitral tribunal shall have the power to award costs and reasonable attorney's fees to the prevailing party.

Party 1: _______________ ({{party1_name}})
Party 2: _______________ ({{party2_name}})

Date: {{current_date}}`
  },
  {
    id: 'demand_promissory_note',
    name: 'Demand Promissory Note',
    category: 'Banking Law',
    subcategory: 'Negotiable Instruments',
    description: 'Demand promissory note under Section 4 of the Negotiable Instruments Act',
    jurisdiction: 'India',
    language: 'en',
    version: '1.0',
    lastUpdated: '2024-01-01',
    fields: [
      { id: 'place', label: 'Place of Execution', type: 'text', required: true },
      { id: 'maker_name', label: 'Maker Name', type: 'text', required: true },
      { id: 'maker_address', label: 'Maker Address', type: 'address', required: true },
      { id: 'payee_name', label: 'Payee Name', type: 'text', required: true },
      { id: 'amount', label: 'Amount (Rs.)', type: 'number', required: true },
      { id: 'amount_words', label: 'Amount in Words', type: 'text', required: true },
      { id: 'interest_rate', label: 'Interest Rate (% per annum)', type: 'number', required: false },
      { id: 'purpose', label: 'Purpose/Consideration', type: 'textarea', required: false }
    ],
    template: `DEMAND PROMISSORY NOTE

Place: {{place}}
Date: {{current_date}}

Rs. {{amount}}/-

On demand, I, {{maker_name}}, residing at {{maker_address}}, promise to pay to {{payee_name}} or order, the sum of Rs. {{amount}}/- (Rupees {{amount_words}} only) with interest at the rate of {{interest_rate}}% per annum from the date hereof until payment, for value received.

Purpose/Consideration: {{purpose}}

Maker:
Signature: _______________
Name: {{maker_name}}
Address: {{maker_address}}

Revenue Stamp: _______________`
  }
];

export class JurexioDocumentTemplatesService {
  private templates = INDIAN_LEGAL_TEMPLATES;
  
  getAllTemplates(): DocumentTemplate[] {
    return this.templates;
  }
  
  getTemplateById(id: string): DocumentTemplate | undefined {
    return this.templates.find(t => t.id === id);
  }
  
  getTemplatesByCategory(category: string): DocumentTemplate[] {
    return this.templates.filter(t => 
      t.category.toLowerCase().includes(category.toLowerCase())
    );
  }
  
  searchTemplates(query: string): DocumentTemplate[] {
    const lowerQuery = query.toLowerCase();
    return this.templates.filter(t => 
      t.name.toLowerCase().includes(lowerQuery) ||
      t.description.toLowerCase().includes(lowerQuery) ||
      t.category.toLowerCase().includes(lowerQuery)
    );
  }
  
  generateDocument(
    templateId: string,
    fieldValues: Record<string, any>,
    format: 'text' | 'html' | 'markdown' = 'text'
  ): GeneratedDocument | null {
    const template = this.getTemplateById(templateId);
    if (!template) return null;
    
    let content = template.template;
    
    content = content.replace(/\{\{current_date\}\}/g, new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }));
    
    for (const [key, value] of Object.entries(fieldValues)) {
      const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      content = content.replace(placeholder, value?.toString() || '');
    }
    
    content = content.replace(/\{\{[^}]+\}\}/g, '_______________');
    
    if (format === 'html') {
      content = `<div class="legal-document">\n${content.replace(/\n/g, '<br>\n')}\n</div>`;
    } else if (format === 'markdown') {
      content = content.split('\n').map(line => {
        if (line.toUpperCase() === line && line.trim().length > 0) {
          return `## ${line}`;
        }
        return line;
      }).join('\n');
    }
    
    return {
      id: `doc-${Date.now()}`,
      templateId,
      content,
      format,
      metadata: {
        generatedAt: new Date(),
        fields: fieldValues,
        wordCount: content.split(/\s+/).length,
        pageCount: Math.ceil(content.length / 3000)
      }
    };
  }
  
  validateFields(templateId: string, fieldValues: Record<string, any>): {
    valid: boolean;
    errors: Array<{ field: string; message: string }>;
  } {
    const template = this.getTemplateById(templateId);
    if (!template) {
      return { valid: false, errors: [{ field: 'template', message: 'Template not found' }] };
    }
    
    const errors: Array<{ field: string; message: string }> = [];
    
    for (const field of template.fields) {
      if (field.required && !fieldValues[field.id]) {
        errors.push({ field: field.id, message: `${field.label} is required` });
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  getCategories(): string[] {
    return [...new Set(this.templates.map(t => t.category))];
  }
  
  getTemplateCount(): number {
    return this.templates.length;
  }
}

export const documentTemplatesService = new JurexioDocumentTemplatesService();
