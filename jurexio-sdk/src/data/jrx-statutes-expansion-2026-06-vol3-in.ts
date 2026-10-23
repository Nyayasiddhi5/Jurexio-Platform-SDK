/**
 * Jurexio - Statute seed EXPANSION Vol.3 (India deep coverage)
 * NV-STATUTE-EXPANSION-003
 * ---------------------------------------------------------------------------
 * PURE DATA MODULE (no DB / no side-effect imports). Substantially deepens the
 * Indian statute corpus across ALL major practice areas with the latest codes
 * (BNS / BNSS / BSA 2023) plus the principal Acts relied on for case analysis,
 * drafting, citation verification and practice-area classification.
 *
 * Section texts are concise, accurate paraphrases suitable for RAG grounding +
 * citation, keyed by the canonical (jurisdiction, act_short_title,
 * section_number) unique tuple so they upsert cleanly alongside existing rows.
 *
 * Act short titles here are intentionally NEW (not in getIndiaStatutes()) except
 * the BNS/BNSS/BSA extensions, which add section numbers NOT already seeded.
 */
import { act, type ExpansionStatute } from './jrx-statutes-expansion-2026-06.js';

// ─── Criminal law — BNS 2023 (additional high-citation sections) ─────────────
const IN_BNS_EXT: ExpansionStatute[] = [
  ...act('Bharatiya Nyaya Sanhita, 2023', 'BNS', 'IN', 'criminal_law', '2024-07-01', [
    { s: '111', t: 'Organised crime', txt: 'Any continuing unlawful activity including kidnapping, extortion, contract killing, land grabbing, financial scams or cyber-crime committed by a person on behalf of a crime syndicate, by use of violence, threat, intimidation or coercion, constitutes organised crime, punishable with imprisonment for life or death where it results in death, and otherwise with rigorous imprisonment of not less than five years.', kw: ['organised crime', 'syndicate', 'BNS 111'] },
    { s: '113', t: 'Terrorist act', txt: 'Whoever does any act with intent to threaten the unity, integrity, sovereignty, security or economic security of India or to strike terror in the people by using bombs, firearms, hazardous substances or other means commits a terrorist act, punishable with death or imprisonment for life where it causes death.', kw: ['terrorist act', 'terror', 'BNS 113'] },
    { s: '117', t: 'Voluntarily causing grievous hurt', txt: 'Whoever voluntarily causes grievous hurt shall be punished with imprisonment of either description for a term which may extend to seven years and shall also be liable to fine.', kw: ['grievous hurt', 'BNS 117'] },
    { s: '137', t: 'Kidnapping', txt: 'Kidnapping is either from India or from lawful guardianship; whoever conveys any person beyond the limits of India, or takes a minor under eighteen (female) or sixteen (male) or a person of unsound mind out of the keeping of the lawful guardian without consent, commits kidnapping.', kw: ['kidnapping', 'guardianship', 'BNS 137'] },
    { s: '140', t: 'Kidnapping or abduction for ransom', txt: 'Whoever kidnaps or abducts any person and keeps them in detention in order to demand ransom shall be punished with death, or imprisonment for life, and shall also be liable to fine.', kw: ['kidnapping for ransom', 'abduction', 'BNS 140'] },
    { s: '85', t: 'Cruelty by husband or relative', txt: 'Whoever, being the husband or relative of the husband of a woman, subjects such woman to cruelty shall be punished with imprisonment up to three years and shall also be liable to fine.', kw: ['cruelty', 'dowry harassment', 'BNS 85'] },
    { s: '152', t: 'Act endangering sovereignty, unity and integrity of India', txt: 'Whoever, by words, signs, visible representation, electronic communication or otherwise, excites or attempts to excite secession, armed rebellion or subversive activities, or endangers the sovereignty, unity and integrity of India, shall be punished with imprisonment for life or up to seven years and fine.', kw: ['sedition successor', 'sovereignty', 'BNS 152'] },
    { s: '356', t: 'Defamation', txt: 'Whoever by words, signs or visible representations makes or publishes any imputation concerning any person intending to harm the reputation of that person commits defamation, punishable with simple imprisonment up to two years, or fine, or community service.', kw: ['defamation', 'reputation', 'BNS 356'] },
  ]),
];

