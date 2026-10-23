/**
 * Jurexio - Statute seed EXPANSION Vol.6 (USA, enlarged)
 * NV-STATUTE-EXPANSION-006
 * ---------------------------------------------------------------------------
 * PURE DATA MODULE (no DB / no side-effect imports). Broadens US federal (and
 * key uniform/state) coverage: more Constitutional amendments; environmental
 * (CERCLA, Clean Air/Water, NEPA, RCRA, TSCA, ESA); labor/employment depth
 * (OSHA, WARN, Equal Pay, Title IX, FCRA-credit, COBRA, GINA, USERRA);
 * privacy/tech (COPPA, ECPA, SCA, CAN-SPAM, BIPA, VCDPA, CPRA, FERPA, TCPA);
 * consumer finance (TILA, FDCPA, ECOA); antitrust (Celler-Kefauver); bankruptcy
 * chapter specifics; tax (IRC §351/§368/§1031/§1001/§61); securities (Reg D /
 * Rule 144 / Williams Act / SOX §906); IP (Patent §102/§103/§284, dilution,
 * Copyright §501/§504); white-collar (RICO, mail/wire fraud); evidence (FRE);
 * immigration (INA); ADA Titles II & III.
 *
 * Section texts are concise, accurate paraphrases suitable for RAG grounding +
 * citation, keyed by the canonical (jurisdiction, act_short_title,
 * section_number) unique tuple. All keys are NEW relative to getUSStatutes()
 * and Vol.1/Vol.2/Vol.4 (verified 0 dup keys).
 */
import { act, type ExpansionStatute } from './jrx-statutes-expansion-2026-06.js';

// ─── Constitutional amendments (Bill of Rights + Reconstruction/others) ──────
const US_CONST: ExpansionStatute[] = [
  ...act('Constitution of the United States', 'US-CONST', 'US', 'constitutional_law', '1788-06-21', [
    { s: 'Amend.II', t: 'Right to keep and bear arms', txt: 'A well regulated Militia being necessary to the security of a free State, the right of the people to keep and bear Arms shall not be infringed; the Supreme Court has recognised an individual right (District of Columbia v. Heller; New York State Rifle & Pistol Assn. v. Bruen).', kw: ['second amendment', 'firearms', 'Heller', 'Bruen'] },
    { s: 'Amend.V', t: 'Due process, self-incrimination, double jeopardy, takings', txt: 'No person shall be held to answer for a capital crime unless on indictment of a Grand Jury, nor be twice put in jeopardy, nor be compelled to be a witness against himself, nor be deprived of life, liberty or property without due process of law, nor shall private property be taken for public use without just compensation.', kw: ['fifth amendment', 'due process', 'self-incrimination', 'takings'] },
    { s: 'Amend.VI', t: 'Rights of the accused in criminal prosecutions', txt: 'In all criminal prosecutions, the accused shall enjoy the right to a speedy and public trial by an impartial jury, to be informed of the accusation, to be confronted with the witnesses against him, to compulsory process for obtaining witnesses, and to the assistance of counsel for his defence.', kw: ['sixth amendment', 'right to counsel', 'speedy trial', 'confrontation'] },
    { s: 'Amend.VIII', t: 'Excessive bail, fines and cruel and unusual punishment', txt: 'Excessive bail shall not be required, nor excessive fines imposed, nor cruel and unusual punishments inflicted.', kw: ['eighth amendment', 'cruel and unusual', 'excessive fines'] },
    { s: 'Amend.X', t: 'Powers reserved to the States and the people', txt: 'The powers not delegated to the United States by the Constitution, nor prohibited by it to the States, are reserved to the States respectively, or to the people — the textual basis of federalism and the anti-commandeering doctrine.', kw: ['tenth amendment', 'federalism', 'reserved powers', 'anti-commandeering'] },
    { s: 'Amend.XIII', t: 'Abolition of slavery', txt: 'Neither slavery nor involuntary servitude, except as a punishment for crime whereof the party shall have been duly convicted, shall exist within the United States or any place subject to their jurisdiction; Congress may enforce this by appropriate legislation.', kw: ['thirteenth amendment', 'slavery', 'involuntary servitude'] },
    { s: 'Amend.XV', t: 'Right to vote not denied on account of race', txt: 'The right of citizens of the United States to vote shall not be denied or abridged by the United States or by any State on account of race, color, or previous condition of servitude.', kw: ['fifteenth amendment', 'voting rights', 'race'] },
    { s: 'Amend.XVI', t: 'Federal income tax', txt: 'The Congress shall have power to lay and collect taxes on incomes, from whatever source derived, without apportionment among the several States and without regard to any census or enumeration.', kw: ['sixteenth amendment', 'income tax', 'apportionment'] },
    { s: 'Amend.XIX', t: 'Right of women to vote', txt: 'The right of citizens of the United States to vote shall not be denied or abridged by the United States or by any State on account of sex.', kw: ['nineteenth amendment', 'women suffrage', 'sex'] },
  ]),
];

