/**
 * NV-STATUTE-EXPANSION-BNSS-APPS-001 — BNSS sections for the 25 essential court applications.
 * PURE DATA — upserts alongside existing BNSS rows by (jurisdiction, act, section).
 * Does NOT import runtime values from jrx-statutes-expansion-2026-06.ts (avoids circular ESM init).
 */

/** Local shape compatible with ExpansionStatute (no circular import). */
interface ExpansionStatuteRow {
  actTitle: string;
  actShortTitle: string;
  jurisdiction: string;
  sectionNumber: string;
  sectionTitle: string;
  sectionText: string;
  practiceArea: string;
  keywords: string[];
  effectiveDate: string;
  isRepealed: boolean;
}

function act(
  actTitle: string,
  actShortTitle: string,
  jurisdiction: string,
  practiceArea: string,
  effectiveDate: string,
  sections: { s: string; t: string; txt: string; kw: string[] }[],
): ExpansionStatuteRow[] {
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

export const IN_BNSS_COURT_APPS: ExpansionStatuteRow[] = [
  ...act('Bharatiya Nagarik Suraksha Sanhita, 2023', 'BNSS', 'IN', 'criminal_procedure', '2024-07-01', [
    { s: '482', t: 'Anticipatory bail', txt: 'Where any person has reason to believe that he may be arrested on an accusation of a non-bailable offence, he may apply to the High Court or the Court of Session for a direction that in the event of such arrest he shall be released on bail; and the Court may, after taking into consideration antecedents, possibility of fleeing, and possibility of tampering, issue such directions with conditions.', kw: ['anticipatory', 'bail', 'BNSS', '482'] },
    { s: '483', t: 'Bail by High Court or Court of Session in certain cases', txt: 'The High Court or Court of Session may direct that any person accused of an offence and in custody be released on bail, or reduce bail amount, subject to statutory restrictions for offences punishable with death or life imprisonment.', kw: ['bail', 'High', 'Court', 'Sessions', 'BNSS', '483'] },
    { s: '480', t: 'When bail may be taken in case of non-bailable offence', txt: 'When any person accused of, or suspected of, the commission of any non-bailable offence is arrested or detained without warrant or appears or is brought before a Court other than the High Court or Court of Session, he may be released on bail subject to the conditions and restrictions in this section.', kw: ['regular', 'bail', 'non-bailable', 'BNSS', '480'] },
    { s: '187', t: 'Procedure when investigation cannot be completed in twenty-four hours', txt: 'When investigation cannot be completed within twenty-four hours and there are grounds for believing the accusation is well-founded, the accused shall be produced before the Magistrate; the Magistrate may authorise detention pending investigation within the prescribed periods; if investigation is not completed within the time prescribed, the accused is entitled to be released on bail (default bail).', kw: ['remand', 'default', 'bail', 'BNSS', '187'] },
    { s: '492', t: 'Cancellation of bond and bail bond', txt: 'The Court may cancel the bond or bail bond and remand the person to custody if it considers it necessary, including where the person breaches conditions of bail or absconds.', kw: ['cancellation', 'of', 'bail', 'BNSS', '492'] },
    { s: '250', t: 'Discharge — Sessions trial', txt: 'If upon consideration of the record of the case and documents and after hearing the parties the Judge considers that there is not sufficient ground for proceeding against the accused, he shall discharge the accused and record reasons.', kw: ['discharge', 'sessions', 'BNSS', '250'] },
    { s: '262', t: 'Discharge — warrant case on police report', txt: 'If upon considering the police report and documents and hearing the parties the Magistrate considers the charge groundless, he shall discharge the accused and record reasons.', kw: ['discharge', 'warrant', 'police', 'BNSS', '262'] },
    { s: '268', t: 'Discharge — warrant case on complaint', txt: 'If upon taking all evidence referred to in the complaint case provisions the Magistrate considers for reasons to be recorded that no case against the accused has been made out which if unrebutted would warrant conviction, he shall discharge.', kw: ['discharge', 'complaint', 'BNSS', '268'] },
    { s: '239', t: 'Court may alter charge', txt: 'Any Court may alter or add to any charge at any time before judgment is pronounced; the accused shall be allowed to recall or re-examine witnesses where necessary.', kw: ['alteration', 'of', 'charge', 'BNSS', '239'] },
    { s: '240', t: 'Recall of witnesses when charge altered', txt: 'Whenever a charge is altered or added by the Court after commencement of trial, the prosecutor and the accused shall be allowed to recall or re-summon and examine witnesses with reference to such alteration.', kw: ['recall', 'witness', 'BNSS', '240'] },
    { s: '358', t: 'Power to proceed against other persons appearing to be guilty of offence', txt: 'Where in the course of any inquiry or trial it appears from evidence that any person not being the accused has committed any offence for which he could be tried together, the Court may proceed against such person.', kw: ['additional', 'accused', 'BNSS', '358'] },
    { s: '359', t: 'Compounding of offences', txt: 'The offences punishable under the specified sections of the Bharatiya Nyaya Sanhita may be compounded by the persons mentioned, with or without permission of the Court as provided in the table.', kw: ['compounding', 'BNSS', '359'] },
    { s: '360', t: 'Withdrawal from prosecution', txt: 'The Public Prosecutor or Assistant Public Prosecutor may, with consent of the Court, withdraw from prosecution of any person at any time before judgment is pronounced.', kw: ['withdrawal', 'prosecution', 'BNSS', '360'] },
    { s: '94', t: 'Summons to produce document or other thing', txt: 'Whenever any Court or officer considers that production of any document or other thing is necessary or desirable for investigation, inquiry, trial or other proceeding, such Court or officer may issue summons or written order to the person in whose possession it is believed to be.', kw: ['production', 'of', 'documents', 'BNSS', '94'] },
    { s: '51', t: 'Examination of accused by medical practitioner at request of police', txt: 'When a person is arrested and there are reasonable grounds for believing that examination of his person will afford evidence, a registered medical practitioner may medically examine him at the request of a police officer of prescribed rank, with safeguards.', kw: ['medical', 'examination', 'accused', 'BNSS', '51'] },
    { s: '52', t: 'Examination of person accused of rape by medical practitioner', txt: 'When a person is arrested on a charge of rape or attempt, he shall be examined by a registered medical practitioner employed in a hospital run by Government or local authority, with recording of consent and particulars.', kw: ['medical', 'examination', 'rape', 'accused', 'BNSS', '52'] },
    { s: '53', t: 'Examination of arrested person by medical practitioner at request of arrested person', txt: 'When a person arrested alleges that examination of his body will afford evidence that will disprove commission of offence or establish offence by another, the Magistrate may direct examination by a registered medical practitioner.', kw: ['medical', 'examination', 'at', 'request', 'BNSS', '53'] },
    { s: '289', t: 'Application of chapter — plea bargaining', txt: 'The plea bargaining chapter applies to an accused against whom a report under Section 193 has been forwarded or a complaint filed, for offences other than those punishable with death, life, or imprisonment exceeding seven years, and subject to exclusions for socio-economic offences and offences against women or children below fourteen.', kw: ['plea', 'bargaining', 'BNSS', '289'] },
    { s: '346', t: 'Power to postpone or adjourn proceedings', txt: 'In every inquiry or trial the proceedings shall be held as expeditiously as possible; the Court may, for reasons to be recorded, postpone or adjourn, and may impose costs on the party seeking adjournment in appropriate cases.', kw: ['adjournment', 'BNSS', '346'] },
    { s: '348', t: 'Power to summon material witness or examine person present', txt: 'Any Court may, at any stage of inquiry, trial or other proceeding, summon any person as a witness or examine any person in attendance, or recall and re-examine any person if his evidence appears essential to the just decision of the case.', kw: ['material', 'witness', 'BNSS', '348'] },
    { s: '438', t: 'Calling for records to exercise powers of revision', txt: 'The High Court or any Sessions Judge may call for and examine the record of any proceeding before any inferior Criminal Court for the purpose of satisfying itself as to the correctness, legality or propriety of any finding, sentence or order.', kw: ['revision', 'BNSS', '438'] },
    { s: '447', t: 'Power of High Court to transfer cases and appeals', txt: 'Whenever it is made to appear to the High Court that a fair and impartial inquiry or trial cannot be held, or that some question of law of unusual difficulty is likely to arise, or that transfer will tend to the general convenience of parties or witnesses, or is expedient for the ends of justice, it may transfer any particular case or appeal.', kw: ['transfer', 'High', 'Court', 'BNSS', '447'] },
    { s: '448', t: 'Power of Sessions Judge to transfer cases and appeals', txt: 'A Sessions Judge may transfer any particular case from one Criminal Court to another Criminal Court in his sessions division when expedient for the ends of justice or convenience of parties.', kw: ['transfer', 'Sessions', 'BNSS', '448'] },
    { s: '430', t: 'Suspension of sentence pending appeal; release on bail', txt: 'Pending any appeal by a convicted person, the Appellate Court may for reasons to be recorded order that the execution of the sentence or order appealed against be suspended and also if he is in confinement that he be released on bail or on his own bond.', kw: ['suspension', 'of', 'sentence', 'BNSS', '430'] },
    { s: '497', t: 'Order for custody and disposal of property pending trial', txt: 'When any property is produced before any Criminal Court during inquiry or trial, the Court may make such order as it thinks fit for the proper custody of such property pending the conclusion of the inquiry or trial.', kw: ['custody', 'property', 'BNSS', '497'] },
    { s: '498', t: 'Order for disposal of property at conclusion of trial', txt: 'When an inquiry or trial is concluded, the Court may make such order as it thinks fit for the disposal by destruction, confiscation or delivery to any person claiming to be entitled to possession of property produced.', kw: ['disposal', 'property', 'BNSS', '498'] },
    { s: '84', t: 'Proclamation for person absconding', txt: 'If any Court has reason to believe that any person against whom a warrant has been issued has absconded or is concealing himself so that warrant cannot be executed, such Court may publish a written proclamation requiring him to appear.', kw: ['proclamation', 'absconder', 'BNSS', '84'] },
    { s: '85', t: 'Attachment of property of person absconding', txt: 'The Court issuing a proclamation may at any time order attachment of any property belonging to the proclaimed person.', kw: ['attachment', 'absconder', 'BNSS', '85'] },
  ]),
];
