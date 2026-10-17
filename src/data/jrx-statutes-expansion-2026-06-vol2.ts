/**
 * Jurexio — Statute seed EXPANSION Vol.2 (2026-06-26)
 * NV-STATUTE-EXPANSION-002
 * ───────────────────────────────────────────────────────────────────────────
 * PURE DATA MODULE (no DB / no side-effect imports). Second wave of foundational
 * statute coverage for the five non-India jurisdictions, broadening across the
 * major practice areas (criminal, contract, tort, company, employment, data
 * protection, IP, tax, competition, consumer, civil procedure, evidence,
 * property, family, dispute resolution, financial regulation, AML).
 *
 * Section texts are concise accurate paraphrases suitable for RAG grounding and
 * citation, keyed by the canonical (jurisdiction, act_short_title,
 * section_number) unique tuple so they upsert cleanly alongside Vol.1 + the
 * existing IN corpus.
 */

import { act, type ExpansionStatute } from './jrx-statutes-expansion-2026-06.js';

// ─── UNITED KINGDOM (Vol.2) ──────────────────────────────────────────────────
const UK2: ExpansionStatute[] = [
  ...act('Theft Act 1968', 'UK-THEFT1968', 'UK', 'criminal_law', '1969-01-01', [
    { s: '1', t: 'Basic definition of theft', txt: 'A person is guilty of theft if he dishonestly appropriates property belonging to another with the intention of permanently depriving the other of it; "thief" and "steal" are construed accordingly.', kw: ['theft', 'dishonest appropriation', 'permanent deprivation'] },
    { s: '8', t: 'Robbery', txt: 'A person is guilty of robbery if he steals, and immediately before or at the time of doing so, and in order to do so, he uses force on any person or seeks to put any person in fear of being then and there subjected to force.', kw: ['robbery', 'force', 'theft'] },
    { s: '9', t: 'Burglary', txt: 'A person is guilty of burglary if he enters a building or part of a building as a trespasser with intent to steal, inflict grievous bodily harm, or do unlawful damage.', kw: ['burglary', 'trespasser', 'intent'] },
  ]),
  ...act('Fraud Act 2006', 'UK-FRAUD2006', 'UK', 'criminal_law', '2007-01-15', [
    { s: '1', t: 'Fraud', txt: 'A person is guilty of fraud if he breaches any of the sections listed (false representation, failing to disclose information, or abuse of position).', kw: ['fraud', 'offence', 'dishonesty'] },
    { s: '2', t: 'Fraud by false representation', txt: 'A person is in breach if he dishonestly makes a false representation intending to make a gain for himself or another, or to cause loss to another or expose another to a risk of loss.', kw: ['false representation', 'dishonesty', 'gain'] },
  ]),
  ...act('Unfair Contract Terms Act 1977', 'UK-UCTA1977', 'UK', 'contract_law', '1978-02-01', [
    { s: '2', t: 'Negligence liability', txt: 'A person cannot by reference to any contract term or notice exclude or restrict his liability for death or personal injury resulting from negligence; for other loss, liability can be excluded only so far as the term satisfies the requirement of reasonableness.', kw: ['exclusion clause', 'negligence', 'reasonableness'] },
    { s: '11', t: 'The reasonableness test', txt: 'A contract term is reasonable if it is a fair and reasonable one to have included having regard to the circumstances which were, or ought reasonably to have been, known to or in the contemplation of the parties when the contract was made.', kw: ['reasonableness test', 'fair and reasonable', 'contract term'] },
  ]),
  ...act('Companies Act 2006', 'UK-CA2006', 'UK', 'corporate_law', '2009-10-01', [
    { s: '171', t: 'Duty to act within powers', txt: 'A director must act in accordance with the company constitution and only exercise powers for the purposes for which they are conferred.', kw: ['directors duties', 'proper purpose', 'constitution'] },
    { s: '172', t: 'Duty to promote the success of the company', txt: 'A director must act in the way he considers, in good faith, would be most likely to promote the success of the company for the benefit of its members as a whole, having regard to long-term consequences, employees, suppliers, the community and the environment.', kw: ['promote success', 'good faith', 'stakeholders'] },
    { s: '174', t: 'Duty to exercise reasonable care, skill and diligence', txt: 'A director must exercise the care, skill and diligence that would be exercised by a reasonably diligent person with the general knowledge, skill and experience reasonably expected of a person carrying out that function, and the actual knowledge of the director.', kw: ['reasonable care', 'skill and diligence', 'directors duties'] },
  ]),
  ...act('Employment Rights Act 1996', 'UK-ERA1996', 'UK', 'employment_law', '1996-08-22', [
    { s: '94', t: 'The right not to be unfairly dismissed', txt: 'An employee has the right not to be unfairly dismissed by his employer, subject to the qualifying conditions in the Act.', kw: ['unfair dismissal', 'employee rights', 'qualifying period'] },
    { s: '98', t: 'Fairness of dismissal', txt: 'In determining whether a dismissal is fair, it is for the employer to show the reason and that it falls within a potentially fair category (capability, conduct, redundancy, statutory restriction, or some other substantial reason); fairness then depends on whether the employer acted reasonably.', kw: ['fair reason', 'band of reasonable responses', 'dismissal'] },
  ]),
  ...act('Limitation Act 1980', 'UK-LA1980', 'UK', 'civil_procedure', '1981-05-01', [
    { s: '2', t: 'Time limit for actions founded on tort', txt: 'An action founded on tort shall not be brought after the expiration of six years from the date on which the cause of action accrued.', kw: ['limitation period', 'tort', 'six years'] },
    { s: '5', t: 'Time limit for actions founded on simple contract', txt: 'An action founded on simple contract shall not be brought after the expiration of six years from the date on which the cause of action accrued.', kw: ['limitation period', 'contract', 'six years'] },
  ]),
  ...act('Patents Act 1977', 'UK-PA1977', 'UK', 'intellectual_property', '1978-06-01', [
    { s: '1', t: 'Patentable inventions', txt: 'A patent may be granted only for an invention which is new, involves an inventive step, is capable of industrial application, and is not excluded (such as a discovery, scientific theory, or business method as such).', kw: ['patentability', 'novelty', 'inventive step'] },
    { s: '60', t: 'Meaning of infringement', txt: 'A person infringes a patent if, without consent of the proprietor, he makes, disposes of, uses, imports or keeps a patented product, or uses a patented process, while the patent is in force.', kw: ['patent infringement', 'unauthorised use', 'proprietor'] },
  ]),
  ...act('Copyright, Designs and Patents Act 1988', 'UK-CDPA1988', 'UK', 'intellectual_property', '1989-08-01', [
    { s: '1', t: 'Copyright and copyright works', txt: 'Copyright is a property right which subsists in original literary, dramatic, musical or artistic works, sound recordings, films, broadcasts, and the typographical arrangement of published editions.', kw: ['copyright', 'original works', 'subsistence'] },
    { s: '16', t: 'The acts restricted by copyright', txt: 'The owner of copyright has the exclusive right to copy the work, issue copies to the public, rent or lend, perform, communicate to the public, and make an adaptation; doing any such act without licence infringes copyright.', kw: ['restricted acts', 'exclusive rights', 'infringement'] },
  ]),
  ...act('Trade Marks Act 1994', 'UK-TMA1994', 'UK', 'intellectual_property', '1994-10-31', [
    { s: '10', t: 'Infringement of registered trade mark', txt: 'A person infringes a registered trade mark if he uses in the course of trade a sign identical or similar to the trade mark in relation to identical or similar goods or services where there exists a likelihood of confusion on the part of the public.', kw: ['trade mark infringement', 'likelihood of confusion', 'sign'] },
  ]),
  ...act('Arbitration Act 1996', 'UK-AA1996', 'UK', 'dispute_resolution', '1997-01-31', [
    { s: '1', t: 'General principles', txt: 'The object of arbitration is to obtain the fair resolution of disputes by an impartial tribunal without unnecessary delay or expense; parties are free to agree how disputes are resolved, subject only to safeguards necessary in the public interest.', kw: ['arbitration', 'party autonomy', 'impartial tribunal'] },
    { s: '9', t: 'Stay of legal proceedings', txt: 'A party to an arbitration agreement against whom legal proceedings are brought in respect of a matter to be referred to arbitration may apply to the court to stay the proceedings.', kw: ['stay of proceedings', 'arbitration agreement', 'reference'] },
  ]),
  ...act('Proceeds of Crime Act 2002', 'UK-POCA2002', 'UK', 'criminal_law', '2003-02-24', [
    { s: '327', t: 'Concealing etc criminal property', txt: 'A person commits a money-laundering offence if he conceals, disguises, converts, transfers, or removes from the jurisdiction property which constitutes or represents a benefit from criminal conduct.', kw: ['money laundering', 'criminal property', 'concealment'] },
    { s: '330', t: 'Failure to disclose: regulated sector', txt: 'A person in the regulated sector commits an offence if he knows or suspects, or has reasonable grounds to know or suspect, that another is engaged in money laundering and does not make the required disclosure as soon as practicable.', kw: ['failure to disclose', 'regulated sector', 'suspicion'] },
  ]),
  ...act('Children Act 1989', 'UK-CHILDREN1989', 'UK', 'family_law', '1991-10-14', [
    { s: '1', t: 'Welfare of the child', txt: 'When a court determines any question with respect to the upbringing of a child, the child welfare shall be the court paramount consideration; delay is generally prejudicial and the court applies the statutory welfare checklist.', kw: ['welfare principle', 'paramount consideration', 'child'] },
  ]),
  ...act('Police and Criminal Evidence Act 1984', 'UK-PACE1984', 'UK', 'criminal_law', '1986-01-01', [
    { s: '24', t: 'Arrest without warrant: constables', txt: 'A constable may arrest without a warrant anyone who is about to commit, is committing, or whom he has reasonable grounds to suspect of committing an offence, where arrest is necessary for specified reasons.', kw: ['arrest', 'reasonable grounds', 'necessity'] },
    { s: '78', t: 'Exclusion of unfair evidence', txt: 'The court may refuse to allow evidence on which the prosecution proposes to rely if it appears that, having regard to all the circumstances, admitting it would have such an adverse effect on the fairness of the proceedings that it ought not to be admitted.', kw: ['exclusion of evidence', 'fairness', 'discretion'] },
  ]),
  ...act('Land Registration Act 2002', 'UK-LRA2002', 'UK', 'property_law', '2003-10-13', [
    { s: '27', t: 'Dispositions required to be registered', txt: 'Certain dispositions of registered land, including transfers and the grant of a legal charge, do not operate at law until the relevant registration requirements are met.', kw: ['registered land', 'disposition', 'registration'] },
  ]),
];
// ─── UNITED STATES (Vol.2) ───────────────────────────────────────────────────
const US2: ExpansionStatute[] = [
  ...act('Uniform Commercial Code — Article 2 (Sales)', 'US-UCC2', 'US', 'contract_law', '1952-01-01', [
    { s: '2-201', t: 'Statute of frauds', txt: 'A contract for the sale of goods for the price of $500 or more is not enforceable unless there is a writing sufficient to indicate that a contract has been made, signed by the party against whom enforcement is sought.', kw: ['statute of frauds', 'sale of goods', 'writing'] },
    { s: '2-314', t: 'Implied warranty of merchantability', txt: 'Unless excluded or modified, a warranty that the goods shall be merchantable is implied in a contract for their sale if the seller is a merchant with respect to goods of that kind.', kw: ['merchantability', 'implied warranty', 'merchant'] },
    { s: '2-315', t: 'Implied warranty of fitness for particular purpose', txt: 'Where the seller has reason to know any particular purpose for which the goods are required and that the buyer is relying on the seller skill or judgment, there is an implied warranty that the goods shall be fit for that purpose.', kw: ['fitness for purpose', 'implied warranty', 'reliance'] },
  ]),
  ...act('Sarbanes-Oxley Act of 2002', 'US-SOX', 'US', 'securities_law', '2002-07-30', [
    { s: '302', t: 'Corporate responsibility for financial reports', txt: 'The principal executive and financial officers must certify in each periodic report that it does not contain untrue statements or omit material facts and that the financial statements fairly present the financial condition of the issuer.', kw: ['SOX', 'certification', 'financial reporting'] },
    { s: '404', t: 'Management assessment of internal controls', txt: 'Each annual report shall contain an internal control report stating management responsibility for, and assessing the effectiveness of, the internal control structure and procedures for financial reporting.', kw: ['internal controls', 'ICFR', 'management assessment'] },
  ]),
  ...act('Foreign Corrupt Practices Act', 'US-FCPA', 'US', 'criminal_law', '1977-12-19', [
    { s: '78dd-1', t: 'Prohibited foreign trade practices by issuers', txt: 'It is unlawful for an issuer or its agents to make use of interstate commerce corruptly to offer or pay anything of value to a foreign official to influence an official act in order to obtain or retain business.', kw: ['FCPA', 'foreign bribery', 'anti-corruption'] },
  ]),
  ...act('Patent Act (Title 35 U.S.C.)', 'US-PATENT35', 'US', 'intellectual_property', '1952-07-19', [
    { s: '101', t: 'Inventions patentable', txt: 'Whoever invents or discovers any new and useful process, machine, manufacture, or composition of matter, or any new and useful improvement thereof, may obtain a patent, subject to the conditions and requirements of this title.', kw: ['patentable subject matter', 'process', 'utility'] },
    { s: '271', t: 'Infringement of patent', txt: 'Whoever without authority makes, uses, offers to sell, or sells any patented invention within the United States, or imports a patented invention, during the term of the patent, infringes the patent.', kw: ['patent infringement', 'unauthorized use'] },
  ]),
  ...act('Fair Labor Standards Act of 1938', 'US-FLSA', 'US', 'employment_law', '1938-10-24', [
    { s: '206', t: 'Minimum wage', txt: 'Every employer shall pay to each covered employee wages at not less than the federal minimum wage rate prescribed by the Act.', kw: ['minimum wage', 'FLSA', 'covered employee'] },
    { s: '207', t: 'Maximum hours and overtime', txt: 'No covered employer shall employ an employee for a workweek longer than forty hours unless the employee receives compensation for the excess hours at not less than one and one-half times the regular rate.', kw: ['overtime', 'forty hours', 'time and a half'] },
  ]),
  ...act('Age Discrimination in Employment Act of 1967', 'US-ADEA', 'US', 'employment_law', '1967-12-15', [
    { s: '623', t: 'Prohibition of age discrimination', txt: 'It is unlawful for an employer to fail or refuse to hire, to discharge, or otherwise discriminate against any individual with respect to compensation, terms, or privileges of employment because of the individual age (40 or older).', kw: ['age discrimination', 'ADEA', 'protected age'] },
  ]),
  ...act('Bankruptcy Code (Title 11 U.S.C.)', 'US-BANKRUPTCY11', 'US', 'insolvency_law', '1979-10-01', [
    { s: '362', t: 'Automatic stay', txt: 'The filing of a bankruptcy petition operates as a stay, applicable to all entities, of the commencement or continuation of actions against the debtor and of acts to obtain possession of or to enforce liens against property of the estate.', kw: ['automatic stay', 'bankruptcy', 'creditors'] },
    { s: '523', t: 'Exceptions to discharge', txt: 'A discharge does not discharge an individual debtor from specified debts, including certain taxes, debts obtained by fraud, domestic support obligations, and debts for willful and malicious injury.', kw: ['discharge', 'nondischargeable debts', 'fraud'] },
  ]),
  ...act('Federal Rules of Civil Procedure', 'US-FRCP', 'US', 'civil_procedure', '1938-09-16', [
    { s: 'Rule 8', t: 'General rules of pleading', txt: 'A pleading that states a claim for relief must contain a short and plain statement of the grounds for jurisdiction, a short and plain statement showing the pleader is entitled to relief, and a demand for the relief sought.', kw: ['pleading', 'notice pleading', 'claim for relief'] },
    { s: 'Rule 12(b)(6)', t: 'Failure to state a claim', txt: 'A party may assert by motion the defense of failure to state a claim upon which relief can be granted; the court accepts well-pleaded facts as true and determines whether they state a plausible claim.', kw: ['motion to dismiss', 'plausibility', 'failure to state a claim'] },
    { s: 'Rule 56', t: 'Summary judgment', txt: 'The court shall grant summary judgment if the movant shows there is no genuine dispute as to any material fact and the movant is entitled to judgment as a matter of law.', kw: ['summary judgment', 'no genuine dispute', 'material fact'] },
  ]),
  ...act('Defend Trade Secrets Act of 2016 (18 U.S.C.)', 'US-DTSA', 'US', 'intellectual_property', '2016-05-11', [
    { s: '1836', t: 'Civil proceedings for misappropriation', txt: 'An owner of a trade secret that is misappropriated may bring a civil action if the trade secret is related to a product or service used in, or intended for use in, interstate or foreign commerce.', kw: ['trade secret', 'misappropriation', 'civil action'] },
  ]),
  ...act('Computer Fraud and Abuse Act (18 U.S.C.)', 'US-CFAA', 'US', 'technology_law', '1986-10-16', [
    { s: '1030', t: 'Fraud and related activity in connection with computers', txt: 'Whoever intentionally accesses a computer without authorization or exceeds authorized access, and thereby obtains protected information or causes damage, commits an offense under this section.', kw: ['unauthorized access', 'computer fraud', 'CFAA'] },
  ]),
  ...act('Health Insurance Portability and Accountability Act of 1996', 'US-HIPAA', 'US', 'data_protection', '2003-04-14', [
    { s: 'Privacy Rule', t: 'Standards for privacy of protected health information', txt: 'A covered entity may not use or disclose protected health information except as permitted or required by the Privacy Rule, and must implement safeguards to protect the privacy of such information.', kw: ['HIPAA', 'protected health information', 'privacy rule'] },
  ]),
  ...act('California Consumer Privacy Act of 2018', 'US-CCPA', 'US', 'data_protection', '2020-01-01', [
    { s: '1798.100', t: 'Consumer right to know', txt: 'A consumer has the right to request that a business disclose the categories and specific pieces of personal information it has collected about the consumer, the sources, and the purposes for collection.', kw: ['CCPA', 'right to know', 'personal information'] },
    { s: '1798.105', t: 'Consumer right to delete', txt: 'A consumer has the right to request that a business delete personal information that the business has collected from the consumer, subject to enumerated exceptions.', kw: ['right to delete', 'erasure', 'CCPA'] },
  ]),
];
// ─── EUROPEAN UNION (Vol.2) ──────────────────────────────────────────────────
const EU2: ExpansionStatute[] = [
  ...act('Regulation (EU) 2016/679 (General Data Protection Regulation)', 'EU-GDPR', 'EU', 'data_protection', '2018-05-25', [
    { s: 'Art.5', t: 'Principles relating to processing of personal data', txt: 'Personal data shall be processed lawfully, fairly and transparently; collected for specified, explicit and legitimate purposes; adequate, relevant and limited to what is necessary; accurate; kept no longer than necessary; and processed securely. The controller is accountable for compliance.', kw: ['GDPR principles', 'lawfulness', 'data minimisation', 'accountability'] },
    { s: 'Art.6', t: 'Lawfulness of processing', txt: 'Processing is lawful only if at least one basis applies: consent, performance of a contract, a legal obligation, vital interests, a task in the public interest, or legitimate interests not overridden by the data subject rights.', kw: ['legal basis', 'consent', 'legitimate interests'] },
    { s: 'Art.17', t: 'Right to erasure (right to be forgotten)', txt: 'The data subject has the right to obtain erasure of personal data without undue delay where the data are no longer necessary, consent is withdrawn, the subject objects, or processing was unlawful.', kw: ['right to erasure', 'right to be forgotten', 'data subject rights'] },
    { s: 'Art.33', t: 'Notification of a personal data breach', txt: 'In the case of a personal data breach, the controller shall notify the competent supervisory authority without undue delay and, where feasible, not later than 72 hours after becoming aware of it.', kw: ['breach notification', '72 hours', 'supervisory authority'] },
    { s: 'Art.83', t: 'General conditions for imposing administrative fines', txt: 'Infringements may attract administrative fines up to 20 million euro or up to 4% of the total worldwide annual turnover of the preceding financial year, whichever is higher.', kw: ['administrative fines', '4 percent turnover', 'enforcement'] },
  ]),
  ...act('Regulation (EU) 2024/1689 (Artificial Intelligence Act)', 'EU-AIACT', 'EU', 'technology_law', '2026-08-02', [
    { s: 'Art.5', t: 'Prohibited AI practices', txt: 'Certain AI practices are prohibited, including subliminal manipulation causing harm, exploitation of vulnerabilities, social scoring by public authorities, and (subject to exceptions) real-time remote biometric identification in publicly accessible spaces for law enforcement.', kw: ['prohibited AI', 'social scoring', 'biometric identification'] },
    { s: 'Art.6', t: 'Classification rules for high-risk AI systems', txt: 'An AI system is high-risk where it is intended to be used as a safety component or is itself a product covered by listed Union harmonisation legislation, or falls within the high-risk use cases listed in Annex III.', kw: ['high-risk AI', 'classification', 'conformity assessment'] },
  ]),
  ...act('Regulation (EU) 2022/2065 (Digital Services Act)', 'EU-DSA', 'EU', 'technology_law', '2024-02-17', [
    { s: 'Art.16', t: 'Notice and action mechanisms', txt: 'Providers of hosting services shall put in place mechanisms to allow any person to notify them of the presence of items they consider to be illegal content, and shall act on such notices in a timely, diligent and non-arbitrary manner.', kw: ['notice and action', 'illegal content', 'hosting services'] },
  ]),
  ...act('Regulation (EU) 2022/1925 (Digital Markets Act)', 'EU-DMA', 'EU', 'competition_law', '2023-05-02', [
    { s: 'Art.5', t: 'Obligations for gatekeepers', txt: 'A gatekeeper shall not combine personal data from its core platform service with data from other services without consent, nor prevent business users from offering the same products on third-party platforms at different prices or conditions.', kw: ['gatekeeper', 'self-preferencing', 'data combination'] },
  ]),
  ...act('Regulation (EC) No 864/2007 (Rome II)', 'EU-ROME-II', 'EU', 'civil_procedure', '2009-01-11', [
    { s: 'Art.4', t: 'General rule for non-contractual obligations', txt: 'The law applicable to a non-contractual obligation arising out of a tort is the law of the country in which the damage occurs, irrespective of the country in which the event giving rise to the damage occurred.', kw: ['applicable law', 'tort', 'lex loci damni'] },
  ]),
  ...act('Directive 2011/83/EU (Consumer Rights Directive)', 'EU-CRD', 'EU', 'consumer_law', '2014-06-13', [
    { s: 'Art.9', t: 'Right of withdrawal', txt: 'For distance and off-premises contracts, the consumer shall have a period of 14 days to withdraw from the contract without giving any reason and without incurring liability other than the prescribed costs.', kw: ['right of withdrawal', '14 days', 'distance contract'] },
  ]),
  ...act('Directive 85/374/EEC (Product Liability Directive)', 'EU-PLD', 'EU', 'consumer_law', '1988-07-30', [
    { s: 'Art.1', t: 'Liability of the producer', txt: 'The producer shall be liable for damage caused by a defect in his product, irrespective of fault (strict liability).', kw: ['product liability', 'strict liability', 'defect'] },
  ]),
  ...act('Directive 2003/88/EC (Working Time Directive)', 'EU-WTD', 'EU', 'employment_law', '2004-08-02', [
    { s: 'Art.6', t: 'Maximum weekly working time', txt: 'Member States shall ensure that the average working time for each seven-day period, including overtime, does not exceed 48 hours.', kw: ['working time', '48 hours', 'overtime'] },
  ]),
  ...act('Treaty on the Functioning of the European Union (Vol.2)', 'EU-TFEU', 'EU', 'constitutional_law', '2009-12-01', [
    { s: 'Art.34', t: 'Free movement of goods', txt: 'Quantitative restrictions on imports and all measures having equivalent effect shall be prohibited between Member States.', kw: ['free movement of goods', 'quantitative restrictions', 'internal market'] },
    { s: 'Art.45', t: 'Free movement of workers', txt: 'Freedom of movement for workers shall be secured within the Union, entailing the abolition of any discrimination based on nationality between workers as regards employment, remuneration and other conditions of work.', kw: ['free movement of workers', 'non-discrimination', 'nationality'] },
  ]),
];
// ─── SINGAPORE (Vol.2) ───────────────────────────────────────────────────────
const SG2: ExpansionStatute[] = [
  ...act('Personal Data Protection Act 2012 (Singapore)', 'SG-PDPA', 'SG', 'data_protection', '2014-07-02', [
    { s: '13', t: 'Consent required', txt: 'An organisation shall not collect, use or disclose personal data about an individual unless the individual gives, or is deemed to have given, consent, or where collection, use or disclosure is required or authorised by law.', kw: ['consent', 'personal data', 'PDPA'] },
    { s: '24', t: 'Protection of personal data', txt: 'An organisation shall protect personal data in its possession or under its control by making reasonable security arrangements to prevent unauthorised access, collection, use, disclosure, copying, modification or disposal.', kw: ['protection obligation', 'security arrangements', 'unauthorised access'] },
    { s: '26D', t: 'Notification of data breach', txt: 'An organisation shall notify the Commission and affected individuals of a notifiable data breach that results in or is likely to result in significant harm, as soon as practicable.', kw: ['data breach notification', 'significant harm', 'PDPC'] },
  ]),
  ...act('Employment Act 1968 (Singapore)', 'SG-EA', 'SG', 'employment_law', '1969-08-15', [
    { s: '38', t: 'Hours of work', txt: 'An employee shall not be required to work more than 8 hours in one day or 44 hours in one week, subject to exceptions and limits on overtime prescribed by the Act.', kw: ['hours of work', 'overtime', 'working week'] },
  ]),
  ...act('Companies Act 1967 (Singapore)', 'SG-COMPANIES', 'SG', 'corporate_law', '1967-12-29', [
    { s: '157', t: 'As to the duty and liability of officers', txt: 'A director shall at all times act honestly and use reasonable diligence in the discharge of the duties of his office, and shall not make improper use of information or position to gain an advantage.', kw: ['directors duties', 'honesty', 'reasonable diligence'] },
  ]),
  ...act('Prevention of Corruption Act 1960 (Singapore)', 'SG-PCA', 'SG', 'criminal_law', '1960-06-17', [
    { s: '5', t: 'Punishment for corruption', txt: 'Any person who corruptly solicits, receives, gives or offers any gratification as an inducement to or reward for doing or forbearing to do any act shall be guilty of an offence.', kw: ['corruption', 'gratification', 'inducement'] },
    { s: '6', t: 'Corrupt transactions with agents', txt: 'It is an offence for an agent to corruptly accept any gratification as an inducement or reward for doing any act in relation to his principal affairs, or for any person to corruptly give such gratification.', kw: ['agent', 'corrupt transaction', 'principal'] },
  ]),
  ...act('International Arbitration Act 1994 (Singapore)', 'SG-IAA', 'SG', 'dispute_resolution', '1995-01-27', [
    { s: '3', t: 'Model Law to have force of law', txt: 'Subject to this Act, the UNCITRAL Model Law on International Commercial Arbitration shall have the force of law in Singapore.', kw: ['Model Law', 'international arbitration', 'UNCITRAL'] },
  ]),
  ...act('Penal Code 1871 (Singapore) (Vol.2)', 'SG-PC', 'SG', 'criminal_law', '1872-09-16', [
    { s: '378', t: 'Theft', txt: 'Whoever, intending to take dishonestly any movable property out of the possession of any person without that person consent, moves that property in order to such taking, is said to commit theft.', kw: ['theft', 'dishonest intention', 'movable property'] },
    { s: '390', t: 'Robbery', txt: 'In all robbery there is either theft or extortion; theft is robbery if, in order to commit theft or carry away property obtained, the offender voluntarily causes or attempts to cause death, hurt, or wrongful restraint, or fear thereof.', kw: ['robbery', 'theft', 'extortion'] },
  ]),
  ...act('Protection from Harassment Act 2014 (Singapore)', 'SG-POHA', 'SG', 'criminal_law', '2014-11-15', [
    { s: '3', t: 'Intentionally causing harassment, alarm or distress', txt: 'A person who, with intent to cause harassment, alarm or distress to another, uses threatening, abusive or insulting words or behaviour, or communications, thereby causing that or any other person harassment, alarm or distress, is guilty of an offence.', kw: ['harassment', 'alarm', 'distress'] },
  ]),
  ...act('Goods and Services Tax Act 1993 (Singapore)', 'SG-GST', 'SG', 'tax_law', '1994-04-01', [
    { s: '8', t: 'Imposition of goods and services tax', txt: 'Tax shall be charged on any supply of goods or services made in Singapore where it is a taxable supply made by a taxable person in the course or furtherance of any business carried on by him.', kw: ['GST', 'taxable supply', 'taxable person'] },
  ]),
];
// ─── GULF COOPERATION COUNCIL (Vol.2) ────────────────────────────────────────
const GC2: ExpansionStatute[] = [
  ...act('UAE Federal Law No. 5 of 1985 (Civil Transactions Law)', 'UAE-CIVIL', 'GC', 'contract_law', '1986-03-29', [
    { s: 'Art.125', t: 'Definition of contract', txt: 'A contract is the concurrence of an offer made by one contracting party with the acceptance of another in a manner which establishes the effect thereof in the object of the contract and gives rise to obligations on each party.', kw: ['contract', 'offer and acceptance', 'obligations'] },
    { s: 'Art.246', t: 'Performance in good faith', txt: 'The contract must be performed in accordance with its contents and in a manner consistent with the requirements of good faith; it is not confined to obliging a party only to its express content but extends to all that is required by law, custom and the nature of the obligation.', kw: ['good faith', 'performance', 'custom'] },
  ]),
  ...act('UAE Federal Decree-Law No. 32 of 2021 (Commercial Companies Law)', 'UAE-CCL', 'GC', 'corporate_law', '2022-01-02', [
    { s: 'Art.9', t: 'Forms of companies', txt: 'A company shall take one of the following forms: joint liability company, simple commandite company, limited liability company, public joint stock company, or private joint stock company; any company not taking one of these forms shall be void.', kw: ['company forms', 'LLC', 'joint stock'] },
    { s: 'Art.84', t: 'Duties of the manager', txt: 'The manager shall preserve the rights of the company and exercise the care of a prudent person, and is liable towards the company, partners and third parties for fraudulent acts, abuse of power, and breach of the law or the memorandum.', kw: ['manager duties', 'prudent person', 'liability'] },
  ]),
  ...act('UAE Federal Decree-Law No. 8 of 2017 (Value Added Tax)', 'UAE-VAT', 'GC', 'tax_law', '2018-01-01', [
    { s: 'Art.2', t: 'Scope of tax', txt: 'Value Added Tax shall be imposed on every taxable supply and deemed supply made by a taxable person, and on the import of concerned goods, at the standard rate prescribed by the Law.', kw: ['VAT', 'taxable supply', 'import'] },
  ]),
  ...act('UAE Federal Decree-Law No. 31 of 2021 (Crimes and Penalties)', 'UAE-PENAL', 'GC', 'criminal_law', '2022-01-02', [
    { s: 'Art.453', t: 'Breach of trust', txt: 'Whoever embezzles, uses or squanders money, securities or any movable property to the detriment of those entitled to it, where it was delivered on the basis of deposit, lease, mortgage, loan for use or agency, shall be punished.', kw: ['breach of trust', 'embezzlement', 'movable property'] },
  ]),
  ...act('Saudi Labor Law (Royal Decree No. M/51 of 2005)', 'KSA-LABOR', 'GC', 'employment_law', '2006-04-23', [
    { s: 'Art.98', t: 'Working hours', txt: 'A worker may not actually work for more than eight hours a day if the employer uses the daily basis, or more than forty-eight hours a week; working hours are reduced to six hours a day during the month of Ramadan for Muslim workers.', kw: ['working hours', 'forty-eight hours', 'Ramadan'] },
  ]),
  ...act('Saudi Arbitration Law (Royal Decree No. M/34 of 2012)', 'KSA-ARB', 'GC', 'dispute_resolution', '2012-07-09', [
    { s: 'Art.9', t: 'Arbitration agreement', txt: 'An arbitration agreement may be concluded before or after the dispute arises and must be in writing; the agreement is independent of the other terms of the contract.', kw: ['arbitration agreement', 'in writing', 'separability'] },
  ]),
  ...act('Qatar Labour Law No. 14 of 2004', 'QA-LABOUR', 'GC', 'employment_law', '2005-01-06', [
    { s: 'Art.73', t: 'Maximum working hours', txt: 'The maximum number of working hours shall be forty-eight hours per week at the rate of eight hours per day, reduced to thirty-six hours per week during the month of Ramadan.', kw: ['working hours', 'forty-eight hours', 'Ramadan'] },
  ]),
  ...act('DIFC Data Protection Law No. 5 of 2020', 'DIFC-DPL', 'GC', 'data_protection', '2020-07-01', [
    { s: 'Art.9', t: 'Lawful processing of personal data', txt: 'A controller shall ensure that personal data are processed lawfully, fairly and transparently, on the basis of consent or another lawful basis set out in the Law.', kw: ['DIFC', 'lawful processing', 'consent'] },
  ]),
];

export const EXPANSION_STATUTES_VOL2: ExpansionStatute[] = [
  ...UK2,
  ...US2,
  ...EU2,
  ...SG2,
  ...GC2,
];