// ─── Environmental law ───────────────────────────────────────────────────────
const US_ENV: ExpansionStatute[] = [
  ...act('Comprehensive Environmental Response, Compensation, and Liability Act (CERCLA / Superfund), 42 U.S.C. §9601', 'US-CERCLA', 'US', 'environmental_law', '1980-12-11', [
    { s: '107', t: 'Liability of potentially responsible parties', txt: 'Owners and operators of a facility, persons who arranged for disposal, and transporters are strictly, jointly and severally liable for the costs of removal or remedial action and for damages to natural resources caused by a release of hazardous substances, subject to limited defences.', kw: ['Superfund', 'PRP liability', 'strict liability', 'CERCLA 107'] },
    { s: '113(f)', t: 'Contribution among responsible parties', txt: 'Any person may seek contribution from any other person who is liable or potentially liable for response costs, with the court allocating costs using such equitable factors as it determines appropriate.', kw: ['contribution', 'cost allocation', 'CERCLA 113'] },
  ]),
  ...act('Clean Air Act, 42 U.S.C. §7401', 'US-CAA', 'US', 'environmental_law', '1970-12-31', [
    { s: '109', t: 'National Ambient Air Quality Standards (NAAQS)', txt: 'The Administrator shall promulgate primary national ambient air quality standards, at levels requisite to protect the public health with an adequate margin of safety, and secondary standards to protect public welfare, for criteria pollutants.', kw: ['NAAQS', 'criteria pollutants', 'EPA', 'CAA 109'] },
    { s: '111', t: 'New source performance standards', txt: 'The Administrator shall establish federal standards of performance limiting emissions from new and modified stationary sources, reflecting the degree of emission limitation achievable through the best system of emission reduction that is adequately demonstrated.', kw: ['NSPS', 'stationary source', 'BSER', 'CAA 111'] },
    { s: '202', t: 'Emission standards for new motor vehicles', txt: 'The Administrator shall prescribe standards applicable to the emission of air pollutants from new motor vehicles or engines which in his judgment cause or contribute to air pollution reasonably anticipated to endanger public health or welfare (Massachusetts v. EPA).', kw: ['mobile sources', 'vehicle emissions', 'greenhouse gases', 'CAA 202'] },
  ]),
  ...act('Clean Water Act (Federal Water Pollution Control Act), 33 U.S.C. §1251', 'US-CWA', 'US', 'environmental_law', '1972-10-18', [
    { s: '301', t: 'Prohibition of unpermitted discharges', txt: 'Except in compliance with the Act, the discharge of any pollutant by any person from a point source into navigable waters is unlawful; effluent limitations are established to implement the prohibition.', kw: ['effluent limitation', 'point source', 'navigable waters', 'CWA 301'] },
    { s: '402', t: 'National Pollutant Discharge Elimination System (NPDES) permits', txt: 'The Administrator (or an authorised State) may issue NPDES permits authorising the discharge of pollutants upon condition that the discharge meets the applicable effluent limitations and monitoring and reporting requirements.', kw: ['NPDES', 'discharge permit', 'CWA 402'] },
    { s: '404', t: 'Permits for dredged or fill material', txt: 'The Secretary of the Army, acting through the Corps of Engineers, may issue permits for the discharge of dredged or fill material into navigable waters at specified disposal sites, subject to EPA guidelines and veto authority.', kw: ['wetlands', 'dredge and fill', 'Army Corps', 'CWA 404'] },
  ]),
  ...act('National Environmental Policy Act, 42 U.S.C. §4321', 'US-NEPA', 'US', 'environmental_law', '1970-01-01', [
    { s: '102', t: 'Environmental impact statement requirement', txt: 'All agencies of the Federal Government shall include in every recommendation or report on proposals for major Federal actions significantly affecting the quality of the human environment a detailed environmental impact statement on the environmental effects and alternatives.', kw: ['EIS', 'major federal action', 'NEPA 102'] },
  ]),
  ...act('Resource Conservation and Recovery Act, 42 U.S.C. §6901', 'US-RCRA', 'US', 'environmental_law', '1976-10-21', [
    { s: '3004', t: 'Standards for owners and operators of hazardous waste facilities', txt: 'The Administrator shall promulgate standards applicable to owners and operators of facilities for the treatment, storage and disposal of hazardous waste, governing the cradle-to-grave management of such waste and corrective action for releases.', kw: ['hazardous waste', 'TSDF', 'cradle to grave', 'RCRA 3004'] },
  ]),
  ...act('Toxic Substances Control Act, 15 U.S.C. §2601', 'US-TSCA', 'US', 'environmental_law', '1976-10-11', [
    { s: '6', t: 'Regulation of hazardous chemical substances', txt: 'If the Administrator finds that a chemical substance presents an unreasonable risk of injury to health or the environment, he shall by rule apply requirements to the extent necessary, ranging from labelling to limits or prohibition on manufacture, processing or distribution.', kw: ['chemical regulation', 'unreasonable risk', 'TSCA 6'] },
  ]),
  ...act('Endangered Species Act, 16 U.S.C. §1531', 'US-ESA', 'US', 'environmental_law', '1973-12-28', [
    { s: '9', t: 'Prohibited acts — taking of listed species', txt: 'It is unlawful for any person to take (harass, harm, pursue, hunt, shoot, wound, kill, trap, capture or collect) any endangered species of fish or wildlife within the United States, to possess or sell such species, or to violate protective regulations.', kw: ['take', 'endangered species', 'wildlife', 'ESA 9'] },
  ]),
];

