/**
 * Jurexio — Statute seed EXPANSION (2026-06-25)
 * NV-STATUTE-EXPANSION-001
 * ───────────────────────────────────────────────────────────────────────────
 * PURE DATA MODULE (no DB / no side-effect imports) so it can be imported by
 * both the runtime seeding service (src/services/jrx-statute-seeding-service.ts)
 * AND a standalone SQL generator (scripts/jrx-export-statutes-sql.ts) without
 * triggering a database connection.
 *
 * Substantially expands the foundational statute coverage for the five
 * non-India jurisdictions (previously 5–6 sections each) with the major,
 * well-established acts each legal system relies on. Section texts are concise
 * accurate paraphrases (suitable for RAG grounding + citation), keyed by the
 * canonical `(jurisdiction, act_short_title, section_number)` unique tuple so
 * they upsert cleanly alongside the existing rows.
 *
 * Jurisdiction codes match nv_statutes: IN, UK, US, EU, SG, GC (GCC).
 */

export interface ExpansionStatute {
  actTitle: string;
  actShortTitle: string;
  jurisdiction: string;
  sectionNumber: string;
  sectionTitle: string;
  sectionText: string;
  practiceArea: string;
  keywords: string[];
  effectiveDate: string;
  amendedDate?: string;
  relatedSections?: string[];
  isRepealed: boolean;
}

export function act(
  actTitle: string,
  actShortTitle: string,
  jurisdiction: string,
  practiceArea: string,
  effectiveDate: string,
  sections: { s: string; t: string; txt: string; kw: string[] }[],
): ExpansionStatute[] {
  return sections.map((sec) => ({
    actTitle,
    actShortTitle,
    jurisdiction,
    sectionNumber: sec.s,
    sectionTitle: sec.t,
    sectionText: sec.txt,
    practiceArea,
    keywords: sec.kw,
    effectiveDate,
    isRepealed: false,
  }));
}