// ─── Criminal procedure — BNSS 2023 (additional) + CrPC 1973 (predecessor) ───
const IN_PROC: ExpansionStatute[] = [
  ...act('Bharatiya Nagarik Suraksha Sanhita, 2023', 'BNSS', 'IN', 'criminal_procedure', '2024-07-01', [
    { s: '183', t: 'Recording of confessions and statements', txt: 'Any Magistrate may record any confession or statement made to him in the course of an investigation; confessions shall be recorded only after explaining that the person is not bound to make it and that it may be used against him, and audio-video means may be employed.', kw: ['confession', 'statement', 'magistrate', 'BNSS 183'] },
    { s: '193', t: 'Report of police officer on completion of investigation', txt: 'On completion of investigation the officer in charge shall forward to the Magistrate a report (charge-sheet) in the prescribed form stating the names of parties, nature of information, names of witnesses, the offence and whether the accused has been arrested or released; the investigation shall be completed within ninety days for specified offences.', kw: ['charge-sheet', 'final report', 'investigation', 'BNSS 193'] },
    { s: '480', t: 'Bail in non-bailable offence', txt: 'When a person accused of a non-bailable offence is arrested, he may be released on bail in the discretion of the court, but not where there are reasonable grounds to believe he is guilty of an offence punishable with death or imprisonment for life, subject to exceptions for minors, women and the sick.', kw: ['bail', 'non-bailable', 'BNSS 480'] },
    { s: '528', t: 'Inherent powers of the High Court', txt: 'Nothing in this Sanhita shall limit the inherent power of the High Court to make orders necessary to give effect to any order under this Sanhita, to prevent abuse of the process of any court, or otherwise to secure the ends of justice.', kw: ['inherent powers', 'quashing', 'High Court', 'BNSS 528'] },
  ]),
  ...act('Code of Criminal Procedure, 1973', 'CRPC', 'IN', 'criminal_procedure', '1974-04-01', [
    { s: '154', t: 'Information in cognizable cases', txt: 'Every information relating to the commission of a cognizable offence given orally to an officer in charge of a police station shall be reduced to writing, read over to the informant, signed by the person giving it, and entered in a book (the First Information Report).', kw: ['FIR', 'CrPC 154', 'cognizable'] },
    { s: '161', t: 'Examination of witnesses by police', txt: 'Any police officer making an investigation may examine orally any person supposed to be acquainted with the facts; such person is bound to answer truly all questions other than those which would expose him to a criminal charge.', kw: ['witness examination', 'CrPC 161'] },
    { s: '197', t: 'Prosecution of judges and public servants — sanction', txt: 'When a public servant is accused of an offence alleged to have been committed while acting in the discharge of official duty, no court shall take cognizance except with the previous sanction of the appropriate Government.', kw: ['sanction', 'public servant', 'CrPC 197'] },
    { s: '438', t: 'Anticipatory bail', txt: 'When a person has reason to believe that he may be arrested on accusation of a non-bailable offence, he may apply to the High Court or Court of Session for a direction that in the event of arrest he shall be released on bail.', kw: ['anticipatory bail', 'CrPC 438'] },
    { s: '482', t: 'Inherent powers of High Court', txt: 'Nothing in this Code shall be deemed to limit or affect the inherent powers of the High Court to make such orders as may be necessary to prevent abuse of the process of any Court or otherwise to secure the ends of justice.', kw: ['inherent powers', 'quashing FIR', 'CrPC 482'] },
  ]),
  ...act('Bharatiya Sakshya Adhiniyam, 2023', 'BSA', 'IN', 'evidence_law', '2024-07-01', [
    { s: '3', t: 'Evidence may be given of facts in issue and relevant facts', txt: 'Evidence may be given in any suit or proceeding of the existence or non-existence of every fact in issue and of such other facts as are declared relevant, and of no others.', kw: ['relevancy', 'fact in issue', 'BSA 3'] },
    { s: '61', t: 'Admissibility of electronic or digital records', txt: 'Nothing in this Adhiniyam shall deny the admissibility of electronic or digital records on the ground that it is an electronic record, and such record shall have the same legal effect as a paper record subject to the certificate requirements.', kw: ['electronic evidence', 'admissibility', 'BSA 61'] },
    { s: '105', t: 'Burden of proving fact especially within knowledge', txt: 'When any fact is especially within the knowledge of any person, the burden of proving that fact is upon him.', kw: ['burden of proof', 'special knowledge', 'BSA 105'] },
  ]),
];