// ─── Labor & employment depth ────────────────────────────────────────────────
const US_LABOR: ExpansionStatute[] = [
  ...act('Occupational Safety and Health Act of 1970, 29 U.S.C. §651', 'US-OSHA', 'US', 'employment_law', '1971-04-28', [
    { s: '5', t: 'General duty clause', txt: 'Each employer shall furnish to each of his employees employment and a place of employment free from recognized hazards that are causing or are likely to cause death or serious physical harm, and shall comply with occupational safety and health standards promulgated under the Act.', kw: ['general duty clause', 'workplace safety', 'recognized hazard', 'OSHA 5'] },
    { s: '11(c)', t: 'Protection against retaliation', txt: 'No person shall discharge or in any manner discriminate against any employee because the employee has filed a complaint, instituted a proceeding, or exercised any right under the Act relating to occupational safety and health.', kw: ['anti-retaliation', 'whistleblower', 'OSHA 11c'] },
  ]),
  ...act('Worker Adjustment and Retraining Notification (WARN) Act, 29 U.S.C. §2101', 'US-WARN', 'US', 'employment_law', '1989-02-04', [
    { s: '2102', t: 'Notice required before plant closings and mass layoffs', txt: 'An employer of 100 or more employees shall not order a plant closing or mass layoff until the end of a 60-day period after written notice to affected employees or their representatives and to State and local officials.', kw: ['plant closing', 'mass layoff', '60-day notice', 'WARN 2102'] },
  ]),
  ...act('Equal Pay Act of 1963, 29 U.S.C. §206(d)', 'US-EQPAY', 'US', 'employment_law', '1963-06-10', [
    { s: '206(d)', t: 'Prohibition of sex-based wage discrimination', txt: 'No employer shall discriminate between employees on the basis of sex by paying wages at a rate less than the rate paid to employees of the opposite sex for equal work on jobs requiring equal skill, effort and responsibility under similar working conditions, except where pursuant to a seniority, merit, or production-based system.', kw: ['equal pay', 'sex discrimination', 'equal work', 'EPA 206d'] },
  ]),
  ...act('Title IX of the Education Amendments of 1972, 20 U.S.C. §1681', 'US-TITLEIX', 'US', 'administrative_law', '1972-06-23', [
    { s: '1681', t: 'Prohibition of sex discrimination in education programs', txt: 'No person shall, on the basis of sex, be excluded from participation in, be denied the benefits of, or be subjected to discrimination under any education program or activity receiving Federal financial assistance, subject to enumerated exceptions.', kw: ['Title IX', 'sex discrimination', 'education', 'federal funding'] },
  ]),
  ...act('Fair Credit Reporting Act, 15 U.S.C. §1681', 'US-FCRA', 'US', 'financial_law', '1971-04-25', [
    { s: '1681b', t: 'Permissible purposes of consumer reports', txt: 'A consumer reporting agency may furnish a consumer report only for permissible purposes, such as in connection with a credit transaction, employment (with the consumer\'s written authorization), insurance underwriting, or a legitimate business need initiated by the consumer.', kw: ['consumer report', 'permissible purpose', 'background check', 'FCRA 1681b'] },
    { s: '1681e', t: 'Compliance procedures and accuracy', txt: 'A consumer reporting agency shall maintain reasonable procedures to assure maximum possible accuracy of the information in consumer reports and to limit furnishing of reports to permissible purposes.', kw: ['maximum possible accuracy', 'reasonable procedures', 'FCRA 1681e'] },
  ]),
  ...act('Consolidated Omnibus Budget Reconciliation Act (COBRA), 29 U.S.C. §1161', 'US-COBRA', 'US', 'employment_law', '1986-04-07', [
    { s: '1161', t: 'Continuation of group health coverage', txt: 'A group health plan of an employer with 20 or more employees shall provide that qualified beneficiaries who would lose coverage on account of a qualifying event (such as termination or reduction of hours) may elect continuation coverage at their own expense for the statutory period.', kw: ['COBRA continuation', 'group health plan', 'qualifying event', 'COBRA 1161'] },
  ]),
  ...act('Genetic Information Nondiscrimination Act of 2008, 42 U.S.C. §2000ff', 'US-GINA', 'US', 'employment_law', '2009-11-21', [
    { s: '202', t: 'Employer practices — genetic information', txt: 'It is an unlawful employment practice for an employer to discriminate against an employee because of genetic information, or to request, require or purchase genetic information of an employee or family member except in narrowly defined circumstances.', kw: ['genetic information', 'discrimination', 'GINA 202'] },
  ]),
  ...act('Uniformed Services Employment and Reemployment Rights Act, 38 U.S.C. §4301', 'US-USERRA', 'US', 'employment_law', '1994-10-13', [
    { s: '4311', t: 'Discrimination against service members prohibited', txt: 'A person who is a member of, applies to be a member of, or performs service in a uniformed service shall not be denied initial employment, reemployment, retention, promotion, or any benefit of employment on the basis of that membership or service obligation.', kw: ['military service', 'reemployment rights', 'USERRA 4311'] },
  ]),
];