// ─── UNITED KINGDOM ──────────────────────────────────────────────────────────
const UK: ExpansionStatute[] = [
  ...act('Bribery Act 2010', 'UK-BA2010', 'UK', 'criminal_law', '2011-07-01', [
    { s: '1', t: 'Offences of bribing another person', txt: 'A person is guilty of an offence if they offer, promise or give a financial or other advantage to another person intending to induce or reward improper performance of a relevant function or activity.', kw: ['bribery', 'corruption', 'improper performance'] },
    { s: '7', t: 'Failure of commercial organisations to prevent bribery', txt: 'A relevant commercial organisation is guilty of an offence if a person associated with it bribes another person intending to obtain or retain business for the organisation; it is a defence to prove adequate procedures were in place.', kw: ['corporate liability', 'adequate procedures', 'failure to prevent'] },
  ]),
  ...act('Equality Act 2010', 'UK-EA2010', 'UK', 'employment_law', '2010-10-01', [
    { s: '4', t: 'The protected characteristics', txt: 'The protected characteristics are age; disability; gender reassignment; marriage and civil partnership; pregnancy and maternity; race; religion or belief; sex; and sexual orientation.', kw: ['protected characteristics', 'discrimination', 'equality'] },
    { s: '13', t: 'Direct discrimination', txt: 'A person discriminates against another if, because of a protected characteristic, they treat that other less favourably than they treat or would treat others.', kw: ['direct discrimination', 'less favourable treatment'] },
    { s: '26', t: 'Harassment', txt: 'A person harasses another if they engage in unwanted conduct related to a relevant protected characteristic which has the purpose or effect of violating dignity or creating an intimidating, hostile, degrading, humiliating or offensive environment.', kw: ['harassment', 'dignity', 'hostile environment'] },
  ]),
  ...act('Consumer Rights Act 2015', 'UK-CRA2015', 'UK', 'consumer_law', '2015-10-01', [
    { s: '9', t: 'Goods to be of satisfactory quality', txt: 'Every contract to supply goods is treated as including a term that the quality of the goods is satisfactory, judged by what a reasonable person would consider satisfactory taking account of description, price and other relevant circumstances.', kw: ['satisfactory quality', 'consumer goods', 'implied term'] },
    { s: '62', t: 'Requirement for contract terms to be fair', txt: 'An unfair term of a consumer contract is not binding on the consumer; a term is unfair if, contrary to the requirement of good faith, it causes a significant imbalance in the parties rights and obligations to the detriment of the consumer.', kw: ['unfair terms', 'good faith', 'consumer contract'] },
  ]),
  ...act('Data Protection Act 2018', 'UK-DPA2018', 'UK', 'data_protection', '2018-05-25', [
    { s: '2', t: 'Protection of personal data', txt: 'This Act makes provision about the processing of personal data, supplementing the UK GDPR, and confers functions on the Information Commissioner to monitor and enforce data protection.', kw: ['data protection', 'ICO', 'personal data', 'UK GDPR'] },
    { s: '170', t: 'Unlawful obtaining of personal data', txt: 'It is an offence for a person knowingly or recklessly to obtain or disclose personal data without the consent of the controller, or to procure such disclosure to another person.', kw: ['unlawful obtaining', 'data offence', 'consent'] },
  ]),
  ...act('Human Rights Act 1998', 'UK-HRA1998', 'UK', 'constitutional_law', '2000-10-02', [
    { s: '3', t: 'Interpretation of legislation', txt: 'So far as it is possible to do so, primary and subordinate legislation must be read and given effect in a way which is compatible with the Convention rights.', kw: ['convention rights', 'interpretation', 'ECHR'] },
    { s: '6', t: 'Acts of public authorities', txt: 'It is unlawful for a public authority to act in a way which is incompatible with a Convention right, unless required to do so by primary legislation.', kw: ['public authority', 'convention rights', 'unlawful act'] },
  ]),
  ...act('Sale of Goods Act 1979', 'UK-SGA1979', 'UK', 'contract_law', '1980-01-01', [
    { s: '14', t: 'Implied terms about quality or fitness', txt: 'Where the seller sells goods in the course of a business, there is an implied term that the goods supplied are of satisfactory quality and reasonably fit for any purpose made known to the seller.', kw: ['sale of goods', 'satisfactory quality', 'fitness for purpose'] },
  ]),
  ...act('Insolvency Act 1986', 'UK-IA1986', 'UK', 'insolvency_law', '1986-12-29', [
    { s: '122', t: 'Circumstances in which company may be wound up by court', txt: 'A company may be wound up by the court if it is unable to pay its debts, or if the court is of the opinion that it is just and equitable that the company should be wound up.', kw: ['winding up', 'insolvency', 'unable to pay debts'] },
    { s: '213', t: 'Fraudulent trading', txt: 'If in the course of winding up it appears that business has been carried on with intent to defraud creditors, the court may declare that knowing parties are liable to contribute to the assets.', kw: ['fraudulent trading', 'creditors', 'liability'] },
  ]),
];

