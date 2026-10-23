export const CATEGORY_NAMES: Record<string, string> = {
  "antitrust-competition": "Antitrust & Competition",
  "arbitration-international-dispute-resolution":
    "Arbitration & International Dispute Resolution",
  "banking-finance": "Banking & Finance",
  "bankruptcy-restructuring": "Bankruptcy & Restructuring",
  "capital-markets": "Capital Markets",
  "corporate-governance": "Corporate Governance",
  "corporate-ma": "Mergers & Acquisitions",
  "data-privacy-cybersecurity": "Data Privacy & Cybersecurity",
  "emerging-companies-venture-capital": "Emerging Companies & Venture Capital",
  "employment-labor": "Employment & Labor",
  "energy-natural-resources": "Energy & Natural Resources",
  "environmental-esg": "Environmental & ESG",
  "funds-asset-management": "Funds & Asset Management",
  "healthcare-life-sciences": "Healthcare & Life Sciences",
  "immigration": "Immigration",
  "insurance": "Insurance",
  "intellectual-property": "Intellectual Property",
  "international-trade-sanctions": "International Trade & Sanctions",
  "litigation-dispute-resolution": "Litigation & Dispute Resolution",
  "real-estate": "Real Estate",
  "structured-finance-securitization": "Structured Finance & Securitization",
  "tax": "Tax",
  "trusts-estates-private-client": "Trusts, Estates & Private Client",
  "white-collar-defense-investigations":
    "White Collar Defense & Investigations",
};

export function categoryName(slug: string): string {
  if (CATEGORY_NAMES[slug]) return CATEGORY_NAMES[slug];
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
