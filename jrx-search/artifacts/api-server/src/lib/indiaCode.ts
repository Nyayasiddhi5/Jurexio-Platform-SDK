/**
 * Shared helpers for the India Code (indiacode.nic.in) ingest pipelines
 * (HTML section ingest + PDF-only act ingest).
 */

export const INDIA_CODE_BASE = "https://www.indiacode.nic.in";

// India Code's WAF started returning 403s for our previous identifying UA
// mid-run; a standard browser UA is served normally. Politeness is enforced
// by the callers (delays + circuit breakers).
export const INDIA_CODE_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 45_000;

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&apos;/g, "'");
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function slugCode(title: string): string {
  return decodeEntities(title)
    .toUpperCase()
    .replace(/^THE\s+/, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Ministry -> practice area. Anything unmapped falls back to "General".
const MINISTRY_PRACTICE_AREA: Array<[RegExp, string]> = [
  [/corporate affairs/i, "Corporate & Commercial"],
  [/finance|revenue|economic affairs|financial services/i, "Tax & Finance"],
  [/law and justice|legal affairs|legislative/i, "Civil & Procedure"],
  [/home affairs/i, "Criminal"],
  [/labour|employment/i, "Labour & Employment"],
  [/commerce|industry|industries|micro,? small/i, "Trade & Industry"],
  [/environment|forest|climate/i, "Environment"],
  [/electronics|information technology|communications/i, "Technology & Data"],
  [/women and child|social justice/i, "Family & Social Welfare"],
  [/health|family welfare|ayush/i, "Health & Pharma"],
  [/consumer affairs|food/i, "Consumer & Food"],
  [/housing|urban/i, "Real Estate & Urban"],
  [/rural development|panchayati raj|land resources/i, "Land & Rural"],
  [/agriculture|farmers/i, "Agriculture"],
  [/power|petroleum|coal|mines|new and renewable/i, "Energy & Resources"],
  [/road transport|railways|civil aviation|shipping|ports/i, "Transport"],
  [/defence/i, "Defence & Security"],
  [/external affairs/i, "International"],
  [/education|human resource/i, "Education"],
  [/personnel|public grievances|pensions/i, "Service & Administrative"],
  [/culture|tourism|information and broadcasting|youth|sports/i, "Media & Culture"],
  [/tribal affairs|minority affairs/i, "Family & Social Welfare"],
  [/science|space|atomic|earth sciences|biotechnology/i, "Science & Research"],
  [/water|jal|irrigation/i, "Environment"],
  [/textiles|steel|chemicals|fertilizers|heavy industries|food processing/i, "Trade & Industry"],
];

// Title-keyword overrides (take precedence over the ministry map).
const TITLE_PRACTICE_AREA: Array<[RegExp, string]> = [
  [/marriage|divorce|succession|guardian|adoption|maintenance|dowry|domestic violence|family/i, "Family & Social Welfare"],
  [/penal|criminal|offences|police|prisons|narcotic|arms|explosive/i, "Criminal"],
  [/tax|duty|customs|excise|gst|goods and services/i, "Tax & Finance"],
  [/companies|partnership|securities|insolvency|banking|insurance|negotiable/i, "Corporate & Commercial"],
  [/patent|trade mark|copyright|designs|geographical indications/i, "Intellectual Property"],
  [/contract|specific relief|sale of goods|arbitration|limitation|evidence|civil procedure|court/i, "Civil & Procedure"],
  [/environment|pollution|forest|wild ?life|biodiversity/i, "Environment"],
  [/information technology|data protection|telecom|telegraph/i, "Technology & Data"],
  [/labour|wages|gratuity|provident fund|industrial disputes|employees|workmen|bonus|trade unions/i, "Labour & Employment"],
  [/property|land|tenancy|rent|real estate|registration|stamp|easements/i, "Property & Real Estate"],
  [/election|representation of the people|citizenship|passport|foreigners/i, "Constitutional & Public"],
  [/consumer|food safety|drugs|essential commodities/i, "Consumer & Food"],
];

export function practiceArea(title: string, ministry: string | null): string {
  for (const [re, area] of TITLE_PRACTICE_AREA) if (re.test(title)) return area;
  if (ministry) for (const [re, area] of MINISTRY_PRACTICE_AREA) if (re.test(ministry)) return area;
  return "General";
}

export async function fetchText(url: string, retries = 3): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": INDIA_CODE_UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt >= retries) throw new Error(`fetch failed ${url}: ${String(err)}`);
      await sleep(1000 * attempt * attempt);
    }
  }
}

export async function fetchBinary(url: string, retries = 3): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": INDIA_CODE_UA },
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= retries) throw new Error(`fetch failed ${url}: ${String(err)}`);
      await sleep(1000 * attempt * attempt);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface ActMeta {
  title: string;
  actYear: string | null;
  actNo: string | null;
  enactmentDate: string | null;
  ministry: string | null;
  department: string | null;
}

export async function fetchActMeta(handle: string): Promise<ActMeta> {
  const html = await fetchText(`${INDIA_CODE_BASE}/handle/${handle}?mode=full`);
  const fields = new Map<string, string>();
  const re =
    /metadataFieldLabel[^>]*>\s*([^<]*?)\s*<[\s\S]*?metadataFieldValue[^>]*>\s*([\s\S]*?)\s*<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const key = m[1].trim();
    if (!fields.has(key)) fields.set(key, stripHtml(m[2]));
  }
  return {
    title: fields.get("dc.title") ?? "",
    actYear: fields.get("dc.date.actyear") ?? null,
    actNo: fields.get("dc.identifier.actno") ?? null,
    enactmentDate: fields.get("dc.description.enfdate") ?? null,
    ministry: fields.get("dc.relation.ministry") ?? null,
    department: fields.get("dc.relation.department") ?? null,
  };
}