// ─── Corporate / commercial / banking / financial ───────────────────────────
const IN_CORP: ExpansionStatute[] = [
  ...act('Indian Partnership Act, 1932', 'IPA1932', 'IN', 'corporate_law', '1932-10-01', [
    { s: '4', t: 'Definition of partnership', txt: 'Partnership is the relation between persons who have agreed to share the profits of a business carried on by all or any of them acting for all; persons who have entered into partnership are called partners and collectively a firm.', kw: ['partnership', 'firm', 'partners', 'IPA 4'] },
    { s: '18', t: 'Partner to be agent of the firm', txt: 'Subject to the provisions of this Act, a partner is the agent of the firm for the purposes of the business of the firm.', kw: ['agency', 'partner', 'IPA 18'] },
    { s: '69', t: 'Effect of non-registration', txt: 'No suit to enforce a right arising from a contract or conferred by this Act shall be instituted in any court by or on behalf of an unregistered firm against any third party or between partners, subject to exceptions.', kw: ['non-registration', 'bar to suit', 'IPA 69'] },
  ]),
  ...act('Limited Liability Partnership Act, 2008', 'LLP2008', 'IN', 'corporate_law', '2009-03-31', [
    { s: '3', t: 'LLP to be body corporate', txt: 'A limited liability partnership is a body corporate formed and incorporated under this Act and is a legal entity separate from its partners, having perpetual succession.', kw: ['LLP', 'body corporate', 'separate entity', 'LLP 3'] },
    { s: '28', t: 'Extent of liability of partner', txt: 'A partner is not personally liable, directly or indirectly, for an obligation of the LLP solely by reason of being a partner; liability of the LLP is met out of its property.', kw: ['limited liability', 'partner liability', 'LLP 28'] },
  ]),
  ...act('Sale of Goods Act, 1930', 'SOGA1930', 'IN', 'contract_law', '1930-07-01', [
    { s: '4', t: 'Sale and agreement to sell', txt: 'A contract of sale of goods is a contract whereby the seller transfers or agrees to transfer the property in goods to the buyer for a price; where transfer is to take place at a future time it is an agreement to sell.', kw: ['sale', 'agreement to sell', 'SOGA 4'] },
    { s: '16', t: 'Implied conditions as to quality or fitness', txt: 'There is no implied warranty as to quality or fitness except where the buyer makes known the particular purpose and relies on the seller skill, or where goods are bought by description from a seller dealing in such goods (merchantable quality).', kw: ['merchantable quality', 'fitness for purpose', 'SOGA 16'] },
    { s: '19', t: 'Property passes when intended to pass', txt: 'Where there is a contract for sale of specific or ascertained goods the property in them is transferred to the buyer at such time as the parties intend it to be transferred.', kw: ['passing of property', 'risk', 'SOGA 19'] },
  ]),
  ...act('Competition Act, 2002', 'COMPETITION2002', 'IN', 'competition_law', '2003-03-31', [
    { s: '3', t: 'Anti-competitive agreements', txt: 'No enterprise shall enter into any agreement in respect of production, supply, distribution, storage or acquisition of goods or services which causes or is likely to cause an appreciable adverse effect on competition in India; such agreements are void.', kw: ['anti-competitive agreement', 'cartel', 'AAEC', 'Competition 3'] },
    { s: '4', t: 'Abuse of dominant position', txt: 'No enterprise or group shall abuse its dominant position by imposing unfair or discriminatory conditions or prices, limiting production or markets, or using its position in one market to enter or protect another market.', kw: ['dominant position', 'abuse', 'Competition 4'] },
    { s: '5', t: 'Combinations', txt: 'The acquisition of control, shares, voting rights or assets, or a merger or amalgamation, that crosses the prescribed asset or turnover thresholds is a combination regulated by the Commission.', kw: ['merger control', 'combination', 'CCI', 'Competition 5'] },
  ]),
  ...act('Securitisation and Reconstruction of Financial Assets and Enforcement of Security Interest Act, 2002', 'SARFAESI', 'IN', 'banking_law', '2002-06-21', [
    { s: '13', t: 'Enforcement of security interest', txt: 'Where a borrower defaults in repayment of a secured debt classified as a non-performing asset, the secured creditor may, after a sixty-day notice, take possession of the secured assets, take over management, or sell or lease them without intervention of the court.', kw: ['SARFAESI', 'security enforcement', 'NPA', 'possession', 'SARFAESI 13'] },
    { s: '17', t: 'Application to Debts Recovery Tribunal', txt: 'Any person aggrieved by measures taken by a secured creditor under section 13 may make an application to the Debts Recovery Tribunal within forty-five days.', kw: ['DRT', 'appeal', 'SARFAESI 17'] },
  ]),
  ...act('Banking Regulation Act, 1949', 'BRA1949', 'IN', 'banking_law', '1949-03-16', [
    { s: '5', t: 'Definition of banking', txt: 'Banking means the accepting, for the purpose of lending or investment, of deposits of money from the public, repayable on demand or otherwise, and withdrawable by cheque, draft, order or otherwise.', kw: ['banking', 'deposits', 'BRA 5'] },
    { s: '22', t: 'Licensing of banking companies', txt: 'No company shall carry on banking business in India unless it holds a licence issued by the Reserve Bank of India, which may be granted subject to conditions.', kw: ['banking licence', 'RBI', 'BRA 22'] },
  ]),
  ...act('Reserve Bank of India Act, 1934', 'RBIACT', 'IN', 'banking_law', '1935-04-01', [
    { s: '22', t: 'Sole right to issue bank notes', txt: 'The Reserve Bank shall have the sole right to issue bank notes in India, and may issue notes of such denominations as the Central Government may specify.', kw: ['currency', 'bank notes', 'RBI', 'RBI Act 22'] },
    { s: '45-I', t: 'Definitions relating to non-banking institutions', txt: 'Non-banking financial company means a financial institution which is a company, and which carries on as its business the receiving of deposits or lending in any manner, subject to regulation by the Reserve Bank.', kw: ['NBFC', 'financial institution', 'RBI Act 45I'] },
  ]),
  ...act('Insurance Act, 1938', 'INSURANCE1938', 'IN', 'financial_law', '1938-07-01', [
    { s: '45', t: 'Policy not to be called in question on ground of misstatement after three years', txt: 'No policy of life insurance shall be called in question on any ground whatsoever after the expiry of three years from the date of issuance, commencement of risk, or revival, except on proof of fraud.', kw: ['insurance', 'repudiation', 'three-year bar', 'Insurance 45'] },
  ]),
  ...act('Prevention of Money-Laundering Act, 2002', 'PMLA', 'IN', 'criminal_law', '2005-07-01', [
    { s: '3', t: 'Offence of money-laundering', txt: 'Whoever directly or indirectly attempts to indulge or knowingly assists or is a party to or is actually involved in any process or activity connected with the proceeds of crime including its concealment, possession, acquisition or use and projecting it as untainted property, is guilty of money-laundering.', kw: ['money laundering', 'proceeds of crime', 'PMLA 3'] },
    { s: '5', t: 'Attachment of property involved in money-laundering', txt: 'Where the Director or authorised officer has reason to believe that any person is in possession of proceeds of crime likely to be concealed, he may provisionally attach such property for a period not exceeding one hundred and eighty days.', kw: ['attachment', 'ED', 'proceeds', 'PMLA 5'] },
    { s: '45', t: 'Offences to be cognizable and non-bailable', txt: 'Offences under this Act are cognizable and non-bailable; bail is subject to the twin conditions that the court is satisfied there are reasonable grounds for believing the accused is not guilty and is not likely to commit any offence while on bail.', kw: ['twin conditions', 'bail', 'PMLA 45'] },
  ]),
];