// ─── UNITED STATES ───────────────────────────────────────────────────────────
const US: ExpansionStatute[] = [
  ...act('Constitution of the United States', 'US-CONST', 'US', 'constitutional_law', '1788-06-21', [
    { s: 'Amend.I', t: 'Freedom of religion, speech, press, assembly', txt: 'Congress shall make no law respecting an establishment of religion, or prohibiting the free exercise thereof; or abridging the freedom of speech, or of the press; or the right of the people peaceably to assemble.', kw: ['first amendment', 'free speech', 'religion'] },
    { s: 'Amend.IV', t: 'Search and seizure', txt: 'The right of the people to be secure against unreasonable searches and seizures shall not be violated, and no Warrants shall issue, but upon probable cause.', kw: ['fourth amendment', 'search and seizure', 'probable cause'] },
    { s: 'Amend.XIV', t: 'Due process and equal protection', txt: 'No State shall deprive any person of life, liberty, or property, without due process of law; nor deny to any person within its jurisdiction the equal protection of the laws.', kw: ['fourteenth amendment', 'due process', 'equal protection'] },
  ]),
  ...act('Civil Rights Act of 1964', 'US-CRA1964', 'US', 'employment_law', '1964-07-02', [
    { s: 'Title VII §703', t: 'Unlawful employment practices', txt: 'It shall be an unlawful employment practice for an employer to fail or refuse to hire or to discharge any individual, or otherwise discriminate, because of such individual race, color, religion, sex, or national origin.', kw: ['Title VII', 'employment discrimination', 'protected class'] },
  ]),
  ...act('Americans with Disabilities Act of 1990', 'US-ADA', 'US', 'employment_law', '1992-07-26', [
    { s: '12112', t: 'Discrimination prohibited', txt: 'No covered entity shall discriminate against a qualified individual on the basis of disability in regard to job application procedures, hiring, advancement, compensation, or other terms of employment.', kw: ['ADA', 'disability discrimination', 'reasonable accommodation'] },
  ]),
  ...act('Securities Act of 1933', 'US-SA1933', 'US', 'securities_law', '1933-05-27', [
    { s: '5', t: 'Prohibitions relating to interstate commerce', txt: 'Unless a registration statement is in effect, it shall be unlawful to use any means of interstate commerce to sell or deliver a security; certain exemptions apply.', kw: ['securities registration', 'interstate commerce', 'offering'] },
  ]),
  ...act('Securities Exchange Act of 1934', 'US-SEA1934', 'US', 'securities_law', '1934-06-06', [
    { s: '10(b)', t: 'Manipulative and deceptive devices', txt: 'It shall be unlawful to use, in connection with the purchase or sale of any security, any manipulative or deceptive device in contravention of SEC rules (including Rule 10b-5 prohibiting fraud).', kw: ['10b-5', 'securities fraud', 'insider trading'] },
  ]),
  ...act('Sherman Antitrust Act', 'US-SHERMAN', 'US', 'competition_law', '1890-07-02', [
    { s: '1', t: 'Trusts in restraint of trade illegal', txt: 'Every contract, combination in the form of trust or otherwise, or conspiracy, in restraint of trade or commerce among the several States, is declared to be illegal.', kw: ['antitrust', 'restraint of trade', 'conspiracy'] },
    { s: '2', t: 'Monopolizing trade a felony', txt: 'Every person who shall monopolize, or attempt to monopolize, or combine or conspire to monopolize any part of trade or commerce, shall be deemed guilty of a felony.', kw: ['monopolization', 'antitrust', 'market power'] },
  ]),
  ...act('Lanham Act (Trademark Act of 1946)', 'US-LANHAM', 'US', 'intellectual_property', '1947-07-05', [
    { s: '32', t: 'Trademark infringement', txt: 'Any person who uses in commerce a reproduction or colorable imitation of a registered mark in a way likely to cause confusion, mistake, or deception shall be liable in a civil action.', kw: ['trademark', 'infringement', 'likelihood of confusion'] },
  ]),
  ...act('Copyright Act of 1976', 'US-COPYRIGHT', 'US', 'intellectual_property', '1978-01-01', [
    { s: '102', t: 'Subject matter of copyright', txt: 'Copyright protection subsists in original works of authorship fixed in any tangible medium of expression; protection does not extend to any idea, procedure, process, or concept.', kw: ['copyright', 'originality', 'fixation'] },
    { s: '107', t: 'Fair use', txt: 'The fair use of a copyrighted work for purposes such as criticism, comment, news reporting, teaching, scholarship, or research is not an infringement, judged by four statutory factors.', kw: ['fair use', 'four factors', 'transformative'] },
  ]),
  ...act('Federal Trade Commission Act', 'US-FTCA', 'US', 'consumer_law', '1914-09-26', [
    { s: '5', t: 'Unfair methods of competition unlawful', txt: 'Unfair methods of competition in or affecting commerce, and unfair or deceptive acts or practices in or affecting commerce, are declared unlawful.', kw: ['FTC', 'unfair practices', 'deceptive'] },
  ]),
];