// ─── Privacy & technology (federal + key state) ──────────────────────────────
const US_PRIVACY: ExpansionStatute[] = [
  ...act('Children\'s Online Privacy Protection Act, 15 U.S.C. §6501', 'US-COPPA', 'US', 'data_protection', '2000-04-21', [
    { s: '6502', t: 'Regulation of unfair and deceptive acts in connection with collection of children\'s data', txt: 'It is unlawful for an operator of a website or online service directed to children, or with actual knowledge that it is collecting personal information from a child under 13, to collect such information without verifiable parental consent and without providing notice of its information practices.', kw: ['children privacy', 'parental consent', 'under 13', 'COPPA 6502'] },
  ]),
  ...act('Electronic Communications Privacy Act / Wiretap Act, 18 U.S.C. §2510', 'US-ECPA', 'US', 'technology_law', '1986-10-21', [
    { s: '2511', t: 'Interception and disclosure of wire, oral or electronic communications prohibited', txt: 'Any person who intentionally intercepts, endeavours to intercept, or discloses the contents of any wire, oral or electronic communication, knowing the information was obtained through interception, is subject to criminal and civil liability, subject to consent and provider exceptions.', kw: ['wiretap', 'interception', 'electronic communication', 'ECPA 2511'] },
  ]),
  ...act('Stored Communications Act, 18 U.S.C. §2701', 'US-SCA', 'US', 'technology_law', '1986-10-21', [
    { s: '2701', t: 'Unlawful access to stored communications', txt: 'Whoever intentionally accesses without authorization, or exceeds an authorization to access, a facility through which an electronic communication service is provided and thereby obtains, alters or prevents authorized access to a stored communication, is subject to criminal penalties.', kw: ['stored communications', 'unauthorized access', 'SCA 2701'] },
    { s: '2703', t: 'Required disclosure of customer communications or records', txt: 'A governmental entity may require a provider of electronic communication or remote computing service to disclose the contents of communications and customer records only pursuant to a warrant, court order or subpoena as specified, the standards differing by the age and nature of the data.', kw: ['government access', 'warrant', 'customer records', 'SCA 2703'] },
  ]),
  ...act('Controlling the Assault of Non-Solicited Pornography And Marketing (CAN-SPAM) Act, 15 U.S.C. §7701', 'US-CANSPAM', 'US', 'technology_law', '2004-01-01', [
    { s: '7704', t: 'Requirements for commercial electronic mail', txt: 'Senders of commercial email must not use false or misleading header information or deceptive subject lines, must include a functioning opt-out mechanism and a valid physical postal address, and must honor opt-out requests within ten business days.', kw: ['commercial email', 'opt-out', 'CAN-SPAM 7704'] },
  ]),
  ...act('Illinois Biometric Information Privacy Act, 740 ILCS 14', 'US-BIPA', 'US', 'data_protection', '2008-10-03', [
    { s: '15', t: 'Retention, collection and consent for biometric identifiers', txt: 'A private entity may not collect biometric identifiers or biometric information unless it first informs the subject in writing and obtains a written release, and must maintain a publicly available retention and destruction schedule; BIPA provides a private right of action with statutory damages (Rosenbach v. Six Flags).', kw: ['biometric privacy', 'written consent', 'private right of action', 'BIPA 15'] },
  ]),
  ...act('Virginia Consumer Data Protection Act, Va. Code §59.1-575', 'US-VCDPA', 'US', 'data_protection', '2023-01-01', [
    { s: '59.1-577', t: 'Consumer rights', txt: 'A consumer has the right to confirm whether a controller is processing their personal data and to access it, to correct inaccuracies, to delete personal data, to obtain a portable copy, and to opt out of processing for targeted advertising, sale, or certain profiling.', kw: ['consumer rights', 'opt out', 'data portability', 'VCDPA'] },
  ]),
  ...act('California Privacy Rights Act (CPRA), Cal. Civ. Code §1798.100', 'US-CPRA', 'US', 'data_protection', '2023-01-01', [
    { s: '1798.121', t: 'Right to limit use and disclosure of sensitive personal information', txt: 'A consumer has the right, at any time, to direct a business that collects sensitive personal information to limit its use and disclosure of that information to that which is necessary to perform the services or provide the goods reasonably expected by an average consumer.', kw: ['sensitive personal information', 'right to limit', 'CPRA 1798.121'] },
  ]),
  ...act('Family Educational Rights and Privacy Act, 20 U.S.C. §1232g', 'US-FERPA', 'US', 'data_protection', '1974-08-21', [
    { s: '1232g', t: 'Protection of education records', txt: 'Educational agencies and institutions receiving Federal funds must afford parents (and eligible students) the right to inspect and review education records and to seek amendment, and must not disclose personally identifiable information from education records without consent except in specified circumstances.', kw: ['education records', 'student privacy', 'FERPA 1232g'] },
  ]),
  ...act('Telephone Consumer Protection Act, 47 U.S.C. §227', 'US-TCPA', 'US', 'technology_law', '1991-12-20', [
    { s: '227', t: 'Restrictions on the use of automated telephone equipment', txt: 'It is unlawful to make any call (other than for emergency purposes or with prior express consent) using an automatic telephone dialing system or an artificial or prerecorded voice to a cellular telephone, and to send unsolicited advertisements to fax machines; the Act provides statutory damages per violation.', kw: ['robocalls', 'autodialer', 'prior express consent', 'TCPA 227'] },
  ]),
];