// ─── Tax & intellectual property ─────────────────────────────────────────────
const IN_TAX_IP: ExpansionStatute[] = [
  ...act('Income-tax Act, 1961', 'ITAX1961', 'IN', 'tax_law', '1962-04-01', [
    { s: '4', t: 'Charge of income-tax', txt: 'Where any Central Act enacts that income-tax shall be charged for any assessment year at any rate, income-tax at that rate shall be charged for that year in respect of the total income of the previous year of every person.', kw: ['charge of tax', 'assessment year', 'IT Act 4'] },
    { s: '9', t: 'Income deemed to accrue or arise in India', txt: 'Income accruing through any business connection in India, property in India, asset or source of income in India, or transfer of a capital asset situate in India, is deemed to accrue or arise in India.', kw: ['income deemed to accrue', 'business connection', 'IT Act 9'] },
    { s: '37', t: 'General deduction for business expenditure', txt: 'Any expenditure, not being capital or personal expenditure, laid out wholly and exclusively for the purposes of the business or profession is allowed as a deduction in computing income under that head.', kw: ['business deduction', 'allowable expenditure', 'IT Act 37'] },
    { s: '147', t: 'Income escaping assessment (reassessment)', txt: 'If the Assessing Officer has information which suggests that income chargeable to tax has escaped assessment, he may, subject to the prescribed procedure and approvals, assess or reassess such income.', kw: ['reassessment', 'escaped income', 'IT Act 147'] },
  ]),
  ...act('Patents Act, 1970', 'PATENTS1970', 'IN', 'intellectual_property', '1972-04-20', [
    { s: '3', t: 'Inventions not patentable', txt: 'What is not an invention includes frivolous claims, mere discovery of a scientific principle, mere discovery of a new form of a known substance which does not enhance efficacy, methods of agriculture, treatment of humans or animals, and computer programmes or algorithms per se.', kw: ['not patentable', 'evergreening', 'efficacy', 'Patents 3'] },
    { s: '53', t: 'Term of patent', txt: 'The term of every patent granted shall be twenty years from the date of filing of the application.', kw: ['patent term', '20 years', 'Patents 53'] },
    { s: '84', t: 'Compulsory licences', txt: 'At any time after three years from grant, any person may apply for a compulsory licence on the grounds that the reasonable requirements of the public have not been satisfied, the patented invention is not available at a reasonably affordable price, or it is not worked in India.', kw: ['compulsory licence', 'affordable price', 'Patents 84'] },
  ]),
  ...act('Trade Marks Act, 1999', 'TMARKS1999', 'IN', 'intellectual_property', '2003-09-15', [
    { s: '2', t: 'Definition of trade mark', txt: 'Trade mark means a mark capable of being represented graphically and of distinguishing the goods or services of one person from those of others, and may include the shape of goods, packaging and combination of colours.', kw: ['trade mark', 'distinctiveness', 'Trademarks 2'] },
    { s: '29', t: 'Infringement of registered trade marks', txt: 'A registered trade mark is infringed by a person who, not being a registered proprietor or permitted user, uses in the course of trade a mark which is identical with or deceptively similar to the registered mark in relation to goods or services for which it is registered.', kw: ['infringement', 'deceptively similar', 'Trademarks 29'] },
  ]),
  ...act('Copyright Act, 1957', 'COPYRIGHT1957', 'IN', 'intellectual_property', '1958-01-21', [
    { s: '14', t: 'Meaning of copyright', txt: 'Copyright means the exclusive right to do or authorise the doing of acts such as reproduction, issue of copies, performance, communication to the public, adaptation and translation in respect of a literary, dramatic, musical, artistic work, cinematograph film or sound recording.', kw: ['copyright', 'exclusive rights', 'Copyright 14'] },
    { s: '51', t: 'When copyright infringed', txt: 'Copyright is infringed when any person, without a licence, does anything the exclusive right to do which is conferred on the owner, or permits a place to be used for communication of infringing works for profit, or makes, imports or distributes infringing copies.', kw: ['infringement', 'Copyright 51'] },
    { s: '52', t: 'Fair dealing — acts not infringement', txt: 'Certain acts do not constitute infringement, including fair dealing with a work for private or personal use, research, criticism, review, reporting of current events, and use for judicial or educational purposes.', kw: ['fair dealing', 'exceptions', 'Copyright 52'] },
  ]),
  ...act('Designs Act, 2000', 'DESIGNS2000', 'IN', 'intellectual_property', '2001-05-11', [
    { s: '2', t: 'Definition of design', txt: 'Design means only the features of shape, configuration, pattern, ornament or composition of lines or colours applied to any article by any industrial process, judged solely by the eye, and excludes any mode or principle of construction or anything which is a mere mechanical device.', kw: ['design', 'industrial design', 'Designs 2'] },
    { s: '11', t: 'Copyright in registered design', txt: 'When a design is registered, the registered proprietor has copyright in the design for ten years from the date of registration, extendable by a further five years.', kw: ['design copyright', 'term', 'Designs 11'] },
  ]),
];