// ─── EUROPEAN UNION ──────────────────────────────────────────────────────────
const EU: ExpansionStatute[] = [
  ...act('Charter of Fundamental Rights of the European Union', 'EU-CFR', 'EU', 'constitutional_law', '2009-12-01', [
    { s: 'Art.7', t: 'Respect for private and family life', txt: 'Everyone has the right to respect for his or her private and family life, home and communications.', kw: ['privacy', 'family life', 'fundamental rights'] },
    { s: 'Art.8', t: 'Protection of personal data', txt: 'Everyone has the right to the protection of personal data concerning him or her; such data must be processed fairly for specified purposes and on a legitimate basis laid down by law.', kw: ['data protection', 'personal data', 'charter'] },
  ]),
  ...act('Treaty on the Functioning of the European Union', 'EU-TFEU', 'EU', 'competition_law', '2009-12-01', [
    { s: 'Art.101', t: 'Prohibition of anti-competitive agreements', txt: 'All agreements between undertakings which may affect trade between Member States and which have as their object or effect the prevention, restriction or distortion of competition within the internal market are prohibited.', kw: ['competition', 'cartel', 'anti-competitive agreements'] },
    { s: 'Art.102', t: 'Abuse of dominant position', txt: 'Any abuse by one or more undertakings of a dominant position within the internal market shall be prohibited as incompatible with the internal market in so far as it may affect trade between Member States.', kw: ['dominant position', 'abuse', 'competition'] },
  ]),
  ...act('Regulation (EU) No 1215/2012 (Brussels I Recast)', 'EU-BRUSSELS-I', 'EU', 'civil_procedure', '2015-01-10', [
    { s: 'Art.4', t: 'General jurisdiction', txt: 'Persons domiciled in a Member State shall, whatever their nationality, be sued in the courts of that Member State.', kw: ['jurisdiction', 'domicile', 'cross-border litigation'] },
  ]),
  ...act('Regulation (EC) No 593/2008 (Rome I)', 'EU-ROME-I', 'EU', 'contract_law', '2009-12-17', [
    { s: 'Art.3', t: 'Freedom of choice', txt: 'A contract shall be governed by the law chosen by the parties; the choice shall be made expressly or clearly demonstrated by the terms of the contract or the circumstances of the case.', kw: ['choice of law', 'applicable law', 'contract'] },
  ]),
  ...act('Directive (EU) 2022/2555 (NIS2)', 'EU-NIS2', 'EU', 'technology_law', '2024-10-18', [
    { s: 'Art.21', t: 'Cybersecurity risk-management measures', txt: 'Essential and important entities shall take appropriate technical, operational and organisational measures to manage the risks posed to the security of network and information systems.', kw: ['NIS2', 'cybersecurity', 'risk management'] },
    { s: 'Art.23', t: 'Reporting obligations', txt: 'Entities shall notify, without undue delay, any incident having a significant impact on the provision of their services, with an early warning within 24 hours.', kw: ['incident reporting', 'cybersecurity', '24 hours'] },
  ]),
  ...act('Regulation (EU) 2023/1114 (Markets in Crypto-Assets, MiCA)', 'EU-MICA', 'EU', 'financial_law', '2024-12-30', [
    { s: 'Art.4', t: 'Offer to the public of crypto-assets', txt: 'A person shall not offer crypto-assets to the public in the Union unless they have drawn up a crypto-asset white paper and notified it to the competent authority.', kw: ['MiCA', 'crypto-assets', 'white paper'] },
  ]),
  ...act('Directive (EU) 2019/790 (Copyright in the Digital Single Market)', 'EU-COPYRIGHT-DSM', 'EU', 'intellectual_property', '2021-06-07', [
    { s: 'Art.17', t: 'Use of protected content by online platforms', txt: 'Online content-sharing service providers perform an act of communication to the public when they give access to copyright-protected works uploaded by their users and must obtain authorisation from rightholders.', kw: ['copyright', 'platform liability', 'Article 17'] },
  ]),
];

