/**
 * Jurexio - Statute seed EXPANSION Vol.4 (USA federal + corporate deep)
 * NV-STATUTE-EXPANSION-004
 * ---------------------------------------------------------------------------
 * PURE DATA MODULE (no DB / no side-effect imports). Deepens US coverage with a
 * focus on corporate, securities, antitrust, tax and federal employment law for
 * superior case analysis, drafting, citation verification and practice-area
 * classification.
 *
 * Section texts are concise, accurate paraphrases suitable for RAG grounding +
 * citation. Act short titles are NEW (distinct from base getUSStatutes() and
 * Vol.2): base/Vol.2 already cover CCPA, HIPAA, SOX, Dodd-Frank, UCC, UCC-2,
 * FCPA, Patent (Title 35), FLSA, ADEA, Bankruptcy (Title 11), FRCP, DTSA, CFAA.
 */
import { act, type ExpansionStatute } from './jrx-statutes-expansion-2026-06.js';

// ─── Securities regulation ────────────────────────────────────────────────────
const US_SECURITIES: ExpansionStatute[] = [
  ...act('Securities Act of 1933 (15 U.S.C. §77a et seq.)', 'US-SA1933', 'US', 'securities_law', '1933-05-27', [
    { s: '11', t: 'Civil liabilities on account of false registration statement', txt: 'Where a registration statement contains an untrue statement of a material fact or omits a material fact, any acquirer of the security may sue the issuer, signatories, directors, underwriters and experts for damages.', kw: ['Section 11', 'material misstatement', 'issuer liability'] },
    { s: '4', t: 'Exempted transactions', txt: 'The registration provisions do not apply to transactions by an issuer not involving a public offering (private placement) or to transactions by persons other than an issuer, underwriter or dealer.', kw: ['private placement', 'exemption', 'Reg D', 'Securities Act 4'] },
  ]),
  ...act('Securities Exchange Act of 1934 (15 U.S.C. §78a et seq.)', 'US-SEA1934', 'US', 'securities_law', '1934-06-06', [
    { s: '13(a)', t: 'Periodic and other reports', txt: 'Issuers of registered securities must file with the SEC such annual (Form 10-K), quarterly (Form 10-Q) and current (Form 8-K) reports as the Commission prescribes to keep information reasonably current.', kw: ['periodic reporting', '10-K', '8-K', 'Exchange Act 13'] },
    { s: '14(a)', t: 'Proxy solicitations', txt: 'It is unlawful to solicit any proxy in respect of a registered security in contravention of SEC rules, which require full and fair disclosure in proxy statements.', kw: ['proxy', 'disclosure', 'Exchange Act 14a'] },
    { s: '16(b)', t: 'Short-swing profit recovery', txt: 'Any profit realized by a director, officer or ten-percent beneficial owner from any purchase and sale of the issuer security within a period of less than six months is recoverable by the issuer.', kw: ['short-swing', 'insider', 'Section 16b'] },
  ]),
  ...act('Investment Company Act of 1940 (15 U.S.C. §80a)', 'US-ICA1940', 'US', 'securities_law', '1940-08-22', [
    { s: '7', t: 'Transactions by unregistered investment companies', txt: 'An investment company organized in the United States may not engage in interstate business or offer its securities unless it is registered with the Commission under this title.', kw: ['investment company', 'mutual fund', 'registration', 'ICA 7'] },
  ]),
  ...act('Investment Advisers Act of 1940 (15 U.S.C. §80b)', 'US-IAA1940', 'US', 'securities_law', '1940-08-22', [
    { s: '206', t: 'Prohibited transactions by investment advisers', txt: 'It is unlawful for any investment adviser to employ any device, scheme or artifice to defraud a client, or to engage in any transaction, practice or course of business which operates as a fraud; advisers owe a fiduciary duty to clients.', kw: ['investment adviser', 'fiduciary duty', 'fraud', 'IAA 206'] },
  ]),
  ...act('Jumpstart Our Business Startups (JOBS) Act of 2012', 'US-JOBS', 'US', 'securities_law', '2012-04-05', [
    { s: 'III', t: 'Crowdfunding exemption', txt: 'Title III creates an exemption permitting issuers to raise capital from the general public through registered crowdfunding portals, subject to annual aggregate limits and investor caps based on income and net worth.', kw: ['crowdfunding', 'emerging growth company', 'JOBS Act'] },
  ]),
];

