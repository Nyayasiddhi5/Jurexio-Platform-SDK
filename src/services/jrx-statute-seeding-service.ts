// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Jurexio Statute Seeding Service
 * @version 3.1.2
 *
 * Seeds ALL 6 jurisdiction statute databases on startup:
 *  - India: BNS, BNSS, BSA, IPC, CPC, Constitution, Companies Act, IBC, SEBI, IT Act,
 *           Indian Contract Act, Transfer of Property Act, NI Act, Limitation Act,
 *           Arbitration Act, Consumer Protection Act, Hindu Marriage Act, Hindu Succession Act,
 *           Muslim Personal Law, RTI Act, RERA, POCSO, NDPS, Prevention of Corruption Act,
 *           Motor Vehicles Act, DPDPA 2023, GST Acts, FEMA, Labour Codes
 *  - UK: Companies Act, Employment Rights Act, Arbitration Act, UK GDPR, FSMA
 *  - US: CCPA, HIPAA, SOX, Dodd-Frank, UCC
 *  - EU: GDPR, EU AI Act, DSA, DMA
 *  - GCC: UAE Commercial Code, Saudi Commercial Court Law, UAE Cyber Crime Law, DIFC Companies Law
 *  - Singapore: Companies Act, Employment Act, Int'l Arbitration Act, PDPA, Securities Act
 *
 * Table: nv_statutes
 * Seeds ~600+ sections across 6 jurisdictions. Idempotent — upserts on conflict.
 */

import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
// NV-STATUTE-EXPANSION-001 (2026-06-25): foundational statute expansion for the
// five non-India jurisdictions, kept in a pure data module (no DB side effects).
import { EXPANSION_STATUTES } from '../data/jrx-statutes-expansion-2026-06.js';

const logger = createLogger('statute-seeder');

/**
 * Canonical assembled seed set across all 6 jurisdictions (base getters +
 * the 2026-06 expansion). Exported so the SQL generator
 * (scripts/jrx-export-statutes-sql.ts) and tests can reuse the exact same data.
 */
export function getAllSeedStatutes(): StatuteSection[] {
  return [
    ...getIndiaStatutes(),
    ...getUKStatutes(),
    ...getEUStatutes(),
    ...getUSStatutes(),
    ...getGCCStatutes(),
    ...getSingaporeStatutes(),
    ...(EXPANSION_STATUTES as StatuteSection[]),
  ];
}