// ─── SINGAPORE ───────────────────────────────────────────────────────────────
const SG: ExpansionStatute[] = [
  ...act('Constitution of the Republic of Singapore', 'SG-CONST', 'SG', 'constitutional_law', '1965-08-09', [
    { s: 'Art.9', t: 'Liberty of the person', txt: 'No person shall be deprived of his life or personal liberty save in accordance with law; a person arrested shall be informed of the grounds and allowed to consult counsel.', kw: ['liberty', 'arrest', 'due process'] },
    { s: 'Art.12', t: 'Equal protection', txt: 'All persons are equal before the law and entitled to the equal protection of the law; there shall be no discrimination on the ground only of religion, race, descent or place of birth.', kw: ['equality', 'equal protection', 'non-discrimination'] },
  ]),
  ...act('Penal Code 1871 (Singapore)', 'SG-PC', 'SG', 'criminal_law', '1872-09-16', [
    { s: '300', t: 'Murder', txt: 'Culpable homicide is murder if the act by which the death is caused is done with the intention of causing death, or with knowledge that it is so imminently dangerous that it must in all probability cause death.', kw: ['murder', 'culpable homicide', 'intention'] },
    { s: '415', t: 'Cheating', txt: 'Whoever, by deceiving any person, fraudulently or dishonestly induces the person to deliver any property or to consent to its retention, is said to cheat.', kw: ['cheating', 'deception', 'fraud'] },
  ]),
  ...act('Misrepresentation Act 1967 (Singapore)', 'SG-MA', 'SG', 'contract_law', '1968-03-01', [
    { s: '2', t: 'Damages for misrepresentation', txt: 'Where a person has entered into a contract after a misrepresentation made to him by another party and has suffered loss, the other party is liable in damages unless he proves reasonable grounds to believe the facts represented were true.', kw: ['misrepresentation', 'damages', 'contract'] },
  ]),
  ...act('Competition Act 2004 (Singapore)', 'SG-COMP', 'SG', 'competition_law', '2006-01-01', [
    { s: '34', t: 'Agreements preventing competition', txt: 'Agreements between undertakings which have as their object or effect the prevention, restriction or distortion of competition within Singapore are prohibited.', kw: ['competition', 'anti-competitive', 'Section 34'] },
    { s: '47', t: 'Abuse of dominant position', txt: 'Any conduct on the part of one or more undertakings which amounts to the abuse of a dominant position in any market in Singapore is prohibited.', kw: ['dominant position', 'abuse', 'competition'] },
  ]),
  ...act('Cybersecurity Act 2018 (Singapore)', 'SG-CSA', 'SG', 'technology_law', '2018-08-31', [
    { s: '14', t: 'Duty to report cybersecurity incidents', txt: 'The owner of a critical information infrastructure must notify the Commissioner of prescribed cybersecurity incidents in respect of the critical information infrastructure within the prescribed period.', kw: ['cybersecurity', 'critical infrastructure', 'incident reporting'] },
  ]),
  ...act('Income Tax Act 1947 (Singapore)', 'SG-ITA', 'SG', 'tax_law', '1948-01-01', [
    { s: '10', t: 'Charge of income tax', txt: 'Income tax shall be payable upon the income of any person accruing in or derived from Singapore or received in Singapore from outside Singapore, including gains or profits from any trade, business, profession or employment.', kw: ['income tax', 'territorial', 'chargeable income'] },
  ]),
];