// ─── Consumer finance ────────────────────────────────────────────────────────
const US_FINCONSUMER: ExpansionStatute[] = [
  ...act('Truth in Lending Act, 15 U.S.C. §1601', 'US-TILA', 'US', 'financial_law', '1968-07-01', [
    { s: '1638', t: 'Disclosure requirements for consumer credit', txt: 'A creditor extending consumer credit must clearly and conspicuously disclose the finance charge, the annual percentage rate, the amount financed, the total of payments and the payment schedule, enabling consumers to compare the cost of credit.', kw: ['TILA', 'APR', 'finance charge', 'disclosure', 'TILA 1638'] },
  ]),
  ...act('Fair Debt Collection Practices Act, 15 U.S.C. §1692', 'US-FDCPA', 'US', 'financial_law', '1978-03-20', [
    { s: '1692e', t: 'False or misleading representations', txt: 'A debt collector may not use any false, deceptive or misleading representation or means in connection with the collection of any debt, including misrepresenting the amount or legal status of a debt or falsely implying affiliation with the government or an attorney.', kw: ['debt collection', 'false representation', 'FDCPA 1692e'] },
  ]),
  ...act('Equal Credit Opportunity Act, 15 U.S.C. §1691', 'US-ECOA', 'US', 'financial_law', '1974-10-28', [
    { s: '1691', t: 'Prohibited discrimination in credit transactions', txt: 'It is unlawful for any creditor to discriminate against any applicant with respect to any aspect of a credit transaction on the basis of race, color, religion, national origin, sex, marital status, age, or because the applicant receives public assistance; adverse action requires a statement of reasons.', kw: ['credit discrimination', 'adverse action', 'ECOA 1691'] },
  ]),
];

// ─── Antitrust (Celler-Kefauver amendment to Clayton §7) ─────────────────────
const US_ANTITRUST: ExpansionStatute[] = [
  ...act('Celler-Kefauver Antimerger Act of 1950', 'US-CELLER', 'US', 'competition_law', '1950-12-29', [
    { s: '7', t: 'Acquisition of assets lessening competition', txt: 'Amending Clayton Act §7, the Act closed the "asset loophole" by prohibiting acquisitions of both stock and assets of another corporation where, in any line of commerce in any section of the country, the effect may be substantially to lessen competition or to tend to create a monopoly.', kw: ['anti-merger', 'asset acquisition', 'Clayton 7 amendment', 'Celler-Kefauver'] },
  ]),
];

// ─── Bankruptcy chapter specifics (Title 11) ─────────────────────────────────
const US_BANKRUPTCY: ExpansionStatute[] = [
  ...act('Bankruptcy Code (Title 11 U.S.C.)', 'US-BANKRUPTCY11', 'US', 'insolvency_law', '1979-10-01', [
    { s: '365', t: 'Executory contracts and unexpired leases', txt: 'Subject to court approval, the trustee or debtor in possession may assume or reject any executory contract or unexpired lease of the debtor; assumption requires cure of defaults and adequate assurance of future performance, while rejection constitutes a pre-petition breach.', kw: ['executory contract', 'assume or reject', 'cure', 'Bankruptcy 365'] },
    { s: '507', t: 'Priorities of claims', txt: 'This section establishes the order of priority among unsecured claims for distribution, including domestic support obligations, administrative expenses, certain wages and employee benefit contributions, and specified tax claims, ahead of general unsecured creditors.', kw: ['priority claims', 'distribution', 'administrative expense', 'Bankruptcy 507'] },
    { s: '727', t: 'Chapter 7 discharge', txt: 'The court shall grant an individual debtor a discharge of pre-petition debts in a Chapter 7 liquidation unless a statutory ground for denial exists, such as fraudulent transfer, concealment of assets, false oath, or a prior discharge within the applicable period.', kw: ['Chapter 7', 'liquidation', 'discharge', 'Bankruptcy 727'] },
    { s: '1129', t: 'Chapter 11 plan confirmation', txt: 'The court shall confirm a plan of reorganization only if it meets the good-faith, best-interests, and feasibility requirements; where an impaired class rejects, the plan may still be confirmed by "cramdown" if it does not discriminate unfairly and is fair and equitable.', kw: ['Chapter 11', 'reorganization', 'cramdown', 'absolute priority', 'Bankruptcy 1129'] },
    { s: '1322', t: 'Contents of Chapter 13 plan', txt: 'A Chapter 13 plan shall provide for the submission of future earnings to the trustee, full payment of priority claims, and equal treatment within each class; the plan may modify the rights of secured and unsecured creditors, subject to limits on a debtor\'s principal residence mortgage.', kw: ['Chapter 13', 'repayment plan', 'wage earner', 'Bankruptcy 1322'] },
  ]),
];