// ─── Corporate governance ─────────────────────────────────────────────────────
const US_CORP: ExpansionStatute[] = [
  ...act('Delaware General Corporation Law (8 Del. C.)', 'US-DGCL', 'US', 'corporate_law', '1967-07-03', [
    { s: '102', t: 'Contents of certificate of incorporation', txt: 'The certificate of incorporation shall set forth the corporate name, registered office and agent, nature of business, authorized shares, and may include a provision eliminating or limiting the personal liability of a director for breach of fiduciary duty subject to statutory exceptions.', kw: ['certificate of incorporation', 'exculpation', 'DGCL 102'] },
    { s: '141', t: 'Board of directors; powers; number; qualifications', txt: 'The business and affairs of every corporation shall be managed by or under the direction of a board of directors; directors owe fiduciary duties of care and loyalty and are protected by the business judgment rule.', kw: ['board of directors', 'business judgment rule', 'fiduciary duty', 'DGCL 141'] },
    { s: '144', t: 'Interested directors; quorum', txt: 'A contract or transaction between a corporation and one or more of its directors is not void solely for that reason if the material facts are disclosed and it is approved in good faith by disinterested directors or stockholders, or is fair to the corporation.', kw: ['interested director', 'conflict of interest', 'DGCL 144'] },
    { s: '251', t: 'Merger or consolidation of domestic corporations', txt: 'Any two or more corporations may merge into a single corporation by a board-adopted agreement of merger, approved by the holders of a majority of the outstanding stock entitled to vote, and the filing of a certificate of merger.', kw: ['merger', 'M&A', 'stockholder approval', 'DGCL 251'] },
    { s: '262', t: 'Appraisal rights', txt: 'Stockholders who dissent from certain mergers and comply with statutory procedures are entitled to an appraisal by the Court of Chancery of the fair value of their shares, exclusive of any value arising from the merger.', kw: ['appraisal rights', 'dissenters', 'fair value', 'DGCL 262'] },
  ]),
  ...act('Model Business Corporation Act', 'US-MBCA', 'US', 'corporate_law', '1984-01-01', [
    { s: '8.30', t: 'Standards of conduct for directors', txt: 'Each member of the board shall discharge their duties in good faith, with the care an ordinarily prudent person in a like position would exercise, and in a manner the director reasonably believes to be in the best interests of the corporation.', kw: ['duty of care', 'good faith', 'MBCA 8.30'] },
    { s: '8.31', t: 'Standards of liability for directors', txt: 'A director is not liable for an action taken as a director unless the challenged conduct was not in good faith, or the director was not informed to an extent reasonably appropriate, or there was a sustained failure to devote attention to oversight.', kw: ['director liability', 'oversight', 'MBCA 8.31'] },
  ]),
  ...act('Employee Retirement Income Security Act of 1974 (ERISA)', 'US-ERISA', 'US', 'employment_law', '1974-09-02', [
    { s: '404', t: 'Fiduciary duties', txt: 'A fiduciary shall discharge his duties with respect to a plan solely in the interest of the participants and beneficiaries, with the care, skill, prudence and diligence of a prudent person, and by diversifying plan investments to minimize the risk of large losses.', kw: ['ERISA', 'fiduciary', 'prudent person', 'benefit plan'] },
  ]),
];

