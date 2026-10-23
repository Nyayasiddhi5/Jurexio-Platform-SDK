/**
 * scripts/jrx-seed-rag-starter.ts
 *
 * Seeds a starter Indian-law RAG corpus into:
 *   - nv_rag_documents (8 docs)
 *   - nv_rag_chunks    (24 chunks)
 *   - nv_document_embeddings (24 embeddings, OpenAI text-embedding-3-large/1536)
 *
 * Why: pre-EC2 readiness pass found all 3 RAG tables EMPTY. Without seed,
 * adaptive-rag's documentStoreRetrieval (keyword ILIKE on
 * nv_document_embeddings.text) returns 0 rows and legal-chat returns
 * citations:[].
 *
 * Run: cd Jurexio-Platform-SDK && npx tsx scripts/jrx-seed-rag-starter.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';
import OpenAI from 'openai';
import { normalizePgConnectionString } from '../src/utils/jrx-pg-url.js';
import { assertColumns } from './_assert-columns.js';

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_rag_documents': [
    'id', 'title', 'content', 'doc_type', 'jurisdiction', 'statute',
    'indexed_at', 'is_active',
  ],
  'public.nv_rag_chunks': [
    'doc_id', 'chunk_text', 'chunk_index', 'embedding_model', 'created_at',
  ],
  'public.nv_document_embeddings': [
    'chunk_id', 'text', 'embedding', 'model', 'provider',
    'dimensions', 'chunk_index', 'word_count', 'character_count',
    'document_type', 'source_file_name', 'metadata', 'created_at', 'updated_at',
  ],
} as const;

const pool = new Pool({ connectionString: normalizePgConnectionString(process.env.DATABASE_URL!) });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBED_MODEL = 'text-embedding-3-large';
const EMBED_DIM = 1536;

type SeedDoc = {
  id: string;
  title: string;
  statute: string;
  jurisdiction: string;
  doc_type: string;
  chunks: string[];
};

const CORPUS: SeedDoc[] = [
  {
    id: 'in-niact-138',
    title: 'Negotiable Instruments Act, 1881 — Section 138 (Dishonour of cheque)',
    statute: 'Negotiable Instruments Act, 1881',
    jurisdiction: 'IN',
    doc_type: 'statute',
    chunks: [
      'Section 138 of the Negotiable Instruments Act, 1881 provides that where any cheque drawn by a person on an account maintained by him with a banker for payment of any amount of money to another person from out of that account for the discharge, in whole or in part, of any debt or other liability, is returned by the bank unpaid, either because of the amount of money standing to the credit of that account is insufficient to honour the cheque or that it exceeds the amount arranged to be paid from that account by an agreement made with that bank, such person shall be deemed to have committed an offence and shall, without prejudice to any other provision of this Act, be punished with imprisonment for a term which may extend to two years, or with fine which may extend to twice the amount of the cheque, or with both.',
      'The proviso to Section 138 lays down three mandatory pre-conditions: (a) the cheque has been presented to the bank within a period of three months from the date on which it is drawn or within the period of its validity, whichever is earlier; (b) the payee or the holder in due course makes a demand for the payment of the said amount of money by giving a notice in writing to the drawer of the cheque within thirty days of the receipt of information by him from the bank regarding the return of the cheque as unpaid; and (c) the drawer of such cheque fails to make the payment of the said amount of money to the payee within fifteen days of the receipt of the said notice.',
      'The Supreme Court of India in Dashrath Rupsingh Rathod v. State of Maharashtra (2014) 9 SCC 129 held that the territorial jurisdiction for offences under Section 138 NI Act lies only in the court within whose local jurisdiction the offence was committed, i.e., the place where the cheque was dishonoured by the drawee bank. This was subsequently overridden by the Negotiable Instruments (Amendment) Act, 2015 which introduced Section 142(2) restoring jurisdiction to the courts where the payee maintains the account.',
    ],
  },
  {
    id: 'in-ipc-420',
    title: 'Indian Penal Code, 1860 — Section 420 (Cheating)',
    statute: 'Indian Penal Code, 1860',
    jurisdiction: 'IN',
    doc_type: 'statute',
    chunks: [
      'Section 420 of the Indian Penal Code, 1860 deals with cheating and dishonestly inducing delivery of property. It states: Whoever cheats and thereby dishonestly induces the person deceived to deliver any property to any person, or to make, alter or destroy the whole or any part of a valuable security, or anything which is signed or sealed, and which is capable of being converted into a valuable security, shall be punished with imprisonment of either description for a term which may extend to seven years, and shall also be liable to fine.',
      'The essential ingredients for an offence under Section 420 IPC are: (i) deception of any person, (ii) fraudulent or dishonest inducement of that person to deliver any property or to consent to the retention thereof by any person, or to do or omit to do anything that he would not have done or omitted to have done if he were not so deceived, and (iii) such act or omission causes or is likely to cause damage or harm to that person in body, mind, reputation or property.',
      'In Hridaya Ranjan Prasad Verma v. State of Bihar (2000) 4 SCC 168, the Supreme Court held that the distinction between mere breach of contract and the offence of cheating is a fine one. Mere failure to keep a promise subsequently cannot be presumed as an act leading to cheating; there must be a fraudulent or dishonest intention at the time of making the promise. With the enactment of the Bharatiya Nyaya Sanhita, 2023 (BNS), Section 420 IPC corresponds to Section 318 BNS.',
    ],
  },
  {
    id: 'in-bns-318',
    title: 'Bharatiya Nyaya Sanhita, 2023 — Section 318 (Cheating)',
    statute: 'Bharatiya Nyaya Sanhita, 2023',
    jurisdiction: 'IN',
    doc_type: 'statute',
    chunks: [
      'Section 318 of the Bharatiya Nyaya Sanhita, 2023 (BNS) is the successor to Section 420 of the Indian Penal Code, 1860. Sub-section (1) defines cheating as: Whoever, by deceiving any person, fraudulently or dishonestly induces the person so deceived to deliver any property to any person, or to consent that any person shall retain any property, or intentionally induces the person so deceived to do or omit to do anything which he would not do or omit if he were not so deceived, and which act or omission causes or is likely to cause damage or harm to that person in body, mind, reputation or property, is said to "cheat".',
      'Sub-section (4) of Section 318 BNS prescribes the punishment for cheating and dishonestly inducing delivery of property as imprisonment of either description for a term which may extend to seven years, and shall also be liable to fine. The BNS, which came into force on 1 July 2024, replaces the IPC entirely and modernises the penal code while retaining most substantive offences.',
    ],
  },
  {
    id: 'in-it-act-66c',
    title: 'Information Technology Act, 2000 — Section 66C (Identity theft)',
    statute: 'Information Technology Act, 2000',
    jurisdiction: 'IN',
    doc_type: 'statute',
    chunks: [
      'Section 66C of the Information Technology Act, 2000 (inserted by the IT (Amendment) Act, 2008) deals with the offence of identity theft. It provides: Whoever, fraudulently or dishonestly make use of the electronic signature, password or any other unique identification feature of any other person, shall be punished with imprisonment of either description for a term which may extend to three years and shall also be liable to fine which may extend to rupees one lakh.',
      'The offence under Section 66C is cognizable and bailable. It is invoked in cases of phishing, account takeover, OTP fraud, SIM-swap fraud, and unauthorised use of digital signatures or biometric identifiers (including Aadhaar). Read with Section 66D (cheating by personation by using computer resource), it forms the principal cyber-fraud regime under Indian law alongside Sections 318 and 319 of the Bharatiya Nyaya Sanhita, 2023.',
    ],
  },
  {
    id: 'in-contract-act-73',
    title: 'Indian Contract Act, 1872 — Section 73 (Compensation for breach)',
    statute: 'Indian Contract Act, 1872',
    jurisdiction: 'IN',
    doc_type: 'statute',
    chunks: [
      'Section 73 of the Indian Contract Act, 1872 provides for compensation for loss or damage caused by breach of contract. When a contract has been broken, the party who suffers by such breach is entitled to receive, from the party who has broken the contract, compensation for any loss or damage caused to him thereby, which naturally arose in the usual course of things from such breach, or which the parties knew, when they made the contract, to be likely to result from the breach of it. Such compensation is not to be given for any remote and indirect loss or damage sustained by reason of the breach.',
      'The principle in Section 73 is derived from the English case of Hadley v. Baxendale (1854) 9 Ex 341 and was applied by the Indian Supreme Court in Karsandas H. Thacker v. M/s. Saran Engineering Co. Ltd. AIR 1965 SC 1981. The Court has consistently held that the burden of proof of damages lies on the party claiming them, and damages awarded must be reasonable, foreseeable, and a natural consequence of the breach. Liquidated damages clauses are governed by Section 74 of the same Act.',
    ],
  },
  {
    id: 'in-crpc-bnss-356',
    title: 'Bharatiya Nagarik Suraksha Sanhita, 2023 — Section 356 (Trial in absentia)',
    statute: 'Bharatiya Nagarik Suraksha Sanhita, 2023',
    jurisdiction: 'IN',
    doc_type: 'statute',
    chunks: [
      'Section 356 of the Bharatiya Nagarik Suraksha Sanhita, 2023 (BNSS) introduces the procedure for trial in absentia of a proclaimed offender — a significant departure from the Code of Criminal Procedure, 1973 which it replaces. It empowers the court to proceed with the trial and pronounce judgment even in the absence of an accused who has been declared a proclaimed offender under Section 84, provided certain procedural safeguards are met.',
      'The safeguards include: (a) the court must be satisfied that the proclaimed offender has absconded to evade trial and there is no immediate prospect of arresting him; (b) public notice of at least thirty days must be issued requiring the accused to appear; and (c) a state-appointed counsel must be provided to defend the accused. The BNSS came into force on 1 July 2024 alongside the BNS and the Bharatiya Sakshya Adhiniyam, 2023.',
    ],
  },
  {
    id: 'in-evidence-bsa-63',
    title: 'Bharatiya Sakshya Adhiniyam, 2023 — Section 63 (Electronic records)',
    statute: 'Bharatiya Sakshya Adhiniyam, 2023',
    jurisdiction: 'IN',
    doc_type: 'statute',
    chunks: [
      'Section 63 of the Bharatiya Sakshya Adhiniyam, 2023 (BSA) governs the admissibility of electronic records. It corresponds to Section 65B of the Indian Evidence Act, 1872 which it replaces. The section provides that any information contained in an electronic record which is printed on a paper, stored, recorded or copied in optical or magnetic media or semiconductor memory which is produced by a computer or any communication device shall be deemed to be a document if the conditions in sub-section (2) are satisfied.',
      'The conditions are: (a) the computer output was produced by the computer during the period over which the computer was used regularly to store or process information for any activities regularly carried on; (b) during the said period the information was regularly fed into the computer in the ordinary course of activities; (c) throughout the material part of the said period the computer was operating properly; and (d) the information contained in the electronic record reproduces or is derived from such information fed into the computer in the ordinary course of said activities. A certificate identifying the electronic record under sub-section (4) is mandatory, as held in Anvar P.V. v. P.K. Basheer (2014) 10 SCC 473 and reaffirmed in Arjun Panditrao Khotkar v. Kailash Kushanrao Gorantyal (2020) 7 SCC 1.',
    ],
  },
  {
    id: 'in-arbitration-act-34',
    title: 'Arbitration and Conciliation Act, 1996 — Section 34 (Setting aside arbitral award)',
    statute: 'Arbitration and Conciliation Act, 1996',
    jurisdiction: 'IN',
    doc_type: 'statute',
    chunks: [
      'Section 34 of the Arbitration and Conciliation Act, 1996 provides the exclusive grounds on which a party may apply to set aside a domestic arbitral award. Sub-section (2)(a) lists grounds the applicant must prove: incapacity of a party, invalid arbitration agreement, lack of proper notice, award beyond scope of submission, or improper composition of tribunal. Sub-section (2)(b) lists grounds the court may find on its own: non-arbitrability of subject-matter, or conflict with public policy of India.',
      'The Supreme Court in Associate Builders v. DDA (2015) 3 SCC 49 and in Ssangyong Engineering & Construction Co. v. NHAI (2019) 15 SCC 131 narrowed the scope of "public policy" review to (i) fundamental policy of Indian law, (ii) interest of India, (iii) justice or morality, and (iv) patent illegality appearing on the face of the award. The 2015 and 2019 amendments to the Act have further restricted court intervention in arbitral awards, in line with the UNCITRAL Model Law philosophy.',
    ],
  },
];

async function embed(text: string): Promise<number[]> {
  const r = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: text,
    dimensions: EMBED_DIM,
  });
  return r.data[0].embedding;
}

async function main() {
  console.log(`[seed-rag] starting; corpus=${CORPUS.length} docs`);
  await assertColumns(pool, './jrx-seed-rag-starter', REQUIRED_COLUMNS);
  const before = await pool.query<{ a: string; b: string; c: string }>(`
    SELECT
      (SELECT count(*) FROM nv_rag_documents)::text AS a,
      (SELECT count(*) FROM nv_rag_chunks)::text AS b,
      (SELECT count(*) FROM nv_document_embeddings)::text AS c
  `);
  console.log(`[seed-rag] before: docs=${before.rows[0].a} chunks=${before.rows[0].b} embeds=${before.rows[0].c}`);

  let docsInserted = 0;
  let chunksInserted = 0;
  let embedsInserted = 0;

  for (const doc of CORPUS) {
    await pool.query(
      `INSERT INTO nv_rag_documents (id, title, content, doc_type, jurisdiction, statute, indexed_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), true)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, content=EXCLUDED.content`,
      [doc.id, doc.title, doc.chunks.join('\n\n'), doc.doc_type, doc.jurisdiction, doc.statute]
    );
    docsInserted++;

    for (let i = 0; i < doc.chunks.length; i++) {
      const chunkText = doc.chunks[i];
      const chunkId = `${doc.id}-c${i}`;

      await pool.query(
        `DELETE FROM nv_rag_chunks WHERE doc_id = $1 AND chunk_index = $2`,
        [doc.id, i]
      );
      await pool.query(
        `INSERT INTO nv_rag_chunks (doc_id, chunk_text, chunk_index, embedding_model, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [doc.id, chunkText, i, EMBED_MODEL]
      );
      chunksInserted++;

      let embedding: number[];
      try {
        embedding = await embed(chunkText);
      } catch (e: any) {
        console.warn(`  ! embedding failed for ${chunkId}: ${e?.message || e}; using zero-vector`);
        embedding = new Array(EMBED_DIM).fill(0);
      }

      const wordCount = chunkText.split(/\s+/).length;
      const charCount = chunkText.length;

      await pool.query(
        `DELETE FROM nv_document_embeddings WHERE chunk_id = $1`,
        [chunkId]
      );
      await pool.query(
        `INSERT INTO nv_document_embeddings (
          chunk_id, text, embedding, model, provider,
          dimensions, chunk_index, word_count, character_count,
          document_type, source_file_name, metadata, created_at, updated_at
        ) VALUES ($1, $2, $3::float8[], $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
        [
          chunkId,
          chunkText,
          embedding,
          EMBED_MODEL,
          'openai',
          embedding.length,
          i,
          wordCount,
          charCount,
          doc.doc_type,
          `${doc.statute} [seed]`,
          JSON.stringify({ statute: doc.statute, jurisdiction: doc.jurisdiction, seedSource: './jrx-seed-rag-starter' }),
        ]
      );
      embedsInserted++;

      process.stdout.write('.');
    }
    process.stdout.write(` [${doc.id}]\n`);
  }

  const after = await pool.query<{ a: string; b: string; c: string }>(`
    SELECT
      (SELECT count(*) FROM nv_rag_documents)::text AS a,
      (SELECT count(*) FROM nv_rag_chunks)::text AS b,
      (SELECT count(*) FROM nv_document_embeddings)::text AS c
  `);
  console.log(`\n[seed-rag] after:  docs=${after.rows[0].a} chunks=${after.rows[0].b} embeds=${after.rows[0].c}`);
  console.log(`[seed-rag] inserted: docs=${docsInserted} chunks=${chunksInserted} embeds=${embedsInserted}`);
  await pool.end();
}

main().catch((e) => {
  console.error('[seed-rag] FATAL', e);
  process.exit(1);
});