interface StatuteSection {
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

async function ensureStatuteTable(): Promise<void> {
  // NV-STATUTE-EXPANSION-001: best-effort DDL. On hardened prod RDS the runtime
  // role (nv_app) has USAGE but not CREATE, so CREATE TABLE/INDEX raises
  // "permission denied" even with IF NOT EXISTS (Postgres checks the schema
  // CREATE privilege before the short-circuit). The table/indexes already exist
  // there (provisioned by the privileged migration), so swallow the DDL error
  // and proceed to the idempotent upsert. Dev DBs with CREATE still auto-create.
  const ddl: Array<ReturnType<typeof sql>> = [
    sql`
      CREATE TABLE IF NOT EXISTS nv_statutes (
        id              SERIAL PRIMARY KEY,
        act_title       TEXT NOT NULL,
        act_short_title TEXT NOT NULL,
        jurisdiction    VARCHAR(10) NOT NULL,
        section_number  VARCHAR(50) NOT NULL,
        section_title   TEXT,
        section_text    TEXT,
        practice_area   VARCHAR(100),
        keywords        TEXT[],
        effective_date  DATE,
        amended_date    DATE,
        related_sections TEXT[],
        is_repealed     BOOLEAN DEFAULT FALSE,
        search_vector   TSVECTOR GENERATED ALWAYS AS (
          to_tsvector('english', coalesce(act_title, '') || ' ' || coalesce(section_title, '') || ' ' || coalesce(section_text, ''))
        ) STORED,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(jurisdiction, act_short_title, section_number)
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS idx_nv_statutes_jurisdiction ON nv_statutes (jurisdiction)`,
    sql`CREATE INDEX IF NOT EXISTS idx_nv_statutes_act ON nv_statutes (act_short_title, jurisdiction)`,
    sql`CREATE INDEX IF NOT EXISTS idx_nv_statutes_search ON nv_statutes USING GIN (search_vector)`,
    sql`CREATE INDEX IF NOT EXISTS idx_nv_statutes_practice ON nv_statutes (practice_area, jurisdiction)`,
  ];
  for (const stmt of ddl) {
    try {
      await db.execute(stmt);
    } catch (e: any) {
      logger.warn(`statute_ddl_skipped (likely no CREATE priv; table exists): ${e?.message || e}`);
    }
  }
}

function helper(actTitle: string, actShortTitle: string, jurisdiction: string, practiceArea: string, effectiveDate: string, sections: { s: string; t: string; txt: string; kw: string[] }[], isRepealed = false, relatedSections?: string[]): StatuteSection[] {
  return sections.map(sec => ({
    actTitle, actShortTitle, jurisdiction, sectionNumber: sec.s, sectionTitle: sec.t, sectionText: sec.txt, practiceArea, keywords: sec.kw, effectiveDate, isRepealed, relatedSections,
  }));
}

function getIndiaStatutes(): StatuteSection[] {
  const s: StatuteSection[] = [];

  s.push(...helper('Bharatiya Nyaya Sanhita, 2023', 'BNS', 'IN', 'criminal_law', '2024-07-01', [
    { s: '1', t: 'Short title, extent and commencement', txt: 'This Act may be called the Bharatiya Nyaya Sanhita, 2023. It extends to the whole of India except the State of Jammu and Kashmir.', kw: ['BNS', 'title', 'extent'] },
    { s: '2', t: 'Definitions', txt: 'In this Act, unless the context otherwise requires: (1) "act" denotes as well a series of acts as a single act; (2) "animal" denotes any living creature, other than a human being; (3) "document" means any matter expressed or described upon any substance by means of letters, figures or marks.', kw: ['definitions', 'act', 'animal', 'document'] },
    { s: '4', t: 'Punishments', txt: 'The punishments to which offenders are liable under the provisions of this Sanhita are: (a) Death; (b) Imprisonment for life; (c) Imprisonment which is of two descriptions, namely: (1) Rigorous; (2) Simple; (d) Forfeiture of property; (e) Fine; (f) Community Service.', kw: ['punishments', 'death', 'imprisonment', 'fine', 'community service'] },
    { s: '14', t: 'Act of a person bound by law', txt: 'Nothing is an offence which is done by a person who is, or who by reason of a mistake of fact and not by reason of a mistake of law in good faith believes himself to be, bound by law to do it.', kw: ['general exception', 'mistake of fact', 'bound by law'] },
    { s: '17', t: 'Act causing slight harm', txt: 'Nothing is an offence by reason that it causes, or that it is intended to cause, or that it is known to be likely to cause, any harm, if that harm is so slight that no person of ordinary sense and temper would complain of such harm.', kw: ['slight harm', 'de minimis'] },
    { s: '34', t: 'Acts done by several persons in furtherance of common intention', txt: 'When a criminal act is done by several persons in furtherance of the common intention of all, each of such persons is liable for that act in the same manner as if it were done by him alone.', kw: ['common intention', 'joint liability', 'Section 34'] },
    { s: '61', t: 'Criminal conspiracy', txt: 'When two or more persons agree to do, or cause to be done an illegal act, or an act which is not illegal by illegal means, such an agreement is designated a criminal conspiracy.', kw: ['criminal conspiracy', 'agreement', 'illegal act'] },
    { s: '100', t: 'Culpable homicide', txt: 'Whoever causes death by doing an act with the intention of causing death, or with the intention of causing such bodily injury as is likely to cause death, or with the knowledge that he is likely by such act to cause death, commits the offence of culpable homicide.', kw: ['culpable homicide', 'death', 'intention'] },
    { s: '101', t: 'Murder', txt: 'Culpable homicide is murder if the act by which the death is caused is done with the intention of causing death; or if it is done with the intention of causing such bodily injury as the offender knows to be likely to cause the death of the person to whom the harm is caused.', kw: ['murder', 'culpable homicide', 'intention'] },
    { s: '103', t: 'Punishment for murder', txt: 'Whoever commits murder shall be punished with death or imprisonment for life, and shall also be liable to fine.', kw: ['murder', 'punishment', 'death penalty', 'life imprisonment'] },
    { s: '105', t: 'Punishment for culpable homicide not amounting to murder', txt: 'Whoever commits culpable homicide not amounting to murder shall be punished with imprisonment for life, or imprisonment of either description for a term which may extend to ten years, and shall also be liable to fine.', kw: ['culpable homicide not amounting to murder', 'punishment'] },
    { s: '109', t: 'Attempt to murder', txt: 'Whoever does any act with such intention or knowledge, and under such circumstances that, if he by that act caused death, he would be guilty of murder, shall be punished with imprisonment of either description for a term which may extend to ten years, and shall also be liable to fine.', kw: ['attempt to murder', 'punishment'] },
    { s: '115', t: 'Voluntarily causing grievous hurt', txt: 'Whoever voluntarily causes hurt shall be punished with imprisonment of either description for a term which may extend to one year, or with fine, or with both. Whoever voluntarily causes grievous hurt shall be punished with imprisonment of either description for a term which shall not be less than one year but which may extend to seven years, and shall also be liable to fine.', kw: ['grievous hurt', 'voluntarily causing hurt', 'punishment'] },
    { s: '118', t: 'Assault or criminal force', txt: 'Whoever makes any gesture, or any preparation intending or knowing it to be likely that such gesture or preparation will cause any person present to apprehend that he who makes that gesture or preparation is about to use criminal force to that person, is said to commit an assault.', kw: ['assault', 'criminal force'] },
    { s: '63', t: 'Abetment of a thing', txt: 'A person abets the doing of a thing, who: First — Instigates any person to do that thing; or Secondly — Engages with one or more other person or persons in any conspiracy for the doing of that thing; or Thirdly — Intentionally aids, by any act or illegal omission, the doing of that thing.', kw: ['abetment', 'instigation', 'conspiracy', 'aiding'] },
    { s: '69', t: 'Attempt to commit offences', txt: 'Whoever attempts to commit an offence punishable by this Sanhita or by any other law with imprisonment or fine, shall, where no express provision is made by this Sanhita or by such other law for the punishment of such attempt, be punished with imprisonment of any description provided for the offence, for a term which may extend to one-half of the longest term of imprisonment provided for that offence, or with such fine as is provided for the offence, or with both.', kw: ['attempt', 'punishment for attempt'] },
    { s: '263', t: 'Forgery', txt: 'Whoever makes any false document or false electronic record or part of a document or electronic record, with intent to cause damage or injury, to the public or to any person, or to support any claim or title, or to cause any person to part with property, or to enter into any express or implied contract, or with intent to commit fraud or that fraud may be committed, commits forgery.', kw: ['forgery', 'false document', 'electronic record', 'fraud'] },
    { s: '303', t: 'Theft', txt: 'Whoever, intending to take dishonestly any moveable property out of the possession of any person without that person\'s consent, moves that property in order to such taking, is said to commit theft.', kw: ['theft', 'moveable property', 'dishonest'] },
    { s: '308', t: 'Extortion', txt: 'Whoever intentionally puts any person in fear of any injury to that person, or to any other, and thereby dishonestly induces the person so put in fear to deliver to any person any property or valuable security, commits extortion.', kw: ['extortion', 'fear', 'injury'] },
    { s: '309', t: 'Robbery', txt: 'In all robbery there is either theft or extortion. When theft is robbery — Theft is robbery if, in order to the committing of the theft, or in committing the theft, or in carrying away or attempting to carry away property obtained by the theft, the offender, for that end, voluntarily causes or attempts to cause to any person death or hurt or wrongful restraint, or fear of instant death or of instant hurt, or of instant wrongful restraint.', kw: ['robbery', 'theft', 'extortion', 'hurt'] },
    { s: '310', t: 'Dacoity', txt: 'When five or more persons conjointly commit or attempt to commit a robbery, or where the whole number of persons conjointly committing or attempting to commit a robbery, and persons present and aiding such commission or attempt, amount to five or more, every person so committing, attempting or aiding, is said to commit dacoity.', kw: ['dacoity', 'robbery', 'five persons'] },
    { s: '316', t: 'Cheating', txt: 'Whoever, by deceiving any person, fraudulently or dishonestly induces the person so deceived to deliver any property to any person, or to consent that any person shall retain any property, is said to cheat.', kw: ['cheating', 'fraud', 'deceiving'] },
    { s: '318', t: 'Cheating by impersonation', txt: 'Whoever cheats by pretending to be some other person, or by knowingly substituting one person for another, or representing that he or any other person is a person other than he or such other person really is, shall be punished with imprisonment of either description for a term which may extend to five years, or with fine, or with both.', kw: ['cheating by impersonation', 'fraud', 'identity'] },
    { s: '329', t: 'Criminal breach of trust', txt: 'Whoever, being in any manner entrusted with property, or with any dominion over property, dishonestly misappropriates or converts to his own use that property, or dishonestly uses or disposes of that property in violation of any direction of law prescribing the mode in which such trust is to be discharged, commits criminal breach of trust.', kw: ['criminal breach of trust', 'entrustment', 'misappropriation'] },
    { s: '351', t: 'Criminal intimidation', txt: 'Whoever threatens another with any injury to his person, reputation or property, or to the person or reputation of any one in whom that person is interested, with intent to cause alarm to that person, or to cause that person to do any act which he is not legally bound to do, or to omit to do any act which that person is legally entitled to do, as the means of avoiding the execution of such threat, commits criminal intimidation.', kw: ['criminal intimidation', 'threat', 'injury', 'alarm'] },
    { s: '64', t: 'Offence of sexual harassment', txt: 'A man committing any of the following acts: (i) physical contact and advances involving unwelcome and explicit sexual overtures; or (ii) a demand or request for sexual favours; or (iii) showing pornography against the will of a woman; or (iv) making sexually coloured remarks, shall be guilty of the offence of sexual harassment.', kw: ['sexual harassment', 'unwelcome advances', 'sexual favours'] },
  ]));

  s.push(...helper('Indian Penal Code, 1860', 'IPC', 'IN', 'criminal_law', '1862-01-01', [
    { s: '302', t: 'Punishment for murder', txt: 'Whoever commits murder shall be punished with death, or imprisonment for life, and shall also be liable to fine.', kw: ['murder', 'punishment', 'IPC'] },
    { s: '304', t: 'Punishment for culpable homicide not amounting to murder', txt: 'Whoever commits culpable homicide not amounting to murder shall, if the act by which the death is caused is done with the intention of causing death, be punished with imprisonment for life, or imprisonment of either description for a term which may extend to ten years, and shall also be liable to fine.', kw: ['culpable homicide', 'punishment', 'IPC 304'] },
    { s: '304A', t: 'Causing death by negligence', txt: 'Whoever causes the death of any person by doing any rash or negligent act not amounting to culpable homicide, shall be punished with imprisonment of either description for a term which may extend to two years, or with fine, or with both.', kw: ['death by negligence', 'rash act', 'IPC 304A'] },
    { s: '307', t: 'Attempt to murder', txt: 'Whoever does any act with such intention or knowledge, and under such circumstances that, if he by that act caused death, he would be guilty of murder, shall be punished with imprisonment of either description for a term which may extend to ten years, and shall also be liable to fine.', kw: ['attempt to murder', 'IPC 307'] },
    { s: '354', t: 'Assault or criminal force to woman with intent to outrage her modesty', txt: 'Whoever assaults or uses criminal force to any woman, intending to outrage or knowing it to be likely that he will thereby outrage her modesty, shall be punished with imprisonment of either description for a term which shall not be less than one year but which may extend to five years, and shall also be liable to fine.', kw: ['assault', 'outraging modesty', 'woman', 'IPC 354'] },
    { s: '376', t: 'Punishment for rape', txt: 'Whoever, except in the cases provided for in sub-section (2), commits rape, shall be punished with rigorous imprisonment of either description for a term which shall not be less than ten years, but which may extend to imprisonment for life, and shall also be liable to fine.', kw: ['rape', 'punishment', 'IPC 376'] },
    { s: '379', t: 'Punishment for theft', txt: 'Whoever commits theft shall be punished with imprisonment of either description for a term which may extend to three years, or with fine, or with both.', kw: ['theft', 'punishment', 'IPC 379'] },
    { s: '406', t: 'Punishment for criminal breach of trust', txt: 'Whoever commits criminal breach of trust shall be punished with imprisonment of either description for a term which may extend to three years, or with fine, or with both.', kw: ['criminal breach of trust', 'punishment'] },
    { s: '415', t: 'Cheating', txt: 'Whoever, by deceiving any person, fraudulently or dishonestly induces the person so deceived to deliver any property to any person, or to consent that any person shall retain any property, is said to "cheat".', kw: ['cheating', 'fraud', 'deception'] },
    { s: '420', t: 'Cheating and dishonestly inducing delivery of property', txt: 'Whoever cheats and thereby dishonestly induces the person deceived to deliver any property to any person, or to make, alter or destroy the whole or any part of a valuable security, shall be punished with imprisonment of either description for a term which may extend to seven years, and shall also be liable to fine.', kw: ['cheating', 'fraud', 'IPC 420'] },
    { s: '498A', t: 'Husband or relative of husband subjecting woman to cruelty', txt: 'Whoever, being the husband or the relative of the husband of a woman, subjects such woman to cruelty shall be punished with imprisonment for a term which may extend to three years and shall also be liable to fine.', kw: ['cruelty', 'domestic violence', 'IPC 498A'] },
    { s: '120B', t: 'Punishment of criminal conspiracy', txt: 'Whoever is a party to a criminal conspiracy to commit an offence punishable with death, imprisonment for life or rigorous imprisonment for a term of two years or upwards, shall be punished in the same manner as if he had abetted such offence.', kw: ['criminal conspiracy', 'abetment'] },
    { s: '34', t: 'Acts done by several persons in furtherance of common intention', txt: 'When a criminal act is done by several persons in furtherance of the common intention of all, each of such persons is liable for that act in the same manner as if it were done by him alone.', kw: ['common intention', 'joint liability', 'IPC 34'] },
    { s: '149', t: 'Every member of unlawful assembly guilty of offence committed in prosecution of common object', txt: 'If an offence is committed by any member of an unlawful assembly in prosecution of the common object of that assembly, or such as the members of that assembly knew to be likely to be committed in prosecution of that object, every person who, at the time of the committing of that offence, is a member of the same assembly, is guilty of that offence.', kw: ['unlawful assembly', 'common object', 'IPC 149'] },
    { s: '467', t: 'Forgery of valuable security, will, etc.', txt: 'Whoever forges a document which purports to be a valuable security or a will, or an authority to adopt a son, or which purports to give authority to any person to make or transfer any valuable security, or to receive the principal, interest or dividends thereon, shall be punished with imprisonment for life, or with imprisonment of either description for a term which may extend to ten years, and shall also be liable to fine.', kw: ['forgery', 'valuable security', 'will', 'IPC 467'] },
    { s: '471', t: 'Using as genuine a forged document', txt: 'Whoever fraudulently or dishonestly uses as genuine any document or electronic record which he knows or has reason to believe to be a forged document or electronic record, shall be punished in the same manner as if he had forged such document or electronic record.', kw: ['using forged document', 'fraud', 'IPC 471'] },
    { s: '506', t: 'Punishment for criminal intimidation', txt: 'Whoever commits the offence of criminal intimidation shall be punished with imprisonment of either description for a term which may extend to two years, or with fine, or with both.', kw: ['criminal intimidation', 'punishment', 'IPC 506'] },
  ], false, ['BNS']));

  s.push(...helper('Bharatiya Nagarik Suraksha Sanhita, 2023', 'BNSS', 'IN', 'criminal_procedure', '2024-07-01', [
    { s: '2', t: 'Definitions', txt: 'In this Sanhita, unless the context otherwise requires, "bailable offence" means an offence which is shown as bailable in the First Schedule; "non-bailable offence" means any other offence.', kw: ['BNSS', 'definitions', 'bailable', 'non-bailable'] },
    { s: '35', t: 'Arrest — how made', txt: 'In making an arrest the police officer or other person making the same shall actually touch or confine the body of the person to be arrested, unless there be a submission to the custody by word or action. If such person forcibly resists the endeavour to arrest him, or attempts to evade the arrest, such police officer or other person may use all means necessary to effect the arrest.', kw: ['arrest', 'police', 'force', 'BNSS 35'] },
    { s: '105', t: 'Search warrants', txt: 'A Court may issue a search warrant for the search of any premises within its local jurisdiction if it has reason to believe that anything upon which a charge for any offence has been or could be made is kept or concealed in such place.', kw: ['search warrant', 'Court', 'premises'] },
    { s: '170', t: 'Cases to be sent to Magistrate', txt: 'If, upon an investigation under this Chapter, it appears to the police officer that there is sufficient evidence or reasonable ground, such officer shall forward the accused under custody to a Magistrate empowered to take cognizance of the offence upon a police report and to try the accused or commit for trial.', kw: ['cognizance', 'Magistrate', 'investigation', 'police report'] },
    { s: '173', t: 'Police report on completion of investigation (chargesheet)', txt: 'Every investigation under this Chapter shall be completed without unnecessary delay and the report shall be forwarded to the Magistrate through electronic means. The report shall set forth the names of the parties, the nature of the information, the names of the persons who appear to be acquainted with the circumstances of the case, whether any offence appears to have been committed.', kw: ['chargesheet', 'police report', 'investigation', 'Magistrate', 'BNSS 173'] },
    { s: '187', t: 'Cognizance of offences by Magistrates', txt: 'Every offence shall ordinarily be inquired into and tried by a Court within whose local jurisdiction it was committed. Subject to the provisions of this Chapter, any Magistrate of the first class may take cognizance of any offence upon receiving a complaint of facts which constitute such offence.', kw: ['cognizance', 'Magistrate', 'jurisdiction', 'complaint'] },
    { s: '230', t: 'Framing of charge', txt: 'If, upon such consideration and hearing, the Judge is of opinion that there is ground for presuming that the accused has committed an offence which is exclusively triable by the Court of Session, he shall frame a charge against the accused.', kw: ['charge framing', 'Session Court', 'presumption'] },
    { s: '258', t: 'Acquittal', txt: 'If the Magistrate, upon taking all the evidence referred to in section 254, finds the accused not guilty, the Magistrate shall record an order of acquittal.', kw: ['acquittal', 'Magistrate', 'not guilty'] },
    { s: '436', t: 'Bail in bailable offences', txt: 'When any person other than a person accused of a non-bailable offence is arrested or detained without warrant by a police officer, or appears or is brought before a Court, and is prepared at any time while in the custody of such officer or at any stage of the proceedings before such Court to give bail, such person shall be released on bail.', kw: ['bail', 'bailable offence', 'arrest'] },
    { s: '439', t: 'Special powers of High Court or Court of Session regarding bail', txt: 'When any person accused of or suspected of the commission of any non-bailable offence is arrested or detained without warrant by a police officer, or appears or is brought before a Court other than the High Court or Court of Session, he may be released on bail.', kw: ['bail', 'High Court', 'Session Court', 'non-bailable'] },
    { s: '479', t: 'Limitation for undertrial detention', txt: 'Where a person has, during the period of investigation, inquiry or trial been in detention for a period extending up to one-half of the maximum period of imprisonment specified for that offence, he shall be released on his personal bond with or without sureties.', kw: ['undertrial', 'detention', 'personal bond', 'half period'] },
    { s: '482', t: 'Inherent powers of High Court', txt: 'Nothing in this Sanhita shall be deemed to limit or affect the inherent powers of the High Court to make such orders as may be necessary to give effect to any order under this Sanhita, or to prevent abuse of the process of any Court or otherwise to secure the ends of justice.', kw: ['inherent powers', 'High Court', 'BNSS 482'] },
    { s: '530', t: 'Summary trials', txt: 'All offences not punishable with death, imprisonment for life, or imprisonment for a term exceeding three years, may be tried in a summary way by any Magistrate.', kw: ['summary trial', 'Magistrate'] },
  ]));

  s.push(...helper('Bharatiya Sakshya Adhiniyam, 2023', 'BSA', 'IN', 'evidence_law', '2024-07-01', [
    { s: '2', t: 'Definitions', txt: 'In this Adhiniyam, unless the context otherwise requires, "Court" includes all Judges and Magistrates, and all persons, except arbitrators, legally authorised to take evidence; "fact" means and includes any thing, state of things, or relation of things, capable of being perceived by the senses.', kw: ['BSA', 'definitions', 'court', 'fact'] },
    { s: '39', t: 'Relevancy of statements in documents, electronic records', txt: 'Statements made by a person in any document or electronic record, who is dead or cannot be found, or who has become incapable of giving evidence, or whose attendance cannot be procured without unreasonable delay or expense, are relevant facts.', kw: ['relevancy', 'statements', 'electronic records', 'BSA 39'] },
    { s: '57', t: 'Proof of documents by primary evidence', txt: 'Documents must be proved by primary evidence except in the cases hereinafter mentioned. Primary evidence means the document itself produced for the inspection of the Court.', kw: ['primary evidence', 'document', 'proof'] },
    { s: '63', t: 'Electronic records — admissibility', txt: 'An electronic record shall be admissible in evidence in legal proceedings and shall be treated in the same way as a paper based record, provided there is a certificate under section 63 identifying the electronic record.', kw: ['electronic record', 'admissibility', 'digital evidence', 'BSA 63'] },
    { s: '110', t: 'Burden of proof', txt: 'Whoever desires any Court to give judgment as to any legal right or liability dependent on the existence of facts which he asserts, must prove that those facts exist. When a person is bound to prove the existence of any fact, it is said that the burden of proof lies on that person.', kw: ['burden of proof', 'legal right', 'liability'] },
    { s: '118', t: 'Dying declaration', txt: 'A statement, written or verbal, of relevant facts made by a person who is dead, or who cannot be found, or who has become incapable of giving evidence, or whose attendance cannot be procured without unreasonable delay, is itself a relevant fact when the statement is made by a person as to the cause of his death, or as to any of the circumstances of the transaction which resulted in his death.', kw: ['dying declaration', 'relevant fact', 'death'] },
    { s: '27', t: 'Confession', txt: 'A confession made by an accused person is irrelevant in a criminal proceeding, if the making of the confession appears to the Court to have been caused by any inducement, threat, or promise having reference to the charge against the accused person.', kw: ['confession', 'inducement', 'threat', 'promise', 'accused'] },
    { s: '132', t: 'Estoppel', txt: 'When one person has, by his declaration, act or omission, intentionally caused or permitted another person to believe a thing to be true and to act upon such belief, neither he nor his representative shall be allowed, in any suit or proceeding between himself and such person or his representative, to deny the truth of that thing.', kw: ['estoppel', 'declaration', 'belief'] },
  ]));

  s.push(...helper('Code of Civil Procedure, 1908', 'CPC', 'IN', 'civil_procedure', '1909-01-01', [
    { s: 'S9', t: 'Courts to try all civil suits unless barred', txt: 'The Courts shall (subject to the provisions herein contained) have jurisdiction to try all suits of a civil nature excepting suits of which their cognizance is either expressly or impliedly barred.', kw: ['jurisdiction', 'civil suit', 'CPC Section 9'] },
    { s: 'S11', t: 'Res judicata', txt: 'No Court shall try any suit or issue in which the matter directly and substantially in issue has been directly and substantially in issue in a former suit between the same parties, or between parties under whom they or any of them claim, litigating under the same title, in a Court competent to try such subsequent suit.', kw: ['res judicata', 'estoppel', 'former suit', 'CPC Section 11'] },
    { s: 'S47', t: 'Questions to be determined by the Court executing decree', txt: 'All questions arising between the parties to the suit in which the decree was passed, or their representatives, and relating to the execution, discharge or satisfaction of the decree, shall be determined by the Court executing the decree and not by a separate suit.', kw: ['execution', 'decree', 'determination', 'CPC Section 47'] },
    { s: 'S96', t: 'Appeal from original decree', txt: 'Save where otherwise expressly provided in the body of this Code, an appeal shall lie from every decree passed by any Court exercising original jurisdiction to the Court authorised to hear appeals from the decisions of such Court.', kw: ['appeal', 'original decree', 'CPC Section 96'] },
    { s: 'S100', t: 'Second appeal', txt: 'Save as otherwise expressly provided in the body of this Code or by any other law for the time being in force, an appeal shall lie to the High Court from every decree passed in appeal by any Court subordinate to the High Court, if the High Court is satisfied that the case involves a substantial question of law.', kw: ['second appeal', 'High Court', 'substantial question of law'] },
    { s: 'S114', t: 'Review', txt: 'Subject as aforesaid, any person considering himself aggrieved by a decree or order from which an appeal is allowed, but from which no appeal has been preferred, or by a decree or order from which no appeal is allowed, may apply for a review of judgment to the Court which passed the decree or made the order.', kw: ['review', 'decree', 'order', 'CPC Section 114'] },
    { s: 'S151', t: 'Saving of inherent powers of Court', txt: 'Nothing in this Code shall be deemed to limit or otherwise affect the inherent power of the Court to make such orders as may be necessary for the ends of justice or to prevent abuse of the process of the Court.', kw: ['inherent powers', 'Court', 'justice', 'CPC Section 151'] },
    { s: 'O1R1', t: 'Who may be joined as plaintiffs', txt: 'All persons may be joined in one suit as plaintiffs in whom any right to relief in respect of or arising out of the same act or transaction is alleged to exist, whether jointly, severally, or in the alternative.', kw: ['plaintiff', 'joinder', 'CPC Order 1'] },
    { s: 'O7R1', t: 'Particulars to be contained in plaint', txt: 'The plaint shall contain the following particulars: (a) the name of the Court; (b) the name, description and place of residence of the plaintiff; (c) the name, description and place of residence of the defendant; (d) where the plaintiff or the defendant is a minor or a person of unsound mind; (e) the facts constituting the cause of action; (f) that the suit is within the limitation.', kw: ['plaint', 'particulars', 'cause of action', 'CPC Order 7'] },
    { s: 'O8R1', t: 'Written statement', txt: 'The defendant shall, within thirty days from the date of service of summons, present a written statement of his defence. Where the defendant fails to file within thirty days, he shall be allowed to file on such other day not later than ninety days from the date of service of summons.', kw: ['written statement', 'defence', 'thirty days', 'CPC Order 8'] },
    { s: 'O39R1', t: 'Temporary injunctions', txt: 'Where in any suit it is proved by affidavit or otherwise that any property in dispute is in danger of being wasted, damaged, or alienated by any party to the suit, the Court may by order grant a temporary injunction to restrain such act.', kw: ['temporary injunction', 'property', 'CPC Order 39'] },
    { s: 'O39R2', t: 'Injunction to restrain repetition or continuance of breach', txt: 'In any suit for restraining the defendant from committing a breach of contract or other injury of any kind, the plaintiff may, at any time after the commencement of the suit, apply to the Court for a temporary injunction to restrain the defendant from committing the breach of contract or injury complained of.', kw: ['injunction', 'breach of contract', 'CPC Order 39 Rule 2'] },
  ]));

  s.push(...helper('Constitution of India, 1950', 'CONSTITUTION', 'IN', 'constitutional_law', '1950-01-26', [
    { s: '12', t: 'Definition of State', txt: 'In this Part, unless the context otherwise requires, the State includes the Government and Parliament of India and the Government and the Legislature of each of the States and all local or other authorities within the territory of India or under the control of the Government of India.', kw: ['State', 'definition', 'Article 12'] },
    { s: '13', t: 'Laws inconsistent with fundamental rights', txt: 'All laws in force in the territory of India immediately before the commencement of this Constitution, in so far as they are inconsistent with the provisions of this Part, shall, to the extent of such inconsistency, be void.', kw: ['fundamental rights', 'void laws', 'Article 13'] },
    { s: '14', t: 'Equality before law', txt: 'The State shall not deny to any person equality before the law or the equal protection of the laws within the territory of India.', kw: ['equality', 'equal protection', 'Article 14'] },
    { s: '15', t: 'Prohibition of discrimination', txt: 'The State shall not discriminate against any citizen on grounds only of religion, race, caste, sex, place of birth or any of them. No citizen shall, on grounds only of religion, race, caste, sex, place of birth or any of them, be subject to any disability, liability, restriction or condition.', kw: ['discrimination', 'caste', 'religion', 'sex', 'Article 15'] },
    { s: '16', t: 'Equality of opportunity in public employment', txt: 'There shall be equality of opportunity for all citizens in matters relating to employment or appointment to any office under the State.', kw: ['equality', 'public employment', 'reservation', 'Article 16'] },
    { s: '19', t: 'Protection of certain rights regarding freedom of speech', txt: 'All citizens shall have the right to freedom of speech and expression; to assemble peaceably and without arms; to form associations or unions; to move freely throughout the territory of India; to reside and settle in any part of India; and to practise any profession, or to carry on any occupation, trade or business.', kw: ['freedom of speech', 'expression', 'assembly', 'Article 19'] },
    { s: '20', t: 'Protection in respect of conviction for offences', txt: 'No person shall be convicted of any offence except for violation of the law in force at the time of the commission of the act charged as an offence, nor be subjected to a penalty greater than that which might have been inflicted under the law in force at the time of the commission of the offence.', kw: ['ex post facto', 'double jeopardy', 'self-incrimination', 'Article 20'] },
    { s: '21', t: 'Protection of life and personal liberty', txt: 'No person shall be deprived of his life or personal liberty except according to procedure established by law.', kw: ['life', 'personal liberty', 'procedure established by law', 'Article 21'] },
    { s: '21A', t: 'Right to education', txt: 'The State shall provide free and compulsory education to all children of the age of six to fourteen years in such manner as the State may, by law, determine.', kw: ['right to education', 'children', 'Article 21A'] },
    { s: '22', t: 'Protection against arrest and detention', txt: 'No person who is arrested shall be detained in custody without being informed, as soon as may be, of the grounds for such arrest nor shall he be denied the right to consult, and to be defended by, a legal practitioner of his choice.', kw: ['arrest', 'detention', 'legal practitioner', 'Article 22'] },
    { s: '25', t: 'Freedom of conscience and free profession, practice and propagation of religion', txt: 'Subject to public order, morality and health, all persons are equally entitled to freedom of conscience and the right freely to profess, practise and propagate religion.', kw: ['freedom of religion', 'conscience', 'Article 25'] },
    { s: '32', t: 'Remedies for enforcement of fundamental rights', txt: 'The right to move the Supreme Court by appropriate proceedings for the enforcement of the rights conferred by this Part is guaranteed. The Supreme Court shall have power to issue directions or orders or writs, including writs in the nature of habeas corpus, mandamus, prohibition, quo warranto and certiorari.', kw: ['Supreme Court', 'habeas corpus', 'mandamus', 'writ', 'Article 32'] },
    { s: '44', t: 'Uniform civil code', txt: 'The State shall endeavour to secure for the citizens a uniform civil code throughout the territory of India.', kw: ['uniform civil code', 'directive principles', 'Article 44'] },
    { s: '73', t: 'Extent of executive power of the Union', txt: 'Subject to the provisions of this Constitution, the executive power of the Union shall extend to the matters with respect to which Parliament has power to make laws.', kw: ['executive power', 'Union', 'Article 73'] },
    { s: '123', t: 'Power of President to promulgate Ordinances', txt: 'If at any time, except when both Houses of Parliament are in session, the President is satisfied that circumstances exist which render it necessary for him to take immediate action, he may promulgate such Ordinance as the circumstances appear to him to require.', kw: ['ordinance', 'President', 'Article 123'] },
    { s: '136', t: 'Special leave to appeal by the Supreme Court', txt: 'Notwithstanding anything in this Chapter, the Supreme Court may, in its discretion, grant special leave to appeal from any judgment, decree, determination, sentence or order in any cause or matter passed or made by any court or tribunal in the territory of India.', kw: ['special leave', 'appeal', 'Supreme Court', 'SLP', 'Article 136'] },
    { s: '141', t: 'Law declared by Supreme Court to be binding', txt: 'The law declared by the Supreme Court shall be binding on all courts within the territory of India.', kw: ['binding law', 'Supreme Court', 'precedent', 'Article 141'] },
    { s: '142', t: 'Enforcement of decrees and orders of Supreme Court', txt: 'The Supreme Court in the exercise of its jurisdiction may pass such decree or make such order as is necessary for doing complete justice in any cause or matter pending before it.', kw: ['complete justice', 'Supreme Court', 'Article 142'] },
    { s: '226', t: 'Power of High Courts to issue writs', txt: 'Every High Court shall have power to issue to any person or authority directions, orders or writs, including writs in the nature of habeas corpus, mandamus, prohibition, quo warranto and certiorari, for the enforcement of any of the rights conferred by Part III and for any other purpose.', kw: ['High Court', 'writ jurisdiction', 'Article 226'] },
    { s: '243', t: 'Panchayats', txt: 'In this Part, unless the context otherwise requires, "Panchayat" means an institution (by whatever name called) of self-government constituted under article 243B, for the rural areas.', kw: ['panchayat', 'self-government', 'rural', 'Article 243'] },
    { s: '300A', t: 'Right to property', txt: 'No person shall be deprived of his property save by authority of law.', kw: ['property', 'deprivation', 'Article 300A'] },
    { s: '368', t: 'Power of Parliament to amend the Constitution', txt: 'Notwithstanding anything in this Constitution, Parliament may in exercise of its constituent power amend by way of addition, variation or repeal any provision of this Constitution in accordance with the procedure laid down in this article.', kw: ['amendment', 'Parliament', 'constituent power', 'Article 368'] },
  ]));

  s.push(...helper('Indian Contract Act, 1872', 'ICA', 'IN', 'contract_law', '1872-09-01', [
    { s: '2', t: 'Definitions — promise, agreement, contract', txt: 'When the person to whom the proposal is made signifies his assent thereto, the proposal is said to be accepted. A proposal when accepted becomes a promise. Every promise and every set of promises, forming the consideration for each other, is an agreement. An agreement enforceable by law is a contract.', kw: ['contract', 'promise', 'agreement', 'proposal', 'acceptance'] },
    { s: '10', t: 'What agreements are contracts', txt: 'All agreements are contracts if they are made by the free consent of parties competent to contract, for a lawful consideration and with a lawful object, and are not hereby expressly declared to be void.', kw: ['valid contract', 'free consent', 'competent parties', 'lawful consideration'] },
    { s: '14', t: 'Free consent defined', txt: 'Consent is said to be free when it is not caused by coercion as defined in section 15, or undue influence as defined in section 16, or fraud as defined in section 17, or misrepresentation as defined in section 18, or mistake subject to the provisions of sections 20, 21, and 22.', kw: ['free consent', 'coercion', 'undue influence', 'fraud', 'misrepresentation'] },
    { s: '17', t: 'Fraud defined', txt: 'Fraud means and includes any of the following acts committed by a party to a contract with intent to deceive another party thereto or his agent, or to induce him to enter into the contract: (1) the suggestion as a fact of that which is not true by one who does not believe it to be true; (2) the active concealment of a fact by one having knowledge or belief of the fact.', kw: ['fraud', 'deception', 'concealment', 'contract'] },
    { s: '23', t: 'What considerations and objects are lawful', txt: 'The consideration or object of an agreement is lawful, unless it is forbidden by law; or is of such nature that, if permitted, it would defeat the provisions of any law; or is fraudulent; or involves or implies, injury to the person or property of another; or the Court regards it as immoral, or opposed to public policy.', kw: ['lawful consideration', 'public policy', 'illegal agreement'] },
    { s: '25', t: 'Agreement without consideration', txt: 'An agreement made without consideration is void, unless (1) it is expressed in writing and registered under the law for the time being in force for the registration of documents, and is made on account of natural love and affection between parties standing in a near relation to each other; or (2) it is a promise to compensate, wholly or in part, a person who has already voluntarily done something for the promisor.', kw: ['consideration', 'void agreement', 'natural love', 'affection'] },
    { s: '27', t: 'Agreement in restraint of trade', txt: 'Every agreement by which any one is restrained from exercising a lawful profession, trade or business of any kind, is to that extent void.', kw: ['restraint of trade', 'void agreement', 'Section 27'] },
    { s: '56', t: 'Agreement to do impossible act', txt: 'An agreement to do an act impossible in itself is void. A contract to do an act which, after the contract is made, becomes impossible, or, by reason of some event which the promisor could not prevent, unlawful, becomes void when the act becomes impossible or unlawful.', kw: ['impossibility', 'frustration', 'void contract', 'force majeure'] },
    { s: '73', t: 'Compensation for loss or damage caused by breach', txt: 'When a contract has been broken, the party who suffers by such breach is entitled to receive, as compensation for any loss or damage caused to him thereby, such compensation as naturally arose in the usual course of things from such breach, or which the parties knew, when they made the contract, to be likely to result from the breach of it.', kw: ['damages', 'compensation', 'breach of contract', 'loss'] },
    { s: '74', t: 'Compensation for breach where penalty stipulated', txt: 'When a contract has been broken, if a sum is named in the contract as the amount to be paid in case of such breach, the party complaining of the breach is entitled, whether or not actual damage or loss is proved to have been caused thereby, to receive from the party who has broken the contract reasonable compensation not exceeding the amount so named.', kw: ['penalty clause', 'liquidated damages', 'breach', 'compensation'] },
    { s: '124', t: 'Contract of indemnity defined', txt: 'A contract by which one party promises to save the other from loss caused to him by the conduct of the promisor himself, or by the conduct of any other person, is called a contract of indemnity.', kw: ['indemnity', 'indemnification', 'loss', 'contract'] },
    { s: '126', t: 'Contract of guarantee', txt: 'A contract of guarantee is a contract to perform the promise, or discharge the liability, of a third person in case of his default. The person who gives the guarantee is called the surety; the person in respect of whose default the guarantee is given is called the principal debtor; and the person to whom the guarantee is given is called the creditor.', kw: ['guarantee', 'surety', 'principal debtor', 'creditor'] },
    { s: '148', t: 'Bailment defined', txt: 'A bailment is the delivery of goods by one person to another for some purpose, upon a contract that they shall, when the purpose is accomplished, be returned or otherwise disposed of according to the directions of the person delivering them.', kw: ['bailment', 'delivery', 'goods', 'return'] },
    { s: '172', t: 'Pledge defined', txt: 'The bailment of goods as security for payment of a debt or performance of a promise is called pledge. The bailor is in this case called the pawnor. The bailee is called the pawnee.', kw: ['pledge', 'pawn', 'security', 'debt'] },
    { s: '182', t: 'Agent defined', txt: 'An agent is a person employed to do any act for another, or to represent another in dealings with third persons. The person for whom such act is done, or who is so represented, is called the principal.', kw: ['agent', 'principal', 'representation', 'agency'] },
  ]));

  s.push(...helper('Transfer of Property Act, 1882', 'TPA', 'IN', 'property_law', '1882-07-01', [
    { s: '5', t: 'Transfer of property defined', txt: 'In the following sections "transfer of property" means an act by which a living person conveys property, in present or in future, to one or more other living persons, or to himself or to himself and one or more other living persons; and "to transfer property" is to perform such act.', kw: ['transfer of property', 'conveyance', 'definition'] },
    { s: '6', t: 'What may be transferred', txt: 'Property of any kind may be transferred, except as otherwise provided by this Act or by any other law for the time being in force.', kw: ['transferable property', 'kinds of property'] },
    { s: '17', t: 'Direction for accumulation of income', txt: 'Where the terms of a transfer of property direct that the income arising from the property shall be accumulated either wholly or in part during a period longer than a period of eighteen years from the date of the transfer, such direction shall, save as hereinafter provided, be void to the extent to which the period during which the accumulation is directed exceeds the aforesaid period.', kw: ['accumulation', 'income', 'transfer'] },
    { s: '52', t: 'Transfer of property pending suit relating thereto (Lis Pendens)', txt: 'During the pendency in any Court having authority within the limits of India of any suit or proceeding which is not collusive and in which any right to immoveable property is directly and specifically in question, the property cannot be transferred or otherwise dealt with by any party to the suit or proceeding so as to affect the rights of any other party thereto under any decree or order which may be made therein.', kw: ['lis pendens', 'pending suit', 'immoveable property', 'Section 52'] },
    { s: '53', t: 'Fraudulent transfer', txt: 'Every transfer of immoveable property made with intent to defeat or delay the creditors of the transferor shall be voidable at the option of any creditor so defeated or delayed.', kw: ['fraudulent transfer', 'creditor', 'voidable', 'Section 53'] },
    { s: '54', t: 'Sale defined', txt: 'Sale is a transfer of ownership in exchange for a price paid or promised or part-paid and part-promised. Sale how made — Such transfer, in the case of tangible immoveable property of the value of one hundred rupees and upwards, or in the case of a reversion or other intangible thing, can be made only by a registered instrument.', kw: ['sale', 'transfer of ownership', 'registered instrument', 'Section 54'] },
    { s: '58', t: 'Mortgage defined', txt: 'A mortgage is the transfer of an interest in specific immoveable property for the purpose of securing the payment of money advanced or to be advanced by way of loan, an existing or future debt, or the performance of an engagement which may give rise to a pecuniary liability.', kw: ['mortgage', 'immoveable property', 'security', 'loan', 'Section 58'] },
    { s: '105', t: 'Lease defined', txt: 'A lease of immoveable property is a transfer of a right to enjoy such property, made for a certain time, express or implied, or in perpetuity, in consideration of a price paid or promised, or of money, a share of crops, service or any other thing of value, to be rendered periodically or on specified occasions to the transferor by the transferee, who accepts the transfer on such terms.', kw: ['lease', 'rent', 'immoveable property', 'Section 105'] },
    { s: '122', t: 'Gift defined', txt: 'Gift is the transfer of certain existing moveable or immoveable property made voluntarily and without consideration, by one person, called the donor, to another, called the donee, and accepted by or on behalf of the donee.', kw: ['gift', 'donation', 'without consideration', 'Section 122'] },
  ]));

  s.push(...helper('Negotiable Instruments Act, 1881', 'NIA', 'IN', 'banking_law', '1882-03-01', [
    { s: '4', t: 'Promissory note', txt: 'A "promissory note" is an instrument in writing (not being a bank-note or a currency-note) containing an unconditional undertaking, signed by the maker, to pay a certain sum of money only to, or to the order of, a certain person, or to the bearer of the instrument.', kw: ['promissory note', 'instrument', 'writing', 'NI Act'] },
    { s: '5', t: 'Bill of exchange', txt: 'A "bill of exchange" is an instrument in writing containing an unconditional order, signed by the maker, directing a certain person to pay a certain sum of money only to, or to the order of, a certain person or to the bearer of the instrument.', kw: ['bill of exchange', 'instrument', 'order'] },
    { s: '6', t: 'Cheque', txt: 'A "cheque" is a bill of exchange drawn on a specified banker and not expressed to be payable otherwise than on demand and it includes the electronic image of a truncated cheque and a cheque in the electronic form.', kw: ['cheque', 'bill of exchange', 'banker', 'demand'] },
    { s: '138', t: 'Dishonour of cheque for insufficiency of funds', txt: 'Where any cheque drawn by a person on an account maintained by him with a banker for payment of any amount of money to another person from out of that account for the discharge, in whole or in part, of any debt or other liability, is returned by the bank unpaid, either because of the amount of money standing to the credit of that account is insufficient to honour the cheque or that it exceeds the amount arranged to be paid from that account by an agreement made with that bank, such person shall be deemed to have committed an offence.', kw: ['cheque bounce', 'dishonour', 'insufficiency', 'Section 138', 'NI Act'] },
    { s: '139', t: 'Presumption in favour of holder', txt: 'It shall be presumed, unless the contrary is proved, that the holder of a cheque received the cheque of the nature referred to in section 138 for the discharge, in whole or in part, of any debt or other liability.', kw: ['presumption', 'holder', 'cheque', 'debt', 'Section 139'] },
    { s: '141', t: 'Offences by companies', txt: 'If the person committing an offence under section 138 is a company, every person who, at the time the offence was committed, was in charge of, and was responsible to, the company for the conduct of the business of the company, as well as the company, shall be deemed to be guilty of the offence.', kw: ['company', 'director liability', 'vicarious liability', 'Section 141'] },
    { s: '142', t: 'Cognizance of offences', txt: 'Notwithstanding anything contained in the Code of Criminal Procedure, 1973, no Court shall take cognizance of any offence punishable under section 138 except upon a complaint, in writing, made by the payee or the holder in due course of the cheque.', kw: ['cognizance', 'complaint', 'cheque bounce', 'Section 142'] },
    { s: '143', t: 'Power of Court to try cases summarily', txt: 'Notwithstanding anything contained in the Code of Criminal Procedure, 1973, all offences under this Chapter shall be tried by a Judicial Magistrate of the first class or by a Metropolitan Magistrate and the provisions of sections 262 to 265 of the said Code shall, as far as may be, apply to such trials.', kw: ['summary trial', 'Magistrate', 'Section 143'] },
  ]));

  s.push(...helper('Limitation Act, 1963', 'LA', 'IN', 'civil_procedure', '1963-10-01', [
    { s: '3', t: 'Bar of limitation', txt: 'Subject to the provisions contained in sections 4 to 24 (inclusive), every suit instituted, appeal preferred, and application made after the prescribed period of limitation shall be dismissed, although limitation has not been set up as a defence.', kw: ['limitation', 'bar', 'suit', 'dismissal', 'Section 3'] },
    { s: '5', t: 'Extension of prescribed period in certain cases', txt: 'Any appeal or any application, other than an application under any of the provisions of Order XXI of the Code of Civil Procedure, 1908, may be admitted after the prescribed period if the appellant or the applicant satisfies the court that he had sufficient cause for not preferring the appeal or making the application within such period.', kw: ['condonation of delay', 'sufficient cause', 'extension', 'Section 5'] },
    { s: '9', t: 'Continuous running of time', txt: 'Where once time has begun to run, no subsequent disability or inability to institute a suit or make an application stops it.', kw: ['continuous running', 'limitation period', 'disability'] },
    { s: '12', t: 'Exclusion of time in legal proceedings', txt: 'In computing the period of limitation for any suit, the time during which the plaintiff has been prosecuting with due diligence another civil proceeding, whether in a Court of first instance or of appeal or revision, against the defendant shall be excluded.', kw: ['exclusion of time', 'legal proceedings', 'due diligence'] },
    { s: '14', t: 'Exclusion of time of proceeding bona fide in court without jurisdiction', txt: 'In computing the period of limitation for any suit, the time during which the plaintiff has been prosecuting with due diligence another civil proceeding, whether in a court of first instance or of appeal or revision, against the defendant shall be excluded, where the proceeding relates to the same matter in issue and is prosecuted in good faith in a court which, from defect of jurisdiction or other cause of a like nature, is unable to entertain it.', kw: ['bona fide', 'jurisdiction', 'exclusion', 'Section 14'] },
    { s: 'Art.54', t: 'Suit for specific performance', txt: 'Three years from the date fixed for the performance, or, if no such date is fixed, when the plaintiff has notice that performance is refused.', kw: ['specific performance', 'three years', 'limitation'] },
    { s: 'Art.58', t: 'Suit for declaration and consequential relief', txt: 'Three years from when the right to sue first accrues.', kw: ['declaration', 'three years', 'right to sue'] },
    { s: 'Art.65', t: 'Suit for possession of immoveable property based on title', txt: 'Twelve years from when the possession of the defendant becomes adverse to the plaintiff.', kw: ['possession', 'immoveable property', 'twelve years', 'adverse possession'] },
    { s: 'Art.137', t: 'Any other application', txt: 'Three years from when the right to apply accrues.', kw: ['residuary', 'three years', 'application'] },
  ]));

  s.push(...helper('Arbitration and Conciliation Act, 1996', 'ARBA', 'IN', 'arbitration', '1996-01-25', [
    { s: '7', t: 'Arbitration agreement', txt: 'In this Part, "arbitration agreement" means an agreement by the parties to submit to arbitration all or certain disputes which have arisen or which may arise between them in respect of a defined legal relationship, whether contractual or not. An arbitration agreement may be in the form of an arbitration clause in a contract or in the form of a separate agreement.', kw: ['arbitration agreement', 'clause', 'dispute', 'Section 7'] },
    { s: '8', t: 'Power to refer parties to arbitration where there is an arbitration agreement', txt: 'A judicial authority, before which an action is brought in a matter which is the subject of an arbitration agreement shall, if a party to the arbitration agreement or any person claiming through or under him, so applies not later than the date of submitting his first statement on the substance of the dispute, refer the parties to arbitration unless it finds that prima facie no valid arbitration agreement exists.', kw: ['referral to arbitration', 'judicial authority', 'Section 8'] },
    { s: '9', t: 'Interim measures by Court', txt: 'A party may, before or during arbitral proceedings or at any time after the making of the arbitral award but before it is enforced in accordance with section 36, apply to a Court for interim measures of protection.', kw: ['interim measures', 'Court', 'arbitral proceedings', 'Section 9'] },
    { s: '11', t: 'Appointment of arbitrators', txt: 'A person of any nationality may be an arbitrator, unless otherwise agreed by the parties. The parties are free to agree on a procedure for appointing the arbitrator or arbitrators. Failing any agreement, in an arbitration with three arbitrators, each party shall appoint one arbitrator, and the two appointed arbitrators shall appoint the third arbitrator who shall act as the presiding arbitrator.', kw: ['appointment', 'arbitrator', 'procedure', 'Section 11'] },
    { s: '17', t: 'Interim measures ordered by arbitral tribunal', txt: 'A party may, during the arbitral proceedings, apply to the arbitral tribunal for an order for interim measures of protection as the arbitral tribunal may consider necessary in respect of the subject-matter of the dispute.', kw: ['interim measures', 'arbitral tribunal', 'Section 17'] },
    { s: '34', t: 'Application for setting aside arbitral award', txt: 'Recourse to a Court against an arbitral award may be made only by an application for setting aside such award in accordance with sub-section (2) and sub-section (3). An arbitral award may be set aside by the Court only if the party making the application establishes on the basis of the record of the arbitral tribunal that a party was under some incapacity; or the arbitration agreement is not valid under the law to which the parties have subjected it.', kw: ['setting aside', 'arbitral award', 'Section 34', 'public policy'] },
    { s: '36', t: 'Enforcement of arbitral award', txt: 'Where the time for making an application to set aside the arbitral award under section 34 has expired, then, subject to the provisions of section 34, such award shall be enforced under the Code of Civil Procedure, 1908 in the same manner as if it were a decree of the Court.', kw: ['enforcement', 'arbitral award', 'decree', 'Section 36'] },
    { s: '37', t: 'Appealable orders', txt: 'An appeal shall lie from the following orders (and from no others) to the Court authorised by law to hear appeals from original decrees of the Court passing the order: (a) granting or refusing to grant any measure under section 9; (b) setting aside or refusing to set aside an arbitral award under section 34.', kw: ['appeal', 'arbitration', 'Section 37'] },
  ]));

  s.push(...helper('Consumer Protection Act, 2019', 'CPA', 'IN', 'consumer_law', '2020-07-20', [
    { s: '2(7)', t: 'Consumer defined', txt: '"Consumer" means any person who buys any goods for a consideration which has been paid or promised or partly paid and partly promised, or under any system of deferred payment and includes any user of such goods other than the person who buys such goods for consideration paid or promised or partly paid or partly promised.', kw: ['consumer', 'definition', 'goods', 'services'] },
    { s: '2(42)', t: 'Unfair trade practice', txt: '"Unfair trade practice" means a trade practice which, for the purpose of promoting the sale, use or supply of any goods or for the provision of any service, adopts any unfair method or unfair or deceptive practice including making any statement, whether orally or in writing or by visible representation which falsely represents that the goods are of a particular standard, quality, quantity, grade, composition, style or model.', kw: ['unfair trade practice', 'deceptive practice', 'consumer protection'] },
    { s: '35', t: 'Jurisdiction of District Commission', txt: 'Subject to the other provisions of this Act, the District Commission shall have jurisdiction to entertain complaints where the value of the goods or services paid as consideration, does not exceed one crore rupees.', kw: ['District Commission', 'jurisdiction', 'one crore', 'consumer complaint'] },
    { s: '36', t: 'Manner of filing complaint', txt: 'A complaint, in relation to any goods sold or delivered or agreed to be sold or delivered or any service provided or agreed to be provided, may be filed with a District Commission by the consumer to whom such goods are sold or delivered or agreed to be sold or delivered or such service provided or agreed to be provided.', kw: ['complaint filing', 'consumer complaint', 'District Commission'] },
    { s: '38', t: 'Jurisdiction of State Commission', txt: 'Subject to the other provisions of this Act, the State Commission shall have jurisdiction to entertain complaints where the value of the goods or services paid as consideration exceeds one crore rupees but does not exceed ten crore rupees.', kw: ['State Commission', 'jurisdiction', 'one crore to ten crore'] },
    { s: '47', t: 'Product liability', txt: 'A product liability action may be brought by a complainant against a product manufacturer or a product service provider or a product seller, as the case may be, for any harm caused to him on account of a defective product.', kw: ['product liability', 'manufacturer', 'defective product', 'harm'] },
    { s: '58', t: 'Central Consumer Protection Authority', txt: 'The Central Government shall, by notification, establish a body to be known as the Central Consumer Protection Authority to regulate matters relating to violation of rights of consumers, unfair trade practices and false or misleading advertisements which are prejudicial to the interests of public and consumers.', kw: ['CCPA', 'consumer protection authority', 'regulation'] },
    { s: '83', t: 'Mediation', txt: 'The District Commission, the State Commission or the National Commission, as the case may be, shall, wherever it considers it appropriate, taking into account the nature and circumstances of the dispute, refer a matter for mediation.', kw: ['mediation', 'consumer dispute', 'alternative dispute resolution'] },
  ]));

  s.push(...helper('Companies Act, 2013', 'CA2013', 'IN', 'corporate_law', '2013-04-01', [
    { s: '2(20)', t: 'Company definition', txt: '"Company" means a company incorporated under this Act or under any previous company law.', kw: ['company', 'definition', 'incorporation'] },
    { s: '7', t: 'Incorporation of company', txt: 'For the purpose of forming a company, persons shall file with the Registrar the memorandum and articles of the company duly signed by all the subscribers to the memorandum.', kw: ['incorporation', 'memorandum', 'articles', 'registrar'] },
    { s: '12', t: 'Registered office of company', txt: 'A company shall, on and from the fifteenth day of its incorporation and at all times thereafter, have a registered office capable of receiving and acknowledging all communications and notices as may be addressed to it.', kw: ['registered office', 'company', 'address'] },
    { s: '42', t: 'Offer or invitation for subscription of securities on private placement', txt: 'A company may, subject to the provisions of this section, make an offer or invitation to subscribe to securities through issue of a private placement offer letter.', kw: ['private placement', 'securities', 'subscription'] },
    { s: '100', t: 'Calling of extraordinary general meeting', txt: 'The Board of Directors of a company may call an extraordinary general meeting of the company at any time.', kw: ['extraordinary general meeting', 'EGM', 'Board of Directors'] },
    { s: '129', t: 'Financial statement', txt: 'The financial statements shall give a true and fair view of the state of affairs of the company, comply with the accounting standards notified under section 133 and shall be in the form as may be provided for different classes of companies in Schedule III.', kw: ['financial statement', 'true and fair', 'accounting standards'] },
    { s: '135', t: 'Corporate Social Responsibility', txt: 'Every company having net worth of rupees five hundred crore or more, or turnover of rupees one thousand crore or more or a net profit of rupees five crore or more during the immediately preceding financial year shall constitute a Corporate Social Responsibility Committee of the Board.', kw: ['CSR', 'corporate social responsibility', 'committee'] },
    { s: '166', t: 'Duties of directors', txt: 'A director of a company shall act in accordance with the articles of the company. A director shall act in good faith in order to promote the objects of the company for the benefit of its members as a whole, and in the best interests of the company, its employees, the shareholders, the community and for the protection of environment.', kw: ['director duties', 'fiduciary duty', 'good faith'] },
    { s: '173', t: 'Meetings of Board', txt: 'Every company shall hold the first meeting of the Board of Directors within thirty days of the date of its incorporation. Thereafter, the company shall hold a minimum number of four meetings of its Board of Directors every year in such a manner that not more than one hundred and twenty days shall intervene between two consecutive meetings of the Board.', kw: ['Board meeting', 'frequency', 'quorum'] },
    { s: '185', t: 'Loan to directors', txt: 'No company shall, directly or indirectly, advance any loan, including any loan represented by a book debt, to any of its directors or to any other person in whom the director is interested or give any guarantee or provide any security in connection with any loan taken by him or such other person.', kw: ['loan to directors', 'prohibition', 'guarantee'] },
    { s: '196', t: 'Appointment of managing director, whole-time director', txt: 'No company shall appoint or employ at the same time a managing director and a manager. No company shall appoint or re-appoint any person as its managing director, whole-time director or manager for a term exceeding five years at a time.', kw: ['managing director', 'whole-time director', 'appointment', 'five years'] },
    { s: '241', t: 'Application to Tribunal for relief in cases of oppression', txt: 'Any member of a company who complains that the affairs of the company have been or are being conducted in a manner prejudicial to public interest or in a manner prejudicial or oppressive to him or any other member or members or in a manner prejudicial to the interests of the company, may apply to the Tribunal.', kw: ['oppression', 'mismanagement', 'Tribunal', 'NCLT'] },
    { s: '447', t: 'Punishment for fraud', txt: 'Any person who is found to be guilty of fraud shall be punishable with imprisonment for a term which shall not be less than six months but which may extend to ten years and shall also be liable to fine which shall not be less than the amount involved in the fraud, but which may extend to three times the amount involved in the fraud.', kw: ['fraud', 'punishment', 'imprisonment'] },
  ]));

  s.push(...helper('Insolvency and Bankruptcy Code, 2016', 'IBC', 'IN', 'insolvency_law', '2016-05-28', [
    { s: '5(7)', t: 'Financial creditor', txt: '"Financial creditor" means any person to whom a financial debt is owed and includes a person to whom such debt has been legally assigned or transferred to.', kw: ['financial creditor', 'financial debt', 'definition'] },
    { s: '5(20)', t: 'Operational creditor', txt: '"Operational creditor" means a person to whom an operational debt is owed and includes any person to whom such debt has been legally assigned or transferred to.', kw: ['operational creditor', 'operational debt', 'definition'] },
    { s: '7', t: 'Initiation of CIRP by financial creditor', txt: 'A financial creditor either by itself or jointly with other financial creditors may file an application for initiating corporate insolvency resolution process against a corporate debtor before the Adjudicating Authority when a default has occurred.', kw: ['CIRP', 'financial creditor', 'default', 'NCLT'] },
    { s: '9', t: 'Application by operational creditor', txt: 'After the expiry of ten days from the date of delivery of the notice demanding payment, if the operational creditor does not receive payment from the corporate debtor or notice of the dispute, the operational creditor may file an application before the Adjudicating Authority for initiating a corporate insolvency resolution process.', kw: ['operational creditor', 'CIRP', 'demand notice'] },
    { s: '10', t: 'Initiation of CIRP by corporate debtor', txt: 'Where a corporate debtor has committed a default, a corporate applicant thereof may file an application before the Adjudicating Authority for initiating corporate insolvency resolution process.', kw: ['corporate debtor', 'voluntary CIRP', 'default'] },
    { s: '12', t: 'Time-limit for CIRP', txt: 'The corporate insolvency resolution process shall be completed within a period of one hundred and eighty days from the date of admission of the application. The Adjudicating Authority may extend the period by not exceeding ninety days if instructed by a resolution of sixty-six per cent of voting shares.', kw: ['180 days', 'CIRP timeline', 'extension'] },
    { s: '14', t: 'Moratorium', txt: 'Subject to provisions of sub-sections (2) and (3), on the insolvency commencement date, the Adjudicating Authority shall by order declare moratorium for prohibiting institution of suits or continuation of pending suits or proceedings, transferring, encumbering, alienating or disposing of by the corporate debtor any of its assets, any action to foreclose, recover or enforce any security interest.', kw: ['moratorium', 'insolvency', 'stay of proceedings'] },
    { s: '29A', t: 'Persons not eligible to be resolution applicant', txt: 'A person shall not be eligible to submit a resolution plan if such person is an undischarged insolvent; has been identified as a wilful defaulter; has an account which has been classified as non-performing asset; has been convicted for any offence punishable with imprisonment for two years or more.', kw: ['resolution applicant', 'disqualification', 'wilful defaulter', 'NPA'] },
    { s: '33', t: 'Initiation of liquidation', txt: 'If the Adjudicating Authority does not receive a resolution plan within the period allowed, or rejects the resolution plan for non-compliance, it shall pass an order requiring the corporate debtor to be liquidated.', kw: ['liquidation', 'resolution plan', 'NCLT'] },
    { s: '53', t: 'Distribution of assets — waterfall', txt: 'The proceeds from the sale of the liquidation assets shall be distributed in the following order of priority: (a) insolvency resolution process costs and the liquidation costs; (b) workmen dues for twenty-four months; (c) debts owed to a secured creditor; (d) wages and any unpaid dues owed to employees; (e) financial debts owed to unsecured creditors.', kw: ['waterfall', 'distribution', 'priority', 'liquidation'] },
  ]));

  s.push(...helper('Securities and Exchange Board of India Act, 1992', 'SEBI', 'IN', 'securities_law', '1992-04-30', [
    { s: '11', t: 'Functions of Board', txt: 'It shall be the duty of the Board to protect the interests of investors in securities and to promote the development of, and to regulate the securities market, by such measures as it thinks fit.', kw: ['SEBI', 'investor protection', 'securities market'] },
    { s: '11B', t: 'Power to issue directions', txt: 'Save as otherwise provided in section 11, if after making or causing to be made an enquiry, the Board is satisfied that it is necessary, it may issue such directions as it deems fit to any person or class of persons referred to in section 12, or associated with the securities market.', kw: ['SEBI directions', 'enforcement', 'Section 11B'] },
    { s: '12A', t: 'Prohibition of manipulative devices and insider trading', txt: 'No person shall directly or indirectly use or employ any manipulative or deceptive device or contravention in connection with the issue, purchase or sale of any securities listed or proposed to be listed on a recognised stock exchange.', kw: ['insider trading', 'market manipulation', 'Section 12A'] },
    { s: '15G', t: 'Penalty for insider trading', txt: 'If any insider who deals in securities on the basis of any unpublished price sensitive information shall be liable to a penalty which shall not be less than ten lakh rupees but which may extend to twenty-five crore rupees or three times the amount of profits made out of insider trading, whichever is higher.', kw: ['insider trading penalty', 'UPSI', 'Section 15G'] },
    { s: '15H', t: 'Penalty for non-disclosure of acquisition of shares', txt: 'If any person who is required under this Act or any rules or regulations made thereunder, fails to disclose the aggregate of shareholding in the body corporate before making such acquisition, he shall be liable to a penalty which shall not be less than ten lakh rupees but which may extend to twenty-five crore rupees.', kw: ['disclosure', 'acquisition', 'penalty', 'Section 15H'] },
  ]));

  s.push(...helper('Information Technology Act, 2000', 'ITA', 'IN', 'technology_law', '2000-10-17', [
    { s: '43', t: 'Penalty for damage to computer system', txt: 'If any person without permission of the owner accesses or secures access to a computer, computer system or computer network, he shall be liable to pay damages by way of compensation to the person so affected.', kw: ['cyber crime', 'unauthorized access', 'IT Act 43'] },
    { s: '43A', t: 'Compensation for failure to protect data', txt: 'Where a body corporate, possessing, dealing or handling any sensitive personal data or information in a computer resource which it owns, controls or operates, is negligent in implementing and maintaining reasonable security practices and procedures and thereby causes wrongful loss or wrongful gain to any person, such body corporate shall be liable to pay damages by way of compensation to the person so affected.', kw: ['data protection', 'sensitive personal data', 'negligence', 'IT Act 43A'] },
    { s: '65', t: 'Tampering with computer source documents', txt: 'Whoever knowingly or intentionally conceals, destroys or alters or intentionally or knowingly causes another to conceal, destroy or alter any computer source code used for a computer, computer programme, computer system or computer network, when the computer source code is required to be kept or maintained by law, shall be punishable with imprisonment up to three years, or with fine which may extend up to two lakh rupees, or with both.', kw: ['source code tampering', 'computer programme', 'IT Act 65'] },
    { s: '66', t: 'Computer related offences', txt: 'If any person, dishonestly or fraudulently, does any act referred to in section 43, he shall be punishable with imprisonment for a term which may extend to three years or with fine which may extend to five lakh rupees or with both.', kw: ['cyber crime', 'computer offence', 'IT Act 66'] },
    { s: '66A', t: 'Sending offensive messages (struck down)', txt: 'Any person who sends, by means of a computer resource or a communication device any information that is grossly offensive or has menacing character shall be punishable with imprisonment for a term which may extend to three years and with fine. [Note: Struck down by Supreme Court in Shreya Singhal v. Union of India (2015) 5 SCC 1]', kw: ['offensive messages', 'struck down', 'Shreya Singhal', 'IT Act 66A'] },
    { s: '66C', t: 'Identity theft', txt: 'Whoever, fraudulently or dishonestly make use of the electronic signature, password or any other unique identification feature of any other person, shall be punished with imprisonment of either description for a term which may extend to three years and shall also be liable to fine which may extend to rupees one lakh.', kw: ['identity theft', 'electronic signature', 'IT Act 66C'] },
    { s: '67', t: 'Publishing or transmitting obscene material', txt: 'Whoever publishes or transmits or causes to be published or transmitted in the electronic form, any material which is lascivious or appeals to the prurient interest shall be punished on first conviction with imprisonment for a term which may extend to three years and with fine which may extend to five lakh rupees.', kw: ['obscene material', 'electronic form', 'publishing', 'IT Act 67'] },
    { s: '72', t: 'Breach of confidentiality and privacy', txt: 'Any person who has secured access to any electronic record, book, register, correspondence, information, document or other material without the consent of the person concerned discloses such material to any other person shall be punished with imprisonment for a term which may extend to two years, or with fine which may extend to one lakh rupees, or with both.', kw: ['data privacy', 'breach of confidentiality', 'IT Act 72'] },
    { s: '79', t: 'Exemption from liability of intermediary', txt: 'An intermediary shall not be liable for any third party information, data, or communication link made available or hosted by him. Nothing in this section shall affect the obligations of an intermediary under any other law for the time being in force. An intermediary shall observe due diligence while discharging his duties under this Act.', kw: ['intermediary', 'safe harbour', 'liability exemption', 'IT Act 79'] },
  ]));

  s.push(...helper('Hindu Marriage Act, 1955', 'HMA', 'IN', 'family_law', '1955-05-18', [
    { s: '5', t: 'Conditions for a Hindu marriage', txt: 'A marriage may be solemnized between any two Hindus, if the following conditions are fulfilled: (i) neither party has a spouse living at the time of the marriage; (ii) at the time of the marriage, neither party is incapable of giving a valid consent to it in consequence of unsoundness of mind; (iii) the bridegroom has completed the age of twenty-one years and the bride the age of eighteen years at the time of the marriage.', kw: ['Hindu marriage', 'conditions', 'age', 'consent'] },
    { s: '9', t: 'Restitution of conjugal rights', txt: 'When either the husband or the wife has, without reasonable excuse, withdrawn from the society of the other, the aggrieved party may apply, by petition to the district court, for restitution of conjugal rights.', kw: ['restitution', 'conjugal rights', 'society'] },
    { s: '13', t: 'Divorce', txt: 'Any marriage solemnized, whether before or after the commencement of this Act, may, on a petition presented by either the husband or the wife, be dissolved by a decree of divorce on the ground that the other party has, after the solemnization of the marriage, had voluntary sexual intercourse with any person other than his or her spouse; or has treated the petitioner with cruelty; or has deserted the petitioner for a continuous period of not less than two years.', kw: ['divorce', 'cruelty', 'desertion', 'adultery', 'Section 13'] },
    { s: '13B', t: 'Divorce by mutual consent', txt: 'Subject to the provisions of this Act a petition for dissolution of marriage by a decree of divorce may be presented to the district court by both the parties to a marriage together, whether such marriage was solemnized before or after the commencement of the Marriage Laws (Amendment) Act, 1976, on the ground that they have been living separately for a period of one year or more.', kw: ['mutual consent divorce', 'cooling period', 'Section 13B'] },
    { s: '24', t: 'Maintenance pendente lite and expenses of proceedings', txt: 'Where in any proceeding under this Act it appears to the court that either the wife or the husband, as the case may be, has no independent income sufficient for her or his support and the necessary expenses of the proceeding, it may, on the application of the wife or the husband, order the respondent to pay to the petitioner the expenses of the proceeding, and monthly during the proceeding such sum as, having regard to the petitioner\'s own income and the income of the respondent, it may seem to the court to be reasonable.', kw: ['maintenance', 'pendente lite', 'expenses', 'alimony'] },
    { s: '25', t: 'Permanent alimony and maintenance', txt: 'Any court exercising jurisdiction under this Act may, at the time of passing any decree or at any time subsequent thereto, on application made to it for the purpose by either the wife or the husband, order that the respondent shall pay to the applicant for her or his maintenance and support such gross sum or such monthly or periodical sum for a term not exceeding the life of the applicant as, having regard to the respondent\'s own income and other property, if any, the income and other property of the applicant, the conduct of the parties and other circumstances of the case, it may seem to the court to be just.', kw: ['permanent alimony', 'maintenance', 'Section 25'] },
    { s: '26', t: 'Custody of children', txt: 'In any proceeding under this Act, the court may, from time to time, pass such interim orders and make such provisions in the decree as it may deem just and proper with respect to the custody, maintenance and education of minor children, consistently with their wishes, wherever possible.', kw: ['custody', 'children', 'minor', 'welfare'] },
  ]));

  s.push(...helper('Hindu Succession Act, 1956', 'HSA', 'IN', 'succession_law', '1956-06-17', [
    { s: '4', t: 'Overriding effect of Act', txt: 'Save as otherwise expressly provided in this Act, any text, rule or interpretation of Hindu law or any custom or usage as part of that law in force immediately before the commencement of this Act shall cease to have effect with respect to any matter for which provision is made in this Act.', kw: ['overriding effect', 'Hindu law', 'custom'] },
    { s: '6', t: 'Devolution of interest in coparcenary property', txt: 'On and from the commencement of the Hindu Succession (Amendment) Act, 2005, in a Joint Hindu family governed by the Mitakshara law, the daughter of a coparcener shall, by birth become a coparcener in her own right in the same manner as the son; have the same rights in the coparcenary property as she would have had if she had been a son.', kw: ['coparcenary', 'daughter rights', 'equal rights', 'Mitakshara', 'Section 6'] },
    { s: '8', t: 'General rules of succession — male dying intestate', txt: 'The property of a male Hindu dying intestate shall devolve according to the provisions of this Chapter: firstly, upon the heirs, being the relatives specified in class I of the Schedule; secondly, if there is no heir of class I, then upon the heirs, being the relatives specified in class II; thirdly, upon the agnates of the deceased; and lastly, upon the cognates of the deceased.', kw: ['intestate succession', 'heirs', 'class I', 'class II'] },
    { s: '14', t: 'Property of a female Hindu to be her absolute property', txt: 'Any property possessed by a female Hindu, whether acquired before or after the commencement of this Act, shall be held by her as full owner thereof and not as a limited owner.', kw: ['female Hindu', 'absolute property', 'full owner', 'Section 14'] },
    { s: '15', t: 'General rules of succession — female dying intestate', txt: 'The property of a female Hindu dying intestate shall devolve according to the rules in this section.', kw: ['female intestate', 'succession', 'Section 15'] },
    { s: '30', t: 'Testamentary succession', txt: 'Any Hindu may dispose of by will or other testamentary disposition any property, which is capable of being so disposed of by him, in accordance with the provisions of the Indian Succession Act, 1925.', kw: ['will', 'testamentary', 'Hindu', 'Section 30'] },
  ]));

  s.push(...helper('Right to Information Act, 2005', 'RTI', 'IN', 'administrative_law', '2005-10-12', [
    { s: '3', t: 'Right to information', txt: 'Subject to the provisions of this Act, all citizens shall have the right to information.', kw: ['right to information', 'citizens', 'Section 3'] },
    { s: '4', t: 'Obligations of public authorities', txt: 'Every public authority shall maintain all its records duly catalogued and indexed in a manner and the form which facilitates the right to information under this Act and ensure that all records that are appropriate to be computerised are, within a reasonable time and subject to availability of resources, computerised and connected through a network all over the country on different systems so that access to such records is facilitated.', kw: ['public authority', 'records', 'obligations', 'Section 4'] },
    { s: '6', t: 'Request for obtaining information', txt: 'A person, who desires to obtain any information under this Act, shall make a request in writing or through electronic means in English or Hindi or in the official language of the area in which the application is being made, accompanying such fee as may be prescribed, to the Central Public Information Officer or State Public Information Officer.', kw: ['RTI application', 'request', 'information officer'] },
    { s: '7', t: 'Disposal of request', txt: 'Subject to the proviso to sub-section (2) of section 5 or the proviso to sub-section (3) of section 6, the Central Public Information Officer or State Public Information Officer, as the case may be, on receipt of a request under section 6 shall, as expeditiously as possible, and in any case within thirty days of the receipt of the request, either provide the information on payment of such fee as may be prescribed or reject the request for any of the reasons specified in sections 8 and 9.', kw: ['disposal', 'thirty days', 'RTI response', 'Section 7'] },
    { s: '8', t: 'Exemption from disclosure', txt: 'There shall be no obligation to give any citizen information, disclosure of which would prejudicially affect the sovereignty and integrity of India, the security, strategic, scientific or economic interests of the State, relation with foreign State or lead to incitement of an offence.', kw: ['exemption', 'sovereignty', 'security', 'Section 8'] },
    { s: '19', t: 'Appeal', txt: 'Any person who, does not receive a decision within the time specified, or is aggrieved by a decision of the Central Public Information Officer or State Public Information Officer, may within thirty days from the expiry of such period or from the receipt of such a decision prefer an appeal to such officer who is senior in rank to the Central Public Information Officer or the State Public Information Officer.', kw: ['appeal', 'RTI', 'Information Commission', 'Section 19'] },
  ]));

  s.push(...helper('Real Estate (Regulation and Development) Act, 2016', 'RERA', 'IN', 'real_estate_law', '2017-05-01', [
    { s: '3', t: 'Registration of real estate projects', txt: 'No promoter shall advertise, market, book, sell or offer for sale, or invite persons to purchase in any manner any plot, apartment or building, as the case may be, in any real estate project or part of it, in any planning area, without registering the real estate project with the Real Estate Regulatory Authority.', kw: ['RERA registration', 'real estate project', 'promoter'] },
    { s: '4', t: 'Application for registration', txt: 'Every promoter shall make an application to the Authority for registration of the real estate project in such form, manner, within such time and accompanied by such fee and documents as may be prescribed.', kw: ['application', 'registration', 'promoter', 'Authority'] },
    { s: '11', t: 'Functions and duties of promoter', txt: 'The promoter shall be responsible to obtain the completion certificate or the occupancy certificate, or both, as applicable, from the competent authority as per local laws or other laws for the time being in force and to make it available to the allottees individually or to the association of allottees.', kw: ['promoter duties', 'completion certificate', 'occupancy certificate'] },
    { s: '14', t: 'Adherence to sanctioned plans and project specifications', txt: 'The proposed project shall be developed and completed by the promoter in accordance with the sanctioned plans, layout plans and specifications as approved by the competent authorities.', kw: ['sanctioned plans', 'specifications', 'development'] },
    { s: '18', t: 'Return of amount and compensation', txt: 'If the promoter fails to complete or is unable to give possession of an apartment, plot or building, he shall be liable on demand to the allottees, to return the amount received by him in respect of that apartment, plot, building with interest at such rate as may be prescribed.', kw: ['refund', 'compensation', 'delayed possession', 'interest'] },
    { s: '31', t: 'Filing of complaints with Authority', txt: 'Any aggrieved person may file a complaint with the Authority or the adjudicating officer, as the case may be, for any violation or contravention of the provisions of this Act or the rules and regulations made thereunder against any promoter, allottee or real estate agent.', kw: ['complaint', 'RERA Authority', 'violation'] },
  ]));

  s.push(...helper('Protection of Children from Sexual Offences Act, 2012', 'POCSO', 'IN', 'criminal_law', '2012-11-14', [
    { s: '3', t: 'Penetrative sexual assault', txt: 'A person is said to commit penetrative sexual assault if he commits penetrative sexual assault on a child, and whoever commits penetrative sexual assault shall be punished with imprisonment of either description for a term which shall not be less than seven years but which may extend to imprisonment for life, and shall also be liable to fine.', kw: ['penetrative sexual assault', 'child', 'POCSO'] },
    { s: '4', t: 'Punishment for penetrative sexual assault', txt: 'Whoever commits penetrative sexual assault shall be punished with imprisonment of either description for a term which shall not be less than ten years but which may extend to imprisonment for life, and shall also be liable to fine.', kw: ['punishment', 'penetrative sexual assault', 'child', 'ten years'] },
    { s: '7', t: 'Sexual assault', txt: 'Whoever, with sexual intent touches the vagina, penis, anus or breast of the child or makes the child touch the vagina, penis, anus or breast of such person or any other person, or does any other act with sexual intent which involves physical contact without penetration is said to commit sexual assault.', kw: ['sexual assault', 'child', 'physical contact', 'POCSO 7'] },
    { s: '11', t: 'Sexual harassment', txt: 'A person is said to commit sexual harassment upon a child when such person with sexual intent utters any word or makes any sound, or makes any gesture or exhibits any object or part of body with the intention that such word or sound shall be heard, or such gesture or object or part of body shall be seen by the child.', kw: ['sexual harassment', 'child', 'POCSO 11'] },
    { s: '19', t: 'Reporting of offences', txt: 'Any person (including the child), who has apprehension that an offence under this Act is likely to be committed or has knowledge that such an offence has been committed, shall provide such information to the Special Juvenile Police Unit or the local police.', kw: ['mandatory reporting', 'child abuse', 'police', 'POCSO 19'] },
    { s: '29', t: 'Presumption as to certain offences', txt: 'Where a person is prosecuted for committing or abetting or attempting to commit any offence under sections 3, 5, 7 and section 9 of this Act, the Special Court shall presume, that such person has committed or abetted or attempted to commit the offence, as the case may be unless the contrary is proved.', kw: ['presumption', 'reverse burden', 'POCSO 29'] },
    { s: '35', t: 'Child-friendly procedures', txt: 'The Special Court shall ensure that the child is not called repeatedly to testify in the court and the Special Court shall create a child-friendly atmosphere by allowing a family member, a guardian, a friend or a relative, in whom the child has trust or confidence, to be present in the court.', kw: ['child-friendly', 'Special Court', 'testimony', 'POCSO 35'] },
  ]));

  s.push(...helper('Narcotic Drugs and Psychotropic Substances Act, 1985', 'NDPS', 'IN', 'criminal_law', '1985-11-14', [
    { s: '8', t: 'Prohibition of certain operations', txt: 'No person shall cultivate any coca plant or gather any portion of coca plant; or cultivate the opium poppy or any cannabis plant; or produce, manufacture, possess, sell, purchase, transport, warehouse, use, consume, import inter-State, export inter-State, import into India, export from India or tranship any narcotic drug or psychotropic substance, except for medical or scientific purposes.', kw: ['prohibition', 'narcotic drugs', 'psychotropic substances', 'NDPS 8'] },
    { s: '20', t: 'Punishment for contravention in relation to cannabis plant and cannabis', txt: 'Whoever, in contravention of any provision of this Act or any rule or order made or condition of licence granted thereunder, produces, manufactures, possesses, sells, purchases, transports, imports inter-State, exports inter-State or uses cannabis, shall be punishable.', kw: ['cannabis', 'punishment', 'possession', 'NDPS 20'] },
    { s: '21', t: 'Punishment for contravention in relation to manufactured drugs and preparations', txt: 'Whoever, in contravention of any provision of this Act, manufactures, possesses, sells, purchases, transports, imports inter-State, exports inter-State or uses any manufactured drug or any preparation containing any manufactured drug shall be punishable.', kw: ['manufactured drugs', 'punishment', 'NDPS 21'] },
    { s: '27', t: 'Punishment for consumption of any narcotic drug or psychotropic substance', txt: 'Whoever consumes any narcotic drug or psychotropic substance shall be punishable with rigorous imprisonment for a term which may extend to one year, or with fine which may extend to twenty thousand rupees; or with both.', kw: ['consumption', 'narcotic drug', 'punishment', 'NDPS 27'] },
    { s: '37', t: 'Offences to be cognizable and non-bailable', txt: 'Notwithstanding anything contained in the Code of Criminal Procedure, 1973, every offence punishable under this Act shall be cognizable; no person accused of an offence punishable for a term of imprisonment of five years or more under this Act shall be released on bail or on his own bond unless the Public Prosecutor has been given an opportunity to oppose the application for such release.', kw: ['cognizable', 'non-bailable', 'bail restriction', 'NDPS 37'] },
  ]));

  s.push(...helper('Prevention of Corruption Act, 1988', 'PCA', 'IN', 'criminal_law', '1988-09-09', [
    { s: '7', t: 'Offence relating to public servant being bribed', txt: 'Any public servant who obtains or accepts or attempts to obtain, from any person, an undue advantage, with the intention to perform or cause performance of public duty improperly or dishonestly or to forbear or cause forbearance to perform such duty either by himself or by another public servant, shall be punishable with imprisonment for a term which shall not be less than three years but which may extend to seven years and shall also be liable to fine.', kw: ['bribery', 'public servant', 'undue advantage', 'PCA 7'] },
    { s: '8', t: 'Offence relating to bribing a public servant', txt: 'Any person who gives or promises to give an undue advantage to another person or persons, with intention to induce a public servant to perform improperly a public duty or to reward such public servant for the improper performance of public duty, shall be punishable with imprisonment for a term which may extend to seven years or with fine or with both.', kw: ['bribing public servant', 'giving bribe', 'PCA 8'] },
    { s: '13', t: 'Criminal misconduct by a public servant', txt: 'A public servant is said to commit the offence of criminal misconduct if he dishonestly or fraudulently misappropriates or otherwise converts for his own use any property entrusted to him or any property under his control as a public servant or allows any other person so to do; or he intentionally enriches himself illicitly during the period of his office.', kw: ['criminal misconduct', 'misappropriation', 'illicit enrichment', 'PCA 13'] },
    { s: '17', t: 'Persons authorised to investigate', txt: 'No police officer below the rank of an Inspector of Police shall investigate any offence punishable under this Act without the order of a Metropolitan Magistrate or a Magistrate of the first class.', kw: ['investigation', 'Inspector', 'Magistrate order', 'PCA 17'] },
    { s: '19', t: 'Previous sanction necessary for prosecution', txt: 'No Court shall take cognizance of an offence punishable under sections 7 and 11 and under sub-section (1) and (2) of section 13 and section 15 alleged to have been committed by a public servant, except with the previous sanction of the authority competent to remove him from his office.', kw: ['sanction for prosecution', 'competent authority', 'PCA 19'] },
  ]));

  s.push(...helper('Motor Vehicles Act, 1988', 'MVA', 'IN', 'transport_law', '1989-07-01', [
    { s: '3', t: 'Necessity for driving licence', txt: 'No person shall drive a motor vehicle in any public place unless he holds an effective driving licence issued to him authorising him to drive the vehicle; and no person shall so drive a transport vehicle other than a motor cab or motor cycle hired for his own use or rented under any scheme made under sub-section (2) of section 75 unless his driving licence specifically entitles him to do so.', kw: ['driving licence', 'motor vehicle', 'public place', 'MVA 3'] },
    { s: '140', t: 'Liability to pay compensation in certain cases on the principle of no fault', txt: 'Where death or permanent disablement of any person has resulted from an accident arising out of the use of a motor vehicle or motor vehicles, the owner of the motor vehicle shall, or, as the case may be, the owners of the motor vehicles shall, jointly and severally, be liable to pay compensation in respect of such death or disablement in accordance with the provisions of this section.', kw: ['no fault liability', 'compensation', 'accident', 'MVA 140'] },
    { s: '163A', t: 'Special provisions as to payment of compensation on structured formula basis', txt: 'Notwithstanding anything contained in this Act or in any other law for the time being in force or instrument having the force of law, the owner of the motor vehicle or the authorised insurer shall be liable to pay in the case of death or permanent disablement due to accident arising out of the use of motor vehicle, compensation, as indicated in the Second Schedule, to the legal heirs or the victim, as the case may be.', kw: ['structured formula', 'compensation', 'Second Schedule', 'MVA 163A'] },
    { s: '166', t: 'Application for compensation', txt: 'An application for compensation arising out of an accident of the nature specified in sub-section (1) of section 165 may be made to the Claims Tribunal having jurisdiction over the area in which the accident occurred.', kw: ['compensation application', 'Claims Tribunal', 'accident', 'MVA 166'] },
    { s: '184', t: 'Driving dangerously', txt: 'Whoever drives a motor vehicle at a speed or in a manner which is dangerous to the public, having regard to all the circumstances of the case including the nature, condition and use of the place and the amount of traffic which at the time is or which might reasonably be expected to be in the place, shall be punishable with imprisonment for a term which may extend to six months, or with fine which may extend to one thousand rupees, or with both.', kw: ['dangerous driving', 'speed', 'punishment', 'MVA 184'] },
    { s: '199A', t: 'Offences by juveniles', txt: 'Where an offence under this Act has been committed by a juvenile, the guardian of such juvenile or the owner of the motor vehicle shall be deemed to be guilty of the contravention and shall be liable to be proceeded against and punished accordingly and the licence of the juvenile to be cancelled.', kw: ['juvenile offence', 'guardian liability', 'licence cancellation', 'MVA 199A'] },
  ]));

  s.push(...helper('Digital Personal Data Protection Act, 2023', 'DPDPA', 'IN', 'data_protection', '2023-08-11', [
    { s: '4', t: 'Applicability', txt: 'This Act shall apply to the processing of digital personal data within the territory of India where the personal data is collected in digital form or in non-digital form and digitised subsequently; and to processing of digital personal data outside the territory of India, if such processing is in connection with any activity related to offering of goods or services to Data Principals within the territory of India.', kw: ['applicability', 'digital personal data', 'India', 'DPDPA 4'] },
    { s: '5', t: 'Obligation to comply', txt: 'Every person who processes personal data of a Data Principal shall comply with the provisions of this Act and the rules made thereunder.', kw: ['obligation', 'compliance', 'data processing', 'DPDPA 5'] },
    { s: '6', t: 'Consent', txt: 'The consent given by the Data Principal shall be free, specific, informed, unconditional and unambiguous with a clear affirmative action, and shall signify an agreement to the processing of her personal data for the specified purpose and limited to such personal data as is necessary for such specified purpose.', kw: ['consent', 'free', 'specific', 'informed', 'DPDPA 6'] },
    { s: '8', t: 'Rights of Data Principal', txt: 'Every Data Principal shall have the right to obtain from the Data Fiduciary a summary of her personal data and the processing activities undertaken by the Data Fiduciary with respect to such personal data; the right to correction and erasure of personal data; and the right of grievance redressal.', kw: ['data principal rights', 'access', 'correction', 'erasure', 'DPDPA 8'] },
    { s: '11', t: 'Obligations of Data Fiduciary', txt: 'A Data Fiduciary shall make reasonable efforts to ensure the completeness, accuracy, and consistency of personal data; implement appropriate technical and organisational measures to comply with the provisions of this Act; and protect personal data in its possession or under its control.', kw: ['data fiduciary', 'obligations', 'security measures', 'DPDPA 11'] },
    { s: '17', t: 'Significant Data Fiduciary', txt: 'The Central Government may, having regard to the volume and sensitivity of personal data processed, the risk to the rights of Data Principal, the potential impact on the sovereignty and integrity of India, the risk to electoral democracy, security of the State, and public order, notify any Data Fiduciary or class of Data Fiduciaries as Significant Data Fiduciary.', kw: ['significant data fiduciary', 'notification', 'Central Government', 'DPDPA 17'] },
    { s: '33', t: 'Penalties', txt: 'Any person who contravenes the provisions of this Act shall be liable to a penalty which may extend to two hundred and fifty crore rupees.', kw: ['penalty', '250 crore', 'contravention', 'DPDPA 33'] },
  ]));

  s.push(...helper('Goods and Services Tax Act (CGST), 2017', 'GST', 'IN', 'tax_law', '2017-07-01', [
    { s: '7', t: 'Scope of supply', txt: 'The expression "supply" includes all forms of supply of goods or services or both such as sale, transfer, barter, exchange, licence, rental, lease or disposal made or agreed to be made for a consideration by a person in the course or furtherance of business.', kw: ['supply', 'goods', 'services', 'GST', 'Section 7'] },
    { s: '9', t: 'Levy and collection', txt: 'Subject to the provisions of sub-section (2), there shall be levied a tax called the central goods and services tax on all intra-State supplies of goods or services or both at such rates, not exceeding twenty per cent., as may be notified by the Government on the recommendations of the Council.', kw: ['CGST', 'levy', 'intra-State', 'tax rate', 'twenty percent'] },
    { s: '16', t: 'Eligibility and conditions for taking input tax credit', txt: 'Every registered person shall, subject to such conditions and restrictions as may be prescribed and within the time and manner of claim therefor, as may be prescribed, be entitled to take credit of input tax charged on any supply of goods or services or both to him which are used or intended to be used in the course or furtherance of his business.', kw: ['input tax credit', 'ITC', 'registered person', 'Section 16'] },
    { s: '22', t: 'Persons liable for registration', txt: 'Every supplier shall be liable to be registered under this Act in the State or Union territory from where he makes a taxable supply of goods or services or both, if his aggregate turnover in a financial year exceeds twenty lakh rupees.', kw: ['registration', 'twenty lakh', 'aggregate turnover', 'Section 22'] },
    { s: '31', t: 'Tax invoice', txt: 'A registered person supplying taxable goods shall, before or at the time of removal of goods for supply to the recipient or delivery of goods or making available thereof to the recipient, issue a tax invoice showing the description, quantity and value of goods, the tax charged thereon and such other particulars as may be prescribed.', kw: ['tax invoice', 'supply', 'GST invoice', 'Section 31'] },
    { s: '37', t: 'Furnishing details of outward supplies (GSTR-1)', txt: 'Every registered person, other than an Input Service Distributor, a non-resident taxable person and a person paying tax under section 10 or section 51 or section 52 shall furnish, electronically, in such form and manner as may be prescribed, the details of outward supplies of goods or services or both effected during a tax period on or before the tenth day of the month succeeding the said tax period.', kw: ['GSTR-1', 'outward supplies', 'return filing', 'Section 37'] },
    { s: '39', t: 'Furnishing of returns (GSTR-3B)', txt: 'Every registered person, other than an Input Service Distributor or a non-resident taxable person or a person paying tax under section 10 or section 51 or section 52, shall furnish a return for every tax period, electronically, in such form and manner and within such time as may be prescribed.', kw: ['GSTR-3B', 'return', 'tax period', 'Section 39'] },
    { s: '67', t: 'Power of inspection, search and seizure', txt: 'Where the proper officer, not below the rank of Joint Commissioner, has reasons to believe that a taxable person has suppressed any transaction relating to supply of goods or services or both or the stock of goods in hand, or has claimed input tax credit in excess of his entitlement, or has indulged in contravention of any of the provisions of this Act or the rules made thereunder to evade tax under this Act, he may authorise in writing any other officer of central tax to inspect any place of business.', kw: ['inspection', 'search', 'seizure', 'tax evasion', 'Section 67'] },
    { s: '73', t: 'Determination of tax not paid or short paid or erroneously refunded', txt: 'Where it appears to the proper officer that any tax has not been paid or short paid or erroneously refunded, or where input tax credit has been wrongly availed or utilised for any reason, other than the reason of fraud or any wilful misstatement or suppression of facts to evade tax, he shall serve notice on the person chargeable with tax.', kw: ['tax determination', 'notice', 'short payment', 'Section 73'] },
  ]));

  s.push(...helper('Foreign Exchange Management Act, 1999', 'FEMA', 'IN', 'foreign_exchange_law', '2000-06-01', [
    { s: '3', t: 'Dealing in foreign exchange', txt: 'Save as otherwise provided in this Act, rules or regulations made thereunder, no person shall deal in or transfer any foreign exchange or foreign security to any person not being an authorised person; make any payment to or for the credit of any person resident outside India in any manner; or receive otherwise than through an authorised person, any payment by order or on behalf of any person resident outside India.', kw: ['foreign exchange', 'dealing', 'authorised person', 'FEMA 3'] },
    { s: '4', t: 'Holding of foreign exchange', txt: 'Save as otherwise provided in this Act, no person resident in India shall acquire, hold, own, possess or transfer any foreign exchange, foreign security or any immovable property situated outside India.', kw: ['holding', 'foreign exchange', 'foreign security', 'FEMA 4'] },
    { s: '5', t: 'Current account transactions', txt: 'Any person may sell or draw foreign exchange to or from an authorised person if such sale or drawal is a current account transaction. The Central Government may, in public interest and in consultation with the Reserve Bank, impose such reasonable restrictions for current account transactions as may be prescribed.', kw: ['current account', 'foreign exchange', 'RBI', 'FEMA 5'] },
    { s: '6', t: 'Capital account transactions', txt: 'Subject to the provisions of sub-section (2), any person may sell or draw foreign exchange to or from an authorised person for a capital account transaction. The Reserve Bank may, in consultation with the Central Government, specify any class or classes of capital account transactions which are permissible.', kw: ['capital account', 'FDI', 'ECB', 'FEMA 6'] },
    { s: '13', t: 'Penalties', txt: 'If any person contravenes any provision of this Act, or contravenes any rule, regulation, notification, direction or order issued in exercise of the powers under this Act, or contravenes any condition subject to which an authorisation is issued by the Reserve Bank, he shall, upon adjudication, be liable to a penalty up to thrice the sum involved in such contravention where such amount is quantifiable, or up to two lakh rupees where the amount is not quantifiable, and where such contravention is a continuing one, further penalty which may extend to five thousand rupees for every day after the first day during which the contravention continues.', kw: ['penalty', 'contravention', 'FEMA 13'] },
  ]));

  s.push(...helper('Protection of Women from Domestic Violence Act, 2005', 'DV', 'IN', 'family_law', '2006-10-26', [
    { s: '3', t: 'Definition of domestic violence', txt: 'For the purposes of this Act, any act, omission or commission or conduct of the respondent shall constitute domestic violence in case it: (a) harms or injures or endangers the health, safety, life, limb or well-being, whether mental or physical, of the aggrieved person or tends to do so and includes causing physical abuse, sexual abuse, verbal and emotional abuse and economic abuse; or (b) harasses, harms, injures or endangers the aggrieved person with a view to coerce her or any other person related to her to meet any unlawful demand for any dowry or other property or valuable security.', kw: ['domestic violence', 'definition', 'physical abuse', 'economic abuse'] },
    { s: '12', t: 'Application to Magistrate', txt: 'An aggrieved person or a Protection Officer or any other person on behalf of the aggrieved person may present an application to the Magistrate seeking one or more reliefs under this Act.', kw: ['application', 'Magistrate', 'aggrieved person', 'DV 12'] },
    { s: '17', t: 'Right to reside in a shared household', txt: 'Notwithstanding anything contained in any other law for the time being in force, every woman in a domestic relationship shall have the right to reside in the shared household, whether or not she has any right, title or beneficial interest in the same.', kw: ['right to reside', 'shared household', 'DV 17'] },
    { s: '18', t: 'Protection orders', txt: 'The Magistrate may, after giving the aggrieved person and the respondent an opportunity of being heard and on being prima facie satisfied that domestic violence has taken place or is likely to take place, pass a protection order in favour of the aggrieved person.', kw: ['protection order', 'Magistrate', 'DV 18'] },
    { s: '20', t: 'Monetary reliefs', txt: 'While disposing of an application under sub-section (1) of section 12, the Magistrate may direct the respondent to pay monetary relief to meet the expenses incurred and the losses suffered by the aggrieved person and any child of the aggrieved person as a result of the domestic violence.', kw: ['monetary relief', 'maintenance', 'expenses', 'DV 20'] },
  ]));

  s.push(...helper('Specific Relief Act, 1963', 'SRA', 'IN', 'civil_law', '1963-03-01', [
    { s: '10', t: 'Cases in which specific performance enforceable', txt: 'The specific performance of a contract shall be enforced by the court subject to the provisions contained in sub-section (2) of section 11 and section 14 and section 16.', kw: ['specific performance', 'enforcement', 'contract', 'SRA 10'] },
    { s: '12', t: 'Specific performance of part of contract', txt: 'The court may direct specific performance of a part of a contract when the part which must be left unperformed bears only a small proportion to the whole in value and admits of compensation in money.', kw: ['partial performance', 'contract', 'compensation'] },
    { s: '14', t: 'Contracts not specifically enforceable', txt: 'The following contracts cannot be specifically enforced: (a) where a party to the contract has obtained substituted performance of contract; (b) a contract, the performance of which involves the performance of a continuous duty which the court cannot supervise; (c) a contract which is so dependent on the personal qualifications of the parties that the court cannot enforce specific performance of its material terms.', kw: ['non-enforceable', 'personal service', 'continuous duty'] },
    { s: '34', t: 'Discretion of court as to declaration of status or right', txt: 'Any person entitled to any legal character, or to any right as to any property, may institute a suit against any person denying, or interested to deny, his title to such character or right, and the court may in its discretion make therein a declaration that he is so entitled.', kw: ['declaratory suit', 'legal character', 'right', 'SRA 34'] },
    { s: '38', t: 'Perpetual injunction when granted', txt: 'The perpetual injunction may only be granted by the decree made at the hearing and upon the merits of the suit; the defendant is thereby perpetually enjoined from the assertion of a right, or from the commission of an act, which would be contrary to the rights of the plaintiff.', kw: ['perpetual injunction', 'decree', 'rights'] },
    { s: '39', t: 'Mandatory injunctions', txt: 'When, to prevent the breach of an obligation, it is necessary to compel the performance of certain acts which the court is capable of enforcing, the court may in its discretion grant an injunction to prevent the breach complained of, and also to compel performance of the requisite acts.', kw: ['mandatory injunction', 'performance', 'breach'] },
  ]));

  s.push(...helper('Indian Evidence Act, 1872', 'IEA', 'IN', 'evidence_law', '1872-09-01', [
    { s: '3', t: 'Interpretation clause', txt: '"Court" includes all Judges and Magistrates, and all persons, except arbitrators, legally authorised to take evidence. "Fact" means and includes: any thing, state of things, or relation of things, capable of being perceived by the senses; any mental condition of which any person is conscious.', kw: ['interpretation', 'court', 'fact', 'evidence'] },
    { s: '24', t: 'Confession caused by inducement, threat or promise', txt: 'A confession made by an accused person is irrelevant in a criminal proceeding, if the making of the confession appears to the Court to have been caused by any inducement, threat or promise, having reference to the charge against the accused person, proceeding from a person in authority.', kw: ['confession', 'inducement', 'threat', 'IEA 24'] },
    { s: '32', t: 'Cases in which statement of relevant fact by person who is dead or cannot be found', txt: 'Statements, written or verbal, of relevant facts made by a person who is dead, or who cannot be found, or who has become incapable of giving evidence, or whose attendance cannot be procured without an amount of delay or expense, are themselves relevant facts when the statement is made by a person as to the cause of his death, or as to any of the circumstances of the transaction which resulted in his death.', kw: ['dying declaration', 'dead person', 'relevant fact', 'IEA 32'] },
    { s: '45', t: 'Opinions of experts', txt: 'When the Court has to form an opinion upon a point of foreign law, or of science or art, or as to identity of handwriting or finger impressions, the opinions upon that point of persons specially skilled in such foreign law, science or art, or in questions as to identity of handwriting or finger impressions, are relevant facts.', kw: ['expert opinion', 'science', 'handwriting', 'IEA 45'] },
    { s: '65B', t: 'Admissibility of electronic records', txt: 'Any information contained in an electronic record which is printed on a paper, stored, recorded or copied in optical or magnetic media produced by a computer shall be deemed to be also a document, if the conditions mentioned in this section are satisfied in relation to the information and computer in question and shall be admissible in any proceedings, without further proof or production of the original.', kw: ['electronic records', 'admissibility', 'computer', 'certificate', 'IEA 65B'] },
    { s: '101', t: 'Burden of proof', txt: 'Whoever desires any Court to give judgment as to any legal right or liability dependent on the existence of facts which he asserts must prove that those facts exist.', kw: ['burden of proof', 'legal right', 'liability', 'IEA 101'] },
    { s: '114', t: 'Court may presume existence of certain facts', txt: 'The Court may presume the existence of any fact which it thinks likely to have happened, regard being had to the common course of natural events, human conduct and public and private business, in their relation to the facts of the particular case.', kw: ['presumption', 'court', 'facts', 'IEA 114'] },
  ], false, ['BSA']));

  return s;
}

function getUKStatutes(): StatuteSection[] {
  return helper('UK GDPR', 'UK-GDPR', 'UK', 'data_protection', '2018-01-01', [
    { s: 'Art.5', t: 'Principles relating to processing of personal data', txt: 'Personal data shall be processed lawfully, fairly and in a transparent manner in relation to the data subject; collected for specified, explicit and legitimate purposes.', kw: ['GDPR', 'data protection', 'personal data', 'lawfulness'] },
    { s: 'Art.17', t: 'Right to erasure', txt: 'The data subject shall have the right to obtain from the controller the erasure of personal data concerning him or her without undue delay.', kw: ['right to erasure', 'right to be forgotten', 'GDPR Art 17'] },
  ]).concat(helper('Companies Act 2006', 'CA2006-UK', 'UK', 'corporate_law', '2006-11-08', [
    { s: '172', t: 'Duty to promote success of company', txt: 'A director must act in the way he considers, in good faith, would be most likely to promote the success of the company for the benefit of its members as a whole.', kw: ['director duty', 'company success', 'fiduciary'] },
  ])).concat(helper('Employment Rights Act 1996', 'ERA1996', 'UK', 'employment_law', '1996-08-22', [
    { s: '94', t: 'Right not to be unfairly dismissed', txt: 'An employee has the right not to be unfairly dismissed by his employer.', kw: ['unfair dismissal', 'employment', 'employee rights'] },
  ])).concat(helper('Arbitration Act 1996', 'AA1996', 'UK', 'arbitration', '1997-01-31', [
    { s: '1', t: 'General principles', txt: 'The object of arbitration is to obtain the fair resolution of disputes by an impartial tribunal without unnecessary delay or expense; the parties should be free to agree how their disputes are resolved.', kw: ['arbitration', 'dispute resolution', 'tribunal'] },
  ])).concat(helper('Financial Services and Markets Act 2000', 'FSMA2000', 'UK', 'financial_law', '2000-06-14', [
    { s: '23', t: 'Contravention of the general prohibition', txt: 'A person who contravenes the general prohibition is guilty of an offence and liable on conviction to imprisonment for a term not exceeding two years or a fine, or both.', kw: ['financial services', 'general prohibition', 'offence'] },
  ]));
}

function getEUStatutes(): StatuteSection[] {
  return helper('EU General Data Protection Regulation', 'GDPR-EU', 'EU', 'data_protection', '2018-05-25', [
    { s: 'Art.6', t: 'Lawfulness of processing', txt: 'Processing shall be lawful only if and to the extent that at least one of the following applies: the data subject has given consent; processing is necessary for the performance of a contract.', kw: ['GDPR', 'lawful processing', 'consent'] },
  ]).concat(helper('EU AI Act 2024', 'EU-AI-ACT', 'EU', 'technology_law', '2024-08-01', [
    { s: 'Art.6', t: 'Classification rules for high-risk AI systems', txt: 'An AI system shall be considered to be high-risk if it is intended to be used as a safety component of a product, or the AI system is itself a product.', kw: ['EU AI Act', 'high-risk AI', 'compliance'] },
    { s: 'Art.9', t: 'Risk management system', txt: 'A risk management system shall be established, implemented, documented and maintained in relation to high-risk AI systems.', kw: ['risk management', 'AI lifecycle', 'EU AI Act'] },
  ])).concat(helper('Digital Services Act 2022', 'DSA-EU', 'EU', 'technology_law', '2024-02-17', [
    { s: 'Art.16', t: 'Notice and action mechanisms', txt: 'Providers of hosting services shall put mechanisms in place to allow any individual or entity to notify them of the presence on their service of illegal content.', kw: ['DSA', 'illegal content', 'notice and action'] },
  ])).concat(helper('Digital Markets Act 2022', 'DMA-EU', 'EU', 'competition_law', '2023-05-02', [
    { s: 'Art.5', t: 'Obligations for gatekeepers', txt: 'The gatekeeper shall refrain from combining personal data sourced from core platform services with personal data from any other services.', kw: ['DMA', 'gatekeeper', 'platform regulation'] },
  ]));
}

function getUSStatutes(): StatuteSection[] {
  return helper('California Consumer Privacy Act 2018', 'CCPA', 'US', 'data_protection', '2020-01-01', [
    { s: '1798.100', t: 'Right to know about personal information collected', txt: 'A consumer shall have the right to request that a business that collects personal information disclose to that consumer the categories and specific pieces of personal information the business has collected.', kw: ['CCPA', 'consumer privacy', 'personal information'] },
  ]).concat(helper('Health Insurance Portability and Accountability Act 1996', 'HIPAA', 'US', 'healthcare_law', '1996-08-21', [
    { s: '164.502', t: 'Uses and disclosures of PHI', txt: 'A covered entity may not use or disclose protected health information except as permitted or required by this subpart.', kw: ['HIPAA', 'PHI', 'healthcare privacy'] },
  ])).concat(helper('Sarbanes-Oxley Act 2002', 'SOX', 'US', 'corporate_law', '2002-07-30', [
    { s: '302', t: 'Corporate responsibility for financial reports', txt: 'The principal executive officer and the principal financial officer shall certify in each annual or quarterly report filed with the Commission.', kw: ['SOX', 'financial reporting', 'CEO certification'] },
  ])).concat(helper('Dodd-Frank Wall Street Reform Act 2010', 'DODD-FRANK', 'US', 'financial_law', '2010-07-21', [
    { s: '929-A', t: 'Security-based swaps', txt: 'The provisions of the securities laws applying to security-based swaps shall not provide any right or remedy against any clearing agency.', kw: ['Dodd-Frank', 'security-based swaps', 'financial reform'] },
  ])).concat(helper('Uniform Commercial Code', 'UCC', 'US', 'contract_law', '1952-01-01', [
    { s: '2-201', t: 'Statute of Frauds', txt: 'A contract for the sale of goods for the price of $500 or more is not enforceable unless there is some writing sufficient to indicate that a contract for sale has been made between the parties.', kw: ['UCC', 'statute of frauds', 'sale of goods'] },
  ]));
}

function getGCCStatutes(): StatuteSection[] {
  return helper('UAE Commercial Transactions Law 1993', 'UAE-CTL', 'GC', 'commercial_law', '1993-01-01', [
    { s: 'Art.1', t: 'Scope of application', txt: 'This Law shall apply to commercial activities and commercial obligations arising from commercial activities undertaken by merchants.', kw: ['UAE', 'commercial law', 'merchant'] },
  ]).concat(helper('DIFC Companies Law 2018', 'DIFC-CL', 'GC', 'corporate_law', '2018-10-01', [
    { s: 'Art.14', t: 'Objects of DIFC companies', txt: 'Unless the articles of association restrict the objects of the company, the objects are not restricted. A company shall have full capacity to carry on any business or activity.', kw: ['DIFC', 'company objects', 'Dubai'] },
  ])).concat(helper('UAE Cybercrime Law 2021', 'UAE-CCL', 'GC', 'technology_law', '2022-01-02', [
    { s: 'Art.2', t: 'Illegal access to information systems', txt: 'Whoever accesses a website, electronic information system, computer network without authorization shall be punished by imprisonment of at least one year and/or a fine of not less than 100,000 and not more than 300,000 Dirhams.', kw: ['UAE cybercrime', 'unauthorized access'] },
  ])).concat(helper('Saudi Commercial Court Law 2021', 'KSA-CCL', 'GC', 'commercial_law', '2021-06-01', [
    { s: 'Art.3', t: 'Commercial disputes jurisdiction', txt: 'The Commercial Court shall be competent to adjudicate commercial disputes arising from commercial transactions, including disputes related to companies and commercial agencies.', kw: ['Saudi Arabia', 'commercial court', 'jurisdiction'] },
  ])).concat(helper('GCC Data Protection Framework', 'GCC-DPF', 'GC', 'data_protection', '2022-01-01', [
    { s: 'Art.4', t: 'General data protection principles', txt: 'Personal data shall be collected for specified, explicit and legitimate purposes and shall not be further processed in a manner incompatible with those purposes.', kw: ['GCC data protection', 'personal data', 'purpose limitation'] },
  ]));
}

function getSingaporeStatutes(): StatuteSection[] {
  return helper('Singapore Companies Act 1967', 'SG-CA', 'SG', 'corporate_law', '1967-12-29', [
    { s: '157', t: 'Duty and liability of officer', txt: 'An officer of a company shall at all times act honestly and use reasonable diligence in the discharge of the duties of his office.', kw: ['Singapore', 'director duty', 'officer'] },
  ]).concat(helper('International Arbitration Act 1994 (Singapore)', 'SG-IAA', 'SG', 'arbitration', '1995-01-27', [
    { s: '4', t: 'Interpretation of Model Law', txt: 'For the purpose of interpreting the Model Law, reference may be made to the documents of the United Nations Commission on International Trade Law.', kw: ['Singapore', 'international arbitration', 'UNCITRAL'] },
  ])).concat(helper('Personal Data Protection Act 2012 (Singapore)', 'SG-PDPA', 'SG', 'data_protection', '2014-07-02', [
    { s: '18', t: 'Purpose limitation obligation', txt: 'An organisation shall not collect, use or disclose personal data about an individual for purposes that a reasonable person would consider appropriate in the circumstances and that the individual has been informed of.', kw: ['PDPA', 'Singapore', 'purpose limitation'] },
  ])).concat(helper('Securities and Futures Act 2001 (Singapore)', 'SG-SFA', 'SG', 'securities_law', '2002-10-01', [
    { s: '197', t: 'False trading and market rigging', txt: 'No person shall create a false or misleading appearance of active trading in any securities on a securities market.', kw: ['Singapore', 'false trading', 'market rigging'] },
  ])).concat(helper('Employment Act 1968 (Singapore)', 'SG-EA', 'SG', 'employment_law', '1968-08-15', [
    { s: '35', t: 'Days of annual leave', txt: 'An employee who has worked for an employer for at least 3 months shall be entitled to paid annual leave of 7 days for the first year of service.', kw: ['Singapore', 'annual leave', 'employment'] },
  ]));
}

async function batchUpsertStatutes(statutes: StatuteSection[]): Promise<number> {
  let seeded = 0;
  const batchSize = 50;

  for (let i = 0; i < statutes.length; i += batchSize) {
    const batch = statutes.slice(i, i + batchSize);

    for (const s of batch) {
      try {
        const kwArr = (s.keywords ?? []).map((k: string) => `'${k.replace(/'/g, "''")}'`).join(', ');
        const kwLiteral = `ARRAY[${kwArr}]`;
        const relSec = s.relatedSections ? `'{${(s.relatedSections as string[]).map((r: string) => r.replace(/'/g, "''")).join(',')}}'::text[]` : 'NULL';
        await db.execute(sql`
          INSERT INTO nv_statutes (
            act_title, act_short_title, jurisdiction, section_number, section_title,
            section_text, practice_area, keywords, effective_date, amended_date,
            related_sections, is_repealed
          ) VALUES (
            ${s.actTitle}, ${s.actShortTitle}, ${s.jurisdiction}, ${s.sectionNumber},
            ${s.sectionTitle}, ${s.sectionText}, ${s.practiceArea},
            ${sql.raw(kwLiteral)}, ${s.effectiveDate}::date,
            ${s.amendedDate ?? null},
            ${sql.raw(relSec)},
            ${s.isRepealed}
          )
          ON CONFLICT (jurisdiction, act_short_title, section_number) DO UPDATE SET
            section_title  = EXCLUDED.section_title,
            section_text   = EXCLUDED.section_text,
            practice_area  = EXCLUDED.practice_area,
            keywords       = EXCLUDED.keywords,
            effective_date = EXCLUDED.effective_date,
            is_repealed    = EXCLUDED.is_repealed,
            updated_at     = NOW()
        `);
        seeded++;
      } catch (err: any) {
        logger.warn(`Failed to seed statute ${s.actShortTitle} §${s.sectionNumber}: ${err.message}`);
      }
    }
  }

  return seeded;
}

async function shouldSeed(): Promise<boolean> {
  try {
    const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM nv_statutes`);
    const count = parseInt((result.rows[0] as any)?.cnt ?? '0', 10);
    // NV-STATUTE-EXPANSION-001: gate on the actual assembled seed size (not a
    // hardcoded 300) so that whenever the seed corpus grows the next boot
    // upserts the new rows. The upsert itself is idempotent (ON CONFLICT).
    return count < getAllSeedStatutes().length;
  } catch {
    return true;
  }
}

/** Force upsert statutes for selected jurisdictions (e.g. US GO corpus ingest). */
export async function seedStatutesForJurisdictions(
  jurisdictions: string[],
): Promise<{ seeded: number; jurisdictions: string[]; status: string }> {
  const codes = new Set(jurisdictions.map((j) => j.toUpperCase()));
  await ensureStatuteTable();
  const subset = getAllSeedStatutes().filter((s) => codes.has(s.jurisdiction.toUpperCase()));
  if (subset.length === 0) {
    return { seeded: 0, jurisdictions: [...codes], status: 'no_statutes_for_jurisdiction' };
  }
  const seeded = await batchUpsertStatutes(subset);
  return { seeded, jurisdictions: [...codes], status: 'seeded' };
}

export async function seedStatuteDatabase(): Promise<{ seeded: number; jurisdictions: string[]; status: string }> {
  try {
    await ensureStatuteTable();

    const needsSeed = await shouldSeed();
    if (!needsSeed) {
      const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM nv_statutes`);
      const cnt = parseInt((result.rows[0] as any)?.cnt ?? '0', 10);
      logger.info(`statute_db_already_seeded count=${cnt}`);
      return { seeded: cnt, jurisdictions: ['IN', 'UK', 'EU', 'US', 'GC', 'SG'], status: 'already_seeded' };
    }