// ─── Antitrust / competition (Sherman §1/§2 + FTC §5 already in Vol.1) ───────
const US_ANTITRUST: ExpansionStatute[] = [
  ...act('Clayton Antitrust Act (15 U.S.C. §§12-27)', 'US-CLAYTON', 'US', 'competition_law', '1914-10-15', [
    { s: '7', t: 'Acquisition of stock or assets lessening competition', txt: 'No person engaged in commerce shall acquire the stock or assets of another person where the effect of such acquisition may be substantially to lessen competition or to tend to create a monopoly.', kw: ['merger', 'substantial lessening of competition', 'Clayton 7'] },
    { s: '3', t: 'Exclusive dealing and tying arrangements', txt: 'It is unlawful to lease or sell goods on the condition that the buyer not deal in the goods of a competitor where the effect may be substantially to lessen competition or tend to create a monopoly.', kw: ['exclusive dealing', 'tying', 'Clayton 3'] },
  ]),
  ...act('Hart-Scott-Rodino Antitrust Improvements Act of 1976', 'US-HSR', 'US', 'competition_law', '1976-09-30', [
    { s: '7A', t: 'Premerger notification and waiting period', txt: 'Parties to acquisitions exceeding statutory size-of-transaction and size-of-person thresholds must file premerger notification with the FTC and DOJ and observe a waiting period before consummating the transaction.', kw: ['HSR filing', 'premerger notification', 'waiting period'] },
  ]),
  ...act('Robinson-Patman Act (15 U.S.C. §13)', 'US-RPA', 'US', 'competition_law', '1936-06-19', [
    { s: '2(a)', t: 'Price discrimination', txt: 'It is unlawful for any person engaged in commerce to discriminate in price between different purchasers of commodities of like grade and quality where the effect may be substantially to lessen competition or tend to create a monopoly.', kw: ['price discrimination', 'Robinson-Patman'] },
  ]),
];

// ─── Tax & intellectual property ─────────────────────────────────────────────
const US_TAX_IP: ExpansionStatute[] = [
  ...act('Internal Revenue Code (26 U.S.C.)', 'US-IRC', 'US', 'tax_law', '1986-10-22', [
    { s: '11', t: 'Tax imposed on corporations', txt: 'A tax is imposed for each taxable year on the taxable income of every corporation; following the 2017 reform the corporate rate is a flat twenty-one percent.', kw: ['corporate tax', 'taxable income', 'IRC 11'] },
    { s: '162', t: 'Trade or business expenses', txt: 'There shall be allowed as a deduction all the ordinary and necessary expenses paid or incurred during the taxable year in carrying on any trade or business, including reasonable compensation and rentals.', kw: ['business deduction', 'ordinary and necessary', 'IRC 162'] },
    { s: '482', t: 'Allocation of income among related taxpayers', txt: 'The Secretary may distribute, apportion or allocate gross income, deductions and credits among organizations owned or controlled by the same interests if necessary to prevent evasion of taxes or clearly to reflect income (transfer pricing — arm length standard).', kw: ['transfer pricing', 'arm length', 'IRC 482'] },
  ]),
  ...act('Lanham Act (15 U.S.C. §1051 et seq.)', 'US-LANHAM', 'US', 'intellectual_property', '1947-07-05', [
    { s: '43(a)', t: 'False designations of origin and unfair competition', txt: 'Any person who uses in commerce any word, term, name or false designation of origin likely to cause confusion as to affiliation or to misrepresent the nature or qualities of goods or services is liable in a civil action.', kw: ['unfair competition', 'false advertising', 'Lanham 43a'] },
    { s: '45', t: 'Definitions; trademark and use in commerce', txt: 'Trademark includes any word, name, symbol or device used to identify and distinguish goods and to indicate their source; a mark is deemed in use in commerce when placed on goods sold or transported in commerce.', kw: ['trademark definition', 'use in commerce', 'Lanham 45'] },
  ]),
  ...act('Copyright Act of 1976 (17 U.S.C.)', 'US-COPYRIGHT76', 'US', 'intellectual_property', '1978-01-01', [
    { s: '106', t: 'Exclusive rights in copyrighted works', txt: 'The owner of copyright has the exclusive rights to reproduce the work, prepare derivative works, distribute copies, perform the work publicly, and display the work publicly.', kw: ['exclusive rights', 'reproduction', 'derivative works', 'Copyright 106'] },
    { s: '512', t: 'Limitations on liability relating to online material (DMCA safe harbor)', txt: 'A service provider is not liable for monetary relief for infringement by reason of storage of material at the direction of a user if it lacks actual knowledge, acts expeditiously to remove material upon notice, and adopts a repeat-infringer policy.', kw: ['DMCA', 'safe harbor', 'notice and takedown', 'Copyright 512'] },
  ]),
];