// ─── Federal tax depth (Internal Revenue Code) ───────────────────────────────
const US_TAX: ExpansionStatute[] = [
  ...act('Internal Revenue Code (26 U.S.C.)', 'US-IRC', 'US', 'tax_law', '1986-10-22', [
    { s: '61', t: 'Gross income defined', txt: 'Except as otherwise provided, gross income means all income from whatever source derived, including compensation for services, business income, gains from dealings in property, interest, rents, royalties, dividends and other accessions to wealth (Commissioner v. Glenshaw Glass).', kw: ['gross income', 'all income', 'IRC 61', 'Glenshaw Glass'] },
    { s: '351', t: 'Transfer to corporation controlled by transferor', txt: 'No gain or loss is recognized if property is transferred to a corporation by one or more persons solely in exchange for stock and, immediately after the exchange, such persons are in control (at least 80%) of the corporation — the principal nonrecognition rule for incorporations.', kw: ['nonrecognition', 'incorporation', 'control', 'IRC 351'] },
    { s: '368', t: 'Definitions relating to corporate reorganizations', txt: 'This section defines the categories of tax-free reorganizations (Types A through G), including statutory mergers, stock-for-stock and stock-for-asset acquisitions, recapitalizations and divisive reorganizations, which qualify for nonrecognition treatment subject to continuity and business-purpose doctrines.', kw: ['reorganization', 'tax-free merger', 'continuity of interest', 'IRC 368'] },
    { s: '1001', t: 'Determination of gain or loss', txt: 'The gain from the sale or other disposition of property is the excess of the amount realized over the adjusted basis, and the loss is the excess of the adjusted basis over the amount realized; the entire amount of realized gain or loss is generally recognized unless a nonrecognition provision applies.', kw: ['realization', 'amount realized', 'adjusted basis', 'IRC 1001'] },
    { s: '1031', t: 'Exchange of real property held for productive use or investment', txt: 'No gain or loss is recognized on the exchange of real property held for productive use in a trade or business or for investment if such property is exchanged solely for real property of like kind to be similarly held; following the 2017 reform like-kind treatment is limited to real property.', kw: ['like-kind exchange', '1031 exchange', 'real property', 'IRC 1031'] },
    { s: '501(c)(3)', t: 'Tax-exempt charitable organizations', txt: 'Corporations and other entities organized and operated exclusively for religious, charitable, scientific, educational or other exempt purposes are exempt from federal income tax, provided no part of net earnings inures to a private shareholder and they do not engage in prohibited political campaign activity.', kw: ['tax-exempt', 'nonprofit', 'charitable', 'IRC 501c3'] },
  ]),
];

// ─── Securities depth (Reg D / Rule 144 / Williams Act / SOX) ────────────────
const US_SECURITIES: ExpansionStatute[] = [
  ...act('Securities Act of 1933 (15 U.S.C. §77a et seq.)', 'US-SA1933', 'US', 'securities_law', '1933-05-27', [
    { s: 'Rule 144', t: 'Resale of restricted and control securities', txt: 'Rule 144 provides a safe harbor under which holders of restricted or control securities may resell them publicly without registration if conditions are met, including a holding period, adequate current public information, volume limitations and manner-of-sale requirements.', kw: ['Rule 144', 'restricted securities', 'safe harbor', 'resale'] },
    { s: 'Rule 506', t: 'Regulation D private placement safe harbor', txt: 'Rule 506 of Regulation D permits an issuer to raise an unlimited amount from accredited investors (and, under 506(b), up to 35 sophisticated non-accredited investors) without registration; Rule 506(c) permits general solicitation provided all purchasers are verified accredited investors.', kw: ['Regulation D', 'Rule 506', 'accredited investor', 'private placement'] },
  ]),
  ...act('Securities Exchange Act of 1934 (15 U.S.C. §78a et seq.)', 'US-SEA1934', 'US', 'securities_law', '1934-06-06', [
    { s: '13(d)', t: 'Beneficial ownership reporting (Williams Act)', txt: 'Any person who acquires beneficial ownership of more than five percent of a class of registered equity securities must, within the prescribed period, file a Schedule 13D with the SEC disclosing the holdings, source of funds and purpose of the acquisition.', kw: ['Schedule 13D', 'beneficial ownership', 'five percent', 'Williams Act'] },
    { s: '14(d)', t: 'Tender offer rules (Williams Act)', txt: 'A person making a tender offer that would result in beneficial ownership of more than five percent must file disclosure with the SEC and comply with substantive protections for shareholders, including withdrawal rights, pro rata acceptance and the best-price rule.', kw: ['tender offer', 'Williams Act', 'best price', 'SEA 14d'] },
    { s: '15', t: 'Registration and regulation of brokers and dealers', txt: 'It is unlawful for a broker or dealer to use interstate commerce to effect transactions in securities unless registered with the SEC; registered broker-dealers are subject to conduct, financial responsibility and supervisory requirements.', kw: ['broker-dealer', 'registration', 'SEA 15'] },
  ]),
  ...act('Sarbanes-Oxley Act of 2002', 'US-SOX', 'US', 'securities_law', '2002-07-30', [
    { s: '906', t: 'Criminal certification of periodic financial reports', txt: 'Each periodic report containing financial statements shall be accompanied by a written certification by the chief executive officer and chief financial officer that the report fully complies with the securities laws and fairly presents the financial condition; a knowing or willful false certification carries criminal penalties.', kw: ['criminal certification', 'CEO CFO', 'false certification', 'SOX 906'] },
    { s: '802', t: 'Destruction, alteration or falsification of records', txt: 'Whoever knowingly alters, destroys, conceals or falsifies any record or document with intent to impede or influence a federal investigation or bankruptcy, and auditors who fail to retain working papers for the prescribed period, are subject to criminal penalties.', kw: ['document destruction', 'obstruction', 'record retention', 'SOX 802'] },
  ]),
];