// ─── GULF COOPERATION COUNCIL (GC) ───────────────────────────────────────────
const GC: ExpansionStatute[] = [
  ...act('UAE Federal Decree-Law No. 47 of 2022 (Corporate Tax)', 'UAE-CT', 'GC', 'tax_law', '2023-06-01', [
    { s: 'Art.3', t: 'Corporate tax rate', txt: 'Corporate tax is imposed on taxable income at 0% on income up to the threshold and 9% on taxable income exceeding the threshold specified by Cabinet decision.', kw: ['UAE corporate tax', '9 percent', 'taxable income'] },
  ]),
  ...act('UAE Federal Decree-Law No. 45 of 2021 (Personal Data Protection)', 'UAE-PDPL', 'GC', 'data_protection', '2022-01-02', [
    { s: 'Art.5', t: 'Conditions for processing personal data', txt: 'Personal data shall be processed in a fair, transparent and lawful manner, collected for a specific and clear purpose, and not processed in a manner inconsistent with that purpose.', kw: ['UAE PDPL', 'personal data', 'lawful processing'] },
  ]),
  ...act('UAE Federal Law No. 33 of 2021 (Labour Relations)', 'UAE-LABOUR', 'GC', 'employment_law', '2022-02-02', [
    { s: 'Art.8', t: 'Employment contract', txt: 'The employment relationship shall be based on a fixed-term written contract specifying the rights and obligations of both parties; the contract may be renewed by agreement.', kw: ['UAE labour', 'employment contract', 'fixed term'] },
  ]),
  ...act('Saudi Companies Law 2022', 'KSA-COMPANIES', 'GC', 'corporate_law', '2023-01-19', [
    { s: 'Art.2', t: 'Forms of companies', txt: 'A company shall take one of the forms recognised under this Law, including a joint stock company, a simple joint stock company, a limited liability company, or a general partnership.', kw: ['Saudi companies', 'company forms', 'LLC'] },
  ]),
  ...act('Saudi Personal Data Protection Law 2021', 'KSA-PDPL', 'GC', 'data_protection', '2023-09-14', [
    { s: 'Art.5', t: 'Consent for processing', txt: 'A controller may not process personal data without the consent of the data subject, except in cases specified by the Law, such as where processing serves a clear interest of the data subject.', kw: ['Saudi PDPL', 'consent', 'data subject'] },
  ]),
  ...act('Qatar Law No. 13 of 2016 (Personal Data Privacy)', 'QA-PDPL', 'GC', 'data_protection', '2016-12-29', [
    { s: 'Art.4', t: 'Right to privacy', txt: 'Every individual has the right to privacy of personal data; processing shall be carried out in a manner that ensures transparency, integrity and respect for human dignity.', kw: ['Qatar', 'data privacy', 'transparency'] },
  ]),
  ...act('Bahrain Personal Data Protection Law No. 30 of 2018', 'BH-PDPL', 'GC', 'data_protection', '2019-08-01', [
    { s: 'Art.3', t: 'Lawful processing', txt: 'Personal data may not be processed without the consent of the data subject unless processing is necessary for the performance of a contract or compliance with a legal obligation.', kw: ['Bahrain', 'data protection', 'consent'] },
  ]),
];

import { EXPANSION_STATUTES_VOL2 } from './jrx-statutes-expansion-2026-06-vol2.js';
import { EXPANSION_STATUTES_VOL3_IN } from './jrx-statutes-expansion-2026-06-vol3-in.js';
import { EXPANSION_STATUTES_VOL4_US } from './jrx-statutes-expansion-2026-06-vol4-us.js';
import { EXPANSION_STATUTES_VOL5_IN } from './jrx-statutes-expansion-2026-06-vol5-in.js';
import { EXPANSION_STATUTES_VOL6_US } from './jrx-statutes-expansion-2026-06-vol6-us.js';
import { IN_BNSS_COURT_APPS } from './jrx-statutes-expansion-2026-08-bnss-court-apps.js';

const VOL1: ExpansionStatute[] = [
  ...UK,
  ...US,
  ...EU,
  ...SG,
  ...GC,
];

export const EXPANSION_STATUTES: ExpansionStatute[] = [
  ...VOL1,
  ...EXPANSION_STATUTES_VOL2,
  // Vol.3 — India deep coverage (all practice areas, latest BNS/BNSS/BSA + ~35 Acts)
  ...EXPANSION_STATUTES_VOL3_IN,
  // Vol.4 — USA federal + corporate deep coverage (~20 Acts)
  ...EXPANSION_STATUTES_VOL4_US,
  // Vol.5 — India enlarged (constitutional depth + amendments + ~40 Acts)
  ...EXPANSION_STATUTES_VOL5_IN,
  // Vol.6 — USA enlarged (constitutional amendments + environmental/labor/privacy/tax/IP + ~30 Acts)
  ...EXPANSION_STATUTES_VOL6_US,
  // BNSS 25 essential court applications (bail / discharge / remand / property / transfer)
  ...IN_BNSS_COURT_APPS,
];

function countBy(rows: ExpansionStatute[], j: string): number {
  return rows.filter((r) => r.jurisdiction === j).length;
}

export const EXPANSION_COUNT_BY_JURISDICTION = {
  IN: countBy(EXPANSION_STATUTES, 'IN'),
  UK: countBy(EXPANSION_STATUTES, 'UK'),
  US: countBy(EXPANSION_STATUTES, 'US'),
  EU: countBy(EXPANSION_STATUTES, 'EU'),
  SG: countBy(EXPANSION_STATUTES, 'SG'),
  GC: countBy(EXPANSION_STATUTES, 'GC'),
} as const;