// ─── Employment & civil rights ───────────────────────────────────────────────
const US_EMPLOYMENT: ExpansionStatute[] = [
  ...act('Title VII of the Civil Rights Act of 1964 (42 U.S.C. §2000e)', 'US-TITLEVII', 'US', 'employment_law', '1964-07-02', [
    { s: '703', t: 'Unlawful employment practices', txt: 'It is an unlawful employment practice for an employer to fail or refuse to hire, to discharge, or otherwise to discriminate against any individual with respect to compensation, terms or conditions of employment because of race, color, religion, sex or national origin.', kw: ['discrimination', 'Title VII', 'protected class', 'CRA 703'] },
  ]),
  ...act('Americans with Disabilities Act of 1990 (42 U.S.C. §12101)', 'US-ADA', 'US', 'employment_law', '1992-07-26', [
    { s: '102', t: 'Discrimination on the basis of disability', txt: 'No covered entity shall discriminate against a qualified individual on the basis of disability; this includes failing to make reasonable accommodations unless doing so would impose an undue hardship.', kw: ['disability', 'reasonable accommodation', 'undue hardship', 'ADA 102'] },
  ]),
  ...act('Family and Medical Leave Act of 1993 (29 U.S.C. §2601)', 'US-FMLA', 'US', 'employment_law', '1993-08-05', [
    { s: '102', t: 'Leave requirement', txt: 'An eligible employee is entitled to twelve workweeks of unpaid, job-protected leave during any twelve-month period for the birth or care of a child, a serious health condition, or to care for a spouse, child or parent with a serious health condition.', kw: ['FMLA', 'unpaid leave', 'job protection', 'FMLA 102'] },
  ]),
  ...act('National Labor Relations Act (29 U.S.C. §151)', 'US-NLRA', 'US', 'employment_law', '1935-07-05', [
    { s: '7', t: 'Rights of employees', txt: 'Employees have the right to self-organization, to form, join or assist labor organizations, to bargain collectively through representatives of their own choosing, and to engage in concerted activities for mutual aid or protection.', kw: ['collective bargaining', 'concerted activity', 'union', 'NLRA 7'] },
    { s: '8', t: 'Unfair labor practices', txt: 'It is an unfair labor practice for an employer to interfere with employees in the exercise of Section 7 rights, to dominate a labor organization, or to discriminate against employees for union activity, or to refuse to bargain collectively.', kw: ['unfair labor practice', 'NLRA 8'] },
  ]),
];

// ─── Financial regulation & AML ──────────────────────────────────────────────
const US_FINANCIAL: ExpansionStatute[] = [
  ...act('Gramm-Leach-Bliley Act of 1999 (15 U.S.C. §6801)', 'US-GLBA', 'US', 'financial_law', '1999-11-12', [
    { s: '501', t: 'Protection of nonpublic personal information', txt: 'Each financial institution has an affirmative and continuing obligation to respect the privacy of its customers and to protect the security and confidentiality of customers nonpublic personal information.', kw: ['financial privacy', 'safeguards rule', 'GLBA 501'] },
  ]),
  ...act('Bank Secrecy Act (31 U.S.C. §5311 et seq.)', 'US-BSA', 'US', 'financial_law', '1970-10-26', [
    { s: '5318(h)', t: 'Anti-money laundering programs', txt: 'Financial institutions must establish anti-money laundering programs including internal policies, a designated compliance officer, ongoing employee training, and an independent audit function; suspicious activity reports and currency transaction reports must be filed.', kw: ['AML program', 'SAR', 'CTR', 'BSA 5318'] },
  ]),
  ...act('Dodd-Frank Wall Street Reform and Consumer Protection Act of 2010', 'US-DODDFRANK', 'US', 'financial_law', '2010-07-21', [
    { s: '619', t: 'Volcker Rule — prohibitions on proprietary trading', txt: 'A banking entity shall not engage in proprietary trading or acquire or retain any ownership interest in a hedge fund or private equity fund, subject to permitted activities and exemptions.', kw: ['Volcker Rule', 'proprietary trading', 'Dodd-Frank 619'] },
    { s: '922', t: 'Whistleblower protection and incentives', txt: 'The SEC shall pay awards to whistleblowers who voluntarily provide original information leading to a successful enforcement action resulting in monetary sanctions over one million dollars, and prohibits retaliation against whistleblowers.', kw: ['whistleblower', 'bounty', 'retaliation', 'Dodd-Frank 922'] },
  ]),
];

export const EXPANSION_STATUTES_VOL4_US: ExpansionStatute[] = [
  ...US_SECURITIES,
  ...US_CORP,
  ...US_ANTITRUST,
  ...US_TAX_IP,
  ...US_EMPLOYMENT,
  ...US_FINANCIAL,
];