    logger.info('Starting statute database seeding for all 6 jurisdictions...');

    const allStatutes = getAllSeedStatutes();

    logger.info(`Total statutes to seed: ${allStatutes.length}`);
    const seeded = await batchUpsertStatutes(allStatutes);

    logger.info(`statute_db_seeding_complete total=${seeded} jurisdictions=IN,UK,EU,US,GC,SG`);

    return {
      seeded,
      jurisdictions: ['IN', 'UK', 'EU', 'US', 'GC', 'SG'],
      status: 'seeded',
    };
  } catch (err: any) {
    logger.error(`statute_db_seeding_failed error=${err.message}`);
    return { seeded: 0, jurisdictions: [], status: `error: ${err.message}` };
  }
}

export async function searchStatutes(query: string, jurisdiction?: string, practiceArea?: string, limit = 10): Promise<any[]> {
  const q = String(query ?? '').trim();
  if (!q) return [];

  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 10));
  const jFilter = jurisdiction ? sql`AND jurisdiction = ${jurisdiction.toUpperCase()}` : sql``;
  const paFilter = practiceArea ? sql`AND practice_area = ${practiceArea}` : sql``;

  // Citation-aware parse: "BNS 103", "BNS §103", "Section 103 of BNS", "IPC 302"
  const cite =
    q.match(/^\s*(BNS|BNSS|BSA|IPC|CrPC|IEA|CPC|Cr\.?\s*P\.?\s*C\.?)\s*[§.\s#-]*(\d+[A-Za-z]?)\s*$/i) ||
    q.match(/^\s*Section\s+(\d+[A-Za-z]?)\s+(?:of\s+)?(BNS|BNSS|BSA|IPC|CrPC|IEA)\s*$/i) ||
    q.match(/^\s*(BNS|BNSS|BSA|IPC|CrPC|IEA)\s+Section\s+(\d+[A-Za-z]?)\s*$/i);

  if (cite) {
    let act = '';
    let section = '';
    if (cite[2] && /^(BNS|BNSS|BSA|IPC|CrPC|IEA)/i.test(cite[2])) {
      section = cite[1];
      act = cite[2].toUpperCase().replace(/\./g, '');
    } else {
      act = cite[1].toUpperCase().replace(/\./g, '').replace(/\s+/g, '');
      section = cite[2];
    }
    if (act === 'CRPCC' || act === 'CRPC') act = 'CrPC';
    const hit = await lookupStatuteSection(act, section, jurisdiction?.toUpperCase());
    if (hit) {
      return [
        {
          act_title: hit.act_title,
          act_short_title: hit.act_short_title,
          jurisdiction: hit.jurisdiction,
          section_number: hit.section_number,
          section_title: hit.section_title,
          section_preview: String(hit.section_text || '').slice(0, 500),
          practice_area: hit.practice_area,
          keywords: hit.keywords,
          rank: 1.0,
          matchType: 'citation',
        },
      ];
    }
    // Also try section_number ILIKE when exact act_short_title miss
    try {
      const bySection = await db.execute(sql`
        SELECT act_title, act_short_title, jurisdiction, section_number, section_title,
               LEFT(section_text, 500) as section_preview, practice_area, keywords,
               0.9::float8 as rank
        FROM nv_statutes
        WHERE is_repealed = FALSE
          ${jFilter}
          ${paFilter}
          AND (
            UPPER(act_short_title) = ${act}
            OR UPPER(act_title) LIKE ${`%${act}%`}
          )
          AND (
            section_number = ${section}
            OR section_number LIKE ${`${section}%`}
            OR LOWER(section_title) LIKE ${`%section ${section.toLowerCase()}%`}
          )
        ORDER BY jurisdiction, act_short_title
        LIMIT ${safeLimit}
      `);
      if ((bySection.rows as any[]).length > 0) {
        return (bySection.rows as any[]).map((r) => ({ ...r, matchType: 'citation' }));
      }
    } catch {
      /* fall through to FTS */
    }
  }

  try {
    const fts = await db.execute(sql`
      SELECT act_title, act_short_title, jurisdiction, section_number, section_title,
             LEFT(section_text, 500) as section_preview, practice_area, keywords,
             ts_rank(search_vector, plainto_tsquery('english', ${q})) as rank
      FROM nv_statutes
      WHERE search_vector @@ plainto_tsquery('english', ${q})
        AND is_repealed = FALSE
        ${jFilter}
        ${paFilter}
      ORDER BY rank DESC
      LIMIT ${safeLimit}
    `);
    if ((fts.rows as any[]).length > 0) return fts.rows as any[];

    // Fallback: ILIKE when tsquery yields no rows (short tokens, legal abbreviations).
    const like = `%${q.toLowerCase()}%`;
    const ilike = await db.execute(sql`
      SELECT act_title, act_short_title, jurisdiction, section_number, section_title,
             LEFT(section_text, 500) as section_preview, practice_area, keywords,
             0.1::float8 as rank
      FROM nv_statutes
      WHERE is_repealed = FALSE
        ${jFilter}
        ${paFilter}
        AND (
          LOWER(act_title) LIKE ${like}
          OR LOWER(act_short_title) LIKE ${like}
          OR LOWER(section_number) LIKE ${like}
          OR LOWER(section_title) LIKE ${like}
          OR LOWER(section_text) LIKE ${like}
          OR EXISTS (SELECT 1 FROM unnest(keywords) kw WHERE LOWER(kw) LIKE ${like})
        )
      ORDER BY jurisdiction, act_short_title, section_number
      LIMIT ${safeLimit}
    `);
    return ilike.rows as any[];
  } catch (err: any) {
    logger.warn('statute_search_failed', { err: err?.message, query: q.slice(0, 80) });
    return [];
  }
}

export async function lookupStatuteSection(actShortTitle: string, sectionNumber: string, jurisdiction?: string): Promise<any | null> {
  try {
    const jFilter = jurisdiction ? sql`AND jurisdiction = ${jurisdiction}` : sql``;
    const result = await db.execute(sql`
      SELECT * FROM nv_statutes
      WHERE act_short_title = ${actShortTitle}
        AND section_number = ${sectionNumber}
        AND is_repealed = FALSE
        ${jFilter}
      LIMIT 1
    `);
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function getStatuteStats(): Promise<{ totalSections: number; byJurisdiction: Record<string, number>; byAct: Record<string, number> }> {
  try {
    const total = await db.execute(sql`SELECT COUNT(*) as cnt FROM nv_statutes WHERE is_repealed = FALSE`);
    const byJ = await db.execute(sql`SELECT jurisdiction, COUNT(*) as cnt FROM nv_statutes WHERE is_repealed = FALSE GROUP BY jurisdiction ORDER BY jurisdiction`);
    const byA = await db.execute(sql`SELECT act_short_title, COUNT(*) as cnt FROM nv_statutes WHERE is_repealed = FALSE GROUP BY act_short_title ORDER BY cnt DESC LIMIT 30`);

    return {
      totalSections: parseInt((total.rows[0] as any)?.cnt ?? '0', 10),
      byJurisdiction: Object.fromEntries((byJ.rows as any[]).map(r => [r.jurisdiction, parseInt(r.cnt, 10)])),
      byAct: Object.fromEntries((byA.rows as any[]).map(r => [r.act_short_title, parseInt(r.cnt, 10)])),
    };
  } catch {
    return { totalSections: 0, byJurisdiction: {}, byAct: {} };
  }
}