// ─── Labour & employment (4 new Labour Codes + classic Acts) ─────────────────
const IN_LABOUR: ExpansionStatute[] = [
  ...act('Code on Wages, 2019', 'WAGECODE2019', 'IN', 'employment_law', '2019-08-08', [
    { s: '5', t: 'Payment of minimum rate of wages', txt: 'No employer shall pay to any employee wages less than the minimum rate of wages notified by the appropriate Government; the floor wage may be fixed by the Central Government taking into account the minimum living standards.', kw: ['minimum wage', 'floor wage', 'Wage Code 5'] },
    { s: '43', t: 'Responsibility for payment of wages', txt: 'Every employer shall pay all wages required under this Code to the employees employed by him; in case of contractor employees, the principal employer is liable where the contractor fails to pay.', kw: ['payment of wages', 'principal employer', 'Wage Code 43'] },
  ]),
  ...act('Industrial Relations Code, 2020', 'IRCODE2020', 'IN', 'employment_law', '2020-09-29', [
    { s: '2', t: 'Definitions — worker and industry', txt: 'Worker means any person employed in any industry to do manual, unskilled, skilled, technical, operational, clerical or supervisory work, excluding those in managerial or administrative capacity above the prescribed wage; industry means any systematic activity carried on for production or supply of goods or services.', kw: ['worker', 'industry', 'IR Code 2'] },
    { s: '62', t: 'Prohibition of strikes and lock-outs', txt: 'No person employed in any industrial establishment shall go on strike in breach of contract without giving sixty days notice, nor during conciliation proceedings, and no employer shall declare a lock-out in contravention of these provisions.', kw: ['strike', 'lock-out', 'notice', 'IR Code 62'] },
    { s: '77', t: 'Conditions for retrenchment', txt: 'No workman employed for not less than one year shall be retrenched until he has been given one month notice or wages in lieu, retrenchment compensation of fifteen days average pay for every completed year, and notice to the appropriate Government.', kw: ['retrenchment', 'compensation', 'IR Code 77'] },
  ]),
  ...act('Occupational Safety, Health and Working Conditions Code, 2020', 'OSHCODE2020', 'IN', 'employment_law', '2020-09-29', [
    { s: '6', t: 'Duties of employer', txt: 'Every employer shall ensure that the workplace is free from hazards which cause injury or occupational disease, provide and maintain a safe working environment, and provide free annual health examinations to employees as prescribed.', kw: ['occupational safety', 'employer duty', 'OSH Code 6'] },
  ]),
  ...act('Code on Social Security, 2020', 'SSCODE2020', 'IN', 'employment_law', '2020-09-29', [
    { s: '2', t: 'Definitions — gig and platform workers', txt: 'Gig worker means a person who performs work or participates in a work arrangement and earns from such activities outside of a traditional employer-employee relationship; platform worker means a person engaged in work through an online platform.', kw: ['gig worker', 'platform worker', 'social security', 'SS Code 2'] },
    { s: '45', t: 'Provident fund schemes', txt: 'The Central Government may frame schemes for the establishment of provident funds for employees, with contributions by employer and employee at the prescribed rates.', kw: ['provident fund', 'EPF', 'SS Code 45'] },
  ]),
  ...act('Industrial Disputes Act, 1947', 'IDA1947', 'IN', 'employment_law', '1947-04-01', [
    { s: '2A', t: 'Dismissal of an individual workman to be deemed industrial dispute', txt: 'Where any employer discharges, dismisses, retrenches or otherwise terminates the services of an individual workman, any dispute between that workman and his employer shall be deemed to be an industrial dispute, and the workman may directly approach the Labour Court.', kw: ['industrial dispute', 'dismissal', 'IDA 2A'] },
    { s: '25F', t: 'Conditions precedent to retrenchment of workmen', txt: 'No workman employed for not less than one year shall be retrenched until he has been given one month notice or wages in lieu thereof and retrenchment compensation of fifteen days average pay for every completed year of continuous service.', kw: ['retrenchment', 'compensation', 'IDA 25F'] },
  ]),
  ...act('Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013', 'POSH2013', 'IN', 'employment_law', '2013-12-09', [
    { s: '3', t: 'Prevention of sexual harassment', txt: 'No woman shall be subjected to sexual harassment at any workplace, including unwelcome physical contact, demand for sexual favours, sexually coloured remarks, showing pornography, or any other unwelcome physical, verbal or non-verbal conduct of a sexual nature.', kw: ['sexual harassment', 'workplace', 'POSH 3'] },
    { s: '4', t: 'Constitution of Internal Complaints Committee', txt: 'Every employer of a workplace shall constitute an Internal Complaints Committee headed by a senior woman employee, with members committed to the cause of women and an external member from an NGO familiar with sexual harassment issues.', kw: ['Internal Complaints Committee', 'ICC', 'POSH 4'] },
  ]),
];