// ─── Corporate governance depth (Delaware) ───────────────────────────────────
const US_CORP: ExpansionStatute[] = [
  ...act('Delaware General Corporation Law (8 Del. C.)', 'US-DGCL', 'US', 'corporate_law', '1967-07-03', [
    { s: '220', t: 'Inspection of books and records', txt: 'Any stockholder, upon written demand under oath stating a proper purpose, has the right during usual business hours to inspect the corporation\'s stock ledger, list of stockholders and other books and records reasonably related to that purpose, and to make copies.', kw: ['books and records', 'inspection', 'proper purpose', 'DGCL 220'] },
    { s: '203', t: 'Business combinations with interested stockholders', txt: 'A corporation shall not engage in any business combination with an interested stockholder (generally a 15% owner) for three years following the time the stockholder became interested, unless board or supermajority approval requirements are satisfied — Delaware\'s principal anti-takeover statute.', kw: ['anti-takeover', 'interested stockholder', 'business combination', 'DGCL 203'] },
  ]),
];

// ─── Intellectual property depth ─────────────────────────────────────────────
const US_IP: ExpansionStatute[] = [
  ...act('Patent Act (Title 35 U.S.C.)', 'US-PATENT35', 'US', 'intellectual_property', '1952-07-19', [
    { s: '102', t: 'Conditions for patentability — novelty', txt: 'A person is entitled to a patent unless the claimed invention was patented, described in a printed publication, or in public use, on sale, or otherwise available to the public before the effective filing date; the America Invents Act adopted a first-inventor-to-file system with a one-year grace period.', kw: ['novelty', 'prior art', 'first to file', 'Patent 102'] },
    { s: '103', t: 'Conditions for patentability — non-obviousness', txt: 'A patent may not be obtained if the differences between the claimed invention and the prior art are such that the invention as a whole would have been obvious before the effective filing date to a person of ordinary skill in the art (Graham v. John Deere; KSR v. Teleflex).', kw: ['non-obviousness', 'PHOSITA', 'KSR', 'Patent 103'] },
    { s: '284', t: 'Damages for patent infringement', txt: 'Upon a finding of infringement the court shall award damages adequate to compensate, in no event less than a reasonable royalty, together with interest and costs, and the court may increase the damages up to three times for willful infringement.', kw: ['patent damages', 'reasonable royalty', 'enhanced damages', 'Patent 284'] },
  ]),
  ...act('Lanham Act (15 U.S.C. §1051 et seq.)', 'US-LANHAM', 'US', 'intellectual_property', '1947-07-05', [
    { s: '43(c)', t: 'Dilution by blurring or tarnishment of famous marks', txt: 'The owner of a famous, distinctive mark is entitled to an injunction against another person who, after the mark has become famous, commences use of a mark in commerce that is likely to cause dilution by blurring or dilution by tarnishment, regardless of actual or likely confusion or competition.', kw: ['trademark dilution', 'famous mark', 'blurring', 'tarnishment', 'Lanham 43c'] },
  ]),
  ...act('Copyright Act of 1976 (17 U.S.C.)', 'US-COPYRIGHT76', 'US', 'intellectual_property', '1978-01-01', [
    { s: '501', t: 'Infringement of copyright', txt: 'Anyone who violates any of the exclusive rights of the copyright owner, or imports copies in violation of the Act, is an infringer; the legal or beneficial owner of an exclusive right is entitled to institute an action for any infringement of that right committed while he or she owns it.', kw: ['copyright infringement', 'exclusive rights', 'standing', 'Copyright 501'] },
    { s: '504', t: 'Remedies for infringement — damages and profits', txt: 'An infringer is liable either for the copyright owner\'s actual damages plus the infringer\'s additional profits, or, at the owner\'s election before final judgment, for statutory damages per work infringed, with enhanced statutory damages available for willful infringement.', kw: ['statutory damages', 'actual damages', 'willful infringement', 'Copyright 504'] },
  ]),
];