// ─── Family, succession & personal law ───────────────────────────────────────
const IN_FAMILY: ExpansionStatute[] = [
  ...act('Special Marriage Act, 1954', 'SMA1954', 'IN', 'family_law', '1954-10-01', [
    { s: '4', t: 'Conditions for solemnization of special marriages', txt: 'A marriage may be solemnized between any two persons if neither has a living spouse, both are capable of giving valid consent and are not within the degrees of prohibited relationship, and the male has completed twenty-one and the female eighteen years of age.', kw: ['special marriage', 'inter-faith', 'conditions', 'SMA 4'] },
    { s: '15', t: 'Registration of marriages celebrated in other forms', txt: 'Any marriage celebrated in any other form may be registered under this Act if the conditions are fulfilled and the parties have been living together as husband and wife.', kw: ['registration', 'marriage', 'SMA 15'] },
  ]),
  ...act('Indian Succession Act, 1925', 'ISA1925', 'IN', 'succession_law', '1925-09-30', [
    { s: '63', t: 'Execution of unprivileged Wills', txt: 'Every testator, not being a soldier or mariner, shall execute his Will by signing or affixing his mark, and the signature shall be attested by two or more witnesses each of whom has seen the testator sign.', kw: ['will', 'execution', 'attestation', 'ISA 63'] },
    { s: '213', t: 'Right as executor or legatee when established', txt: 'No right as executor or legatee can be established in any court unless a court of competent jurisdiction has granted probate of the Will or letters of administration with the Will annexed.', kw: ['probate', 'letters of administration', 'ISA 213'] },
  ]),
  ...act('Guardians and Wards Act, 1890', 'GWA1890', 'IN', 'family_law', '1890-07-21', [
    { s: '7', t: 'Power of the court to make order as to guardianship', txt: 'Where the court is satisfied that it is for the welfare of a minor that an order be made appointing a guardian of his person or property, the court may make an order accordingly; the welfare of the minor is the paramount consideration.', kw: ['guardianship', 'welfare of minor', 'GWA 7'] },
  ]),
  ...act('Muslim Personal Law (Shariat) Application Act, 1937', 'MPLA1937', 'IN', 'family_law', '1937-10-07', [
    { s: '2', t: 'Application of Personal Law to Muslims', txt: 'In matters of intestate succession, marriage, dissolution of marriage including talaq, maintenance, dower, guardianship, gifts, trusts and wakfs, the rule of decision in cases where the parties are Muslims shall be the Muslim Personal Law (Shariat).', kw: ['Muslim personal law', 'Shariat', 'succession', 'MPLA 2'] },
  ]),
  ...act('Dowry Prohibition Act, 1961', 'DPA1961', 'IN', 'family_law', '1961-07-01', [
    { s: '3', t: 'Penalty for giving or taking dowry', txt: 'If any person gives or takes or abets the giving or taking of dowry, he shall be punishable with imprisonment for a term not less than five years and with fine not less than fifteen thousand rupees or the amount of the value of such dowry, whichever is more.', kw: ['dowry', 'penalty', 'DPA 3'] },
  ]),
];

// ─── Property, registration & stamp ──────────────────────────────────────────
const IN_PROPERTY: ExpansionStatute[] = [
  ...act('Registration Act, 1908', 'REGISTRATION1908', 'IN', 'property_law', '1908-01-01', [
    { s: '17', t: 'Documents of which registration is compulsory', txt: 'Documents which require compulsory registration include instruments of gift of immovable property and non-testamentary instruments which purport or operate to create, declare, assign, limit or extinguish any right, title or interest in immovable property of the value of one hundred rupees and upwards.', kw: ['compulsory registration', 'immovable property', 'Registration 17'] },
    { s: '49', t: 'Effect of non-registration of required documents', txt: 'No document required to be registered shall affect any immovable property comprised therein, or be received as evidence of any transaction affecting such property, unless it has been registered.', kw: ['non-registration', 'inadmissibility', 'Registration 49'] },
  ]),
  ...act('Indian Stamp Act, 1899', 'STAMP1899', 'IN', 'property_law', '1899-07-01', [
    { s: '35', t: 'Instruments not duly stamped inadmissible in evidence', txt: 'No instrument chargeable with duty shall be admitted in evidence for any purpose by any person having authority to receive evidence, or shall be acted upon, unless such instrument is duly stamped, subject to payment of duty and penalty.', kw: ['stamp duty', 'inadmissible', 'Stamp 35'] },
  ]),
  ...act('Indian Easements Act, 1882', 'EASEMENTS1882', 'IN', 'property_law', '1882-07-01', [
    { s: '4', t: 'Definition of easement', txt: 'An easement is a right which the owner or occupier of certain land possesses, as such, for the beneficial enjoyment of that land, to do and continue to do something, or to prevent and continue to prevent something being done, in or upon other land not his own.', kw: ['easement', 'dominant heritage', 'Easements 4'] },
    { s: '52', t: 'Licence defined', txt: 'Where one person grants to another a right to do something in or upon immovable property of the grantor, which would in the absence of such right be unlawful, and such right does not amount to an easement or an interest in the property, the right is called a licence.', kw: ['licence', 'permission', 'Easements 52'] },
  ]),
];

// ─── Environment ─────────────────────────────────────────────────────────────
const IN_ENV: ExpansionStatute[] = [
  ...act('Environment (Protection) Act, 1986', 'EPA1986', 'IN', 'environmental_law', '1986-11-19', [
    { s: '3', t: 'Power of Central Government to protect and improve environment', txt: 'The Central Government shall have the power to take all such measures as it deems necessary for the purpose of protecting and improving the quality of the environment and preventing, controlling and abating environmental pollution.', kw: ['environment protection', 'central government', 'EPA 3'] },
    { s: '15', t: 'Penalty for contravention', txt: 'Whoever fails to comply with or contravenes any of the provisions of this Act, or the rules, orders or directions issued thereunder, shall be punishable with imprisonment up to five years or with fine up to one lakh rupees, or with both.', kw: ['penalty', 'pollution', 'EPA 15'] },
  ]),
  ...act('Water (Prevention and Control of Pollution) Act, 1974', 'WATERACT1974', 'IN', 'environmental_law', '1974-03-23', [
    { s: '24', t: 'Prohibition on use of stream or well for disposal of polluting matter', txt: 'No person shall knowingly cause or permit any poisonous, noxious or polluting matter to enter into any stream or well or sewer or on land, in contravention of standards laid down by the State Board.', kw: ['water pollution', 'prohibition', 'Water Act 24'] },
  ]),
  ...act('Air (Prevention and Control of Pollution) Act, 1981', 'AIRACT1981', 'IN', 'environmental_law', '1981-03-29', [
    { s: '21', t: 'Restrictions on use of certain industrial plants', txt: 'No person shall, without the previous consent of the State Board, establish or operate any industrial plant in an air pollution control area; the Board may grant or refuse consent subject to conditions.', kw: ['air pollution', 'consent to operate', 'Air Act 21'] },
  ]),
  ...act('Wild Life (Protection) Act, 1972', 'WPA1972', 'IN', 'environmental_law', '1972-09-09', [
    { s: '9', t: 'Prohibition of hunting', txt: 'No person shall hunt any wild animal specified in Schedules I to IV except as provided under sections 11 and 12; contravention attracts imprisonment and fine.', kw: ['hunting prohibition', 'wildlife', 'WPA 9'] },
  ]),
];