// ─── White-collar / federal criminal ─────────────────────────────────────────
const US_WHITECOLLAR: ExpansionStatute[] = [
  ...act('Racketeer Influenced and Corrupt Organizations Act (RICO), 18 U.S.C. §1961', 'US-RICO', 'US', 'criminal_law', '1970-10-15', [
    { s: '1962', t: 'Prohibited activities', txt: 'It is unlawful for any person employed by or associated with an enterprise engaged in interstate commerce to conduct or participate in the conduct of the enterprise\'s affairs through a pattern of racketeering activity, or to acquire or maintain an interest in an enterprise through such a pattern; treble damages are available in civil RICO.', kw: ['racketeering', 'pattern', 'enterprise', 'treble damages', 'RICO 1962'] },
  ]),
  ...act('Mail Fraud Statute, 18 U.S.C. §1341', 'US-MAILFRAUD', 'US', 'criminal_law', '1872-06-08', [
    { s: '1341', t: 'Frauds and swindles', txt: 'Whoever, having devised a scheme to defraud or to obtain money or property by false pretenses, uses the mails or a private interstate carrier to execute the scheme, is guilty of mail fraud, punishable by fine and imprisonment.', kw: ['mail fraud', 'scheme to defraud', 'false pretenses', 'Section 1341'] },
  ]),
  ...act('Wire Fraud Statute, 18 U.S.C. §1343', 'US-WIREFRAUD', 'US', 'criminal_law', '1952-07-16', [
    { s: '1343', t: 'Fraud by wire, radio or television', txt: 'Whoever, having devised a scheme to defraud or to obtain money or property by false pretenses, transmits by wire, radio or television communication in interstate or foreign commerce any writings, signs or sounds to execute the scheme, is guilty of wire fraud, punishable by fine and imprisonment.', kw: ['wire fraud', 'scheme to defraud', 'interstate communication', 'Section 1343'] },
  ]),
];

// ─── Evidence (Federal Rules of Evidence) ────────────────────────────────────
const US_EVIDENCE: ExpansionStatute[] = [
  ...act('Federal Rules of Evidence', 'US-FRE', 'US', 'evidence_law', '1975-07-01', [
    { s: 'Rule 401', t: 'Test for relevant evidence', txt: 'Evidence is relevant if it has any tendency to make a fact more or less probable than it would be without the evidence, and the fact is of consequence in determining the action; relevant evidence is generally admissible under Rule 402.', kw: ['relevance', 'probative', 'FRE 401'] },
    { s: 'Rule 702', t: 'Testimony by expert witnesses', txt: 'A qualified expert may testify in the form of an opinion if the proponent demonstrates it is more likely than not that the testimony is based on sufficient facts, is the product of reliable principles and methods, and reflects a reliable application of those methods to the facts (Daubert v. Merrell Dow).', kw: ['expert testimony', 'Daubert', 'reliability', 'FRE 702'] },
  ]),
];

// ─── Immigration & disability access ─────────────────────────────────────────
const US_IMMIG_ACCESS: ExpansionStatute[] = [
  ...act('Immigration and Nationality Act (8 U.S.C. §1101)', 'US-INA', 'US', 'immigration_law', '1952-06-27', [
    { s: '101', t: 'Definitions', txt: 'This section defines the principal terms of US immigration law, including "immigrant", "nonimmigrant" classifications, "lawful permanent resident", "refugee" and "alien", which determine eligibility for visas, status and benefits.', kw: ['immigration definitions', 'nonimmigrant', 'lawful permanent resident', 'INA 101'] },
    { s: '212', t: 'Inadmissible aliens', txt: 'This section enumerates the grounds on which aliens are inadmissible to the United States, including health, criminal, security, public-charge and prior-immigration-violation grounds, and provides waivers for certain grounds.', kw: ['inadmissibility', 'grounds', 'waiver', 'public charge', 'INA 212'] },
    { s: '245', t: 'Adjustment of status to permanent resident', txt: 'The status of an alien who was inspected and admitted or paroled may be adjusted to that of a lawful permanent resident if the alien applies, is eligible to receive an immigrant visa, is admissible, and an immigrant visa is immediately available.', kw: ['adjustment of status', 'green card', 'immigrant visa', 'INA 245'] },
  ]),
  ...act('Americans with Disabilities Act of 1990 (42 U.S.C. §12101)', 'US-ADA', 'US', 'administrative_law', '1992-07-26', [
    { s: '12132', t: 'Title II — public services nondiscrimination', txt: 'No qualified individual with a disability shall, by reason of such disability, be excluded from participation in or be denied the benefits of the services, programs or activities of a public entity, or be subjected to discrimination by any such entity.', kw: ['Title II', 'public entity', 'disability access', 'ADA 12132'] },
    { s: '12182', t: 'Title III — public accommodations', txt: 'No individual shall be discriminated against on the basis of disability in the full and equal enjoyment of the goods, services, facilities and accommodations of any place of public accommodation; covered entities must make reasonable modifications and remove architectural barriers where readily achievable.', kw: ['Title III', 'public accommodation', 'reasonable modification', 'ADA 12182'] },
  ]),
];

export const EXPANSION_STATUTES_VOL6_US: ExpansionStatute[] = [
  ...US_CONST,
  ...US_ENV,
  ...US_LABOR,
  ...US_PRIVACY,
  ...US_FINCONSUMER,
  ...US_ANTITRUST,
  ...US_BANKRUPTCY,
  ...US_TAX,
  ...US_SECURITIES,
  ...US_CORP,
  ...US_IP,
  ...US_WHITECOLLAR,
  ...US_EVIDENCE,
  ...US_IMMIG_ACCESS,
];