// ─── Technology, data & administrative ───────────────────────────────────────
const IN_TECH_ADMIN: ExpansionStatute[] = [
  ...act('Telecommunications Act, 2023', 'TELECOM2023', 'IN', 'technology_law', '2024-06-26', [
    { s: '3', t: 'Authorisation for telecommunication activities', txt: 'No person shall provide telecommunication services, establish or operate a telecommunication network, or possess radio equipment, except under and in accordance with an authorisation granted by the Central Government.', kw: ['telecom authorisation', 'licence', 'Telecom 3'] },
    { s: '20', t: 'Interception and temporary suspension', txt: 'On the occurrence of any public emergency or in the interest of public safety, the Central or State Government may direct interception of messages or temporary suspension of telecommunication services, subject to procedural safeguards.', kw: ['interception', 'suspension', 'Telecom 20'] },
  ]),
  ...act('Aadhaar (Targeted Delivery of Financial and Other Subsidies, Benefits and Services) Act, 2016', 'AADHAAR2016', 'IN', 'technology_law', '2016-07-12', [
    { s: '7', t: 'Proof of Aadhaar for receipt of subsidies', txt: 'The Central or State Government may require an individual to undergo authentication or furnish proof of possession of an Aadhaar number for receipt of a subsidy, benefit or service for which the expenditure is from the Consolidated Fund of India.', kw: ['Aadhaar', 'subsidy', 'authentication', 'Aadhaar 7'] },
    { s: '8', t: 'Authentication of Aadhaar number', txt: 'The Authority shall perform authentication of the Aadhaar number of an individual on a request submitted by a requesting entity, only with the consent of the individual and after informing the nature of information that may be shared.', kw: ['authentication', 'consent', 'Aadhaar 8'] },
  ]),
  ...act('Administrative Tribunals Act, 1985', 'ATA1985', 'IN', 'administrative_law', '1985-11-01', [
    { s: '14', t: 'Jurisdiction of Central Administrative Tribunal', txt: 'The Central Administrative Tribunal shall exercise jurisdiction in relation to recruitment and all service matters of persons appointed to public services and posts in connection with the affairs of the Union.', kw: ['CAT', 'service matters', 'jurisdiction', 'ATA 14'] },
  ]),
];

// ─── Special criminal & welfare / consumer ───────────────────────────────────
const IN_SPECIAL: ExpansionStatute[] = [
  ...act('Unlawful Activities (Prevention) Act, 1967', 'UAPA1967', 'IN', 'criminal_law', '1967-12-30', [
    { s: '15', t: 'Terrorist act', txt: 'Whoever does any act with intent to threaten or likely to threaten the unity, integrity, security, economic security or sovereignty of India or with intent to strike terror in the people by using bombs, firearms, explosives or hazardous substances commits a terrorist act.', kw: ['UAPA', 'terrorist act', 'UAPA 15'] },
    { s: '43D', t: 'Modified application of bail provisions', txt: 'A person accused of an offence under Chapters IV and VI shall not be released on bail if the Court, on a perusal of the case diary or report, is of opinion that there are reasonable grounds for believing the accusation is prima facie true.', kw: ['UAPA bail', 'prima facie', 'UAPA 43D'] },
  ]),
  ...act('Juvenile Justice (Care and Protection of Children) Act, 2015', 'JJA2015', 'IN', 'criminal_law', '2016-01-15', [
    { s: '15', t: 'Preliminary assessment into heinous offences by Board', txt: 'In case of a heinous offence alleged to have been committed by a child who has completed sixteen years, the Juvenile Justice Board shall conduct a preliminary assessment with regard to his mental and physical capacity, ability to understand consequences and circumstances, and may transfer the case to the Children Court.', kw: ['juvenile justice', 'heinous offence', 'preliminary assessment', 'JJ 15'] },
  ]),
  ...act('Scheduled Castes and the Scheduled Tribes (Prevention of Atrocities) Act, 1989', 'SCST1989', 'IN', 'criminal_law', '1990-01-30', [
    { s: '3', t: 'Punishments for offences of atrocities', txt: 'Whoever, not being a member of a Scheduled Caste or Scheduled Tribe, commits specified offences such as social or economic boycott, intentional insult or intimidation with intent to humiliate in public view, or wrongful occupation of land, against a member of a Scheduled Caste or Tribe, shall be punishable with imprisonment and fine.', kw: ['atrocities', 'SC ST', 'caste', 'SCST 3'] },
  ]),
  ...act('Food Safety and Standards Act, 2006', 'FSSA2006', 'IN', 'consumer_law', '2011-08-05', [
    { s: '26', t: 'Responsibilities of the food business operator', txt: 'Every food business operator shall ensure that the articles of food satisfy the requirements of this Act and the rules; no operator shall manufacture, store, sell or distribute any unsafe, misbranded or sub-standard food.', kw: ['food safety', 'FBO', 'unsafe food', 'FSSA 26'] },
    { s: '59', t: 'Punishment for unsafe food', txt: 'Any person who manufactures for sale or distributes any article of food which is unsafe shall be punishable, where such failure results in death, with imprisonment for life and fine not less than ten lakh rupees.', kw: ['unsafe food', 'penalty', 'FSSA 59'] },
  ]),
];

export const EXPANSION_STATUTES_VOL3_IN: ExpansionStatute[] = [
  ...IN_BNS_EXT,
  ...IN_PROC,
  ...IN_CORP,
  ...IN_TAX_IP,
  ...IN_LABOUR,
  ...IN_FAMILY,
  ...IN_PROPERTY,
  ...IN_ENV,
  ...IN_TECH_ADMIN,
  ...IN_SPECIAL,
];
