export interface AcademicFixtureCase {
  name: string;
  host: string;
  file: string;
  expectedIds: string[];
  forbiddenIds: string[];
  profileOnlyId?: string;
}

export const PROFILE_CASES: AcademicFixtureCase[] = [
  { name: "Nature", host: "www.nature.com", file: "nature.html", expectedIds: ["n-abstract", "n-figcap", "n-body", "n-tablecap"], forbiddenIds: ["n-ref", "n-nav", "n-table-cell"] },
  { name: "Wiley", host: "onlinelibrary.wiley.com", file: "wiley.html", expectedIds: ["w-body1", "w-figcap", "w-paragraph-div"], forbiddenIds: ["w-paragraph-wrapper", "w-ref", "w-footer"], profileOnlyId: "w-paragraph-div" },
  { name: "ScienceDirect", host: "www.sciencedirect.com", file: "sciencedirect.html", expectedIds: ["sd-abstract", "sd-body1", "sd-body2"], forbiddenIds: ["sd-figure-copy", "sd-table-copy", "sd-ref", "sd-related"] },
  { name: "ResearchGate", host: "www.researchgate.net", file: "researchgate.html", expectedIds: ["rg-body1", "rg-caption", "rg-body2"], forbiddenIds: ["rg-citation", "rg-comment", "rg-profile"] },
  { name: "AIP", host: "pubs.aip.org", file: "aip.html", expectedIds: ["aip-abstract", "aip-body1", "aip-caption", "aip-body2"], forbiddenIds: ["aip-body1-wrapper", "aip-modal-caption", "aip-paywall", "aip-figshare", "aip-ref"] },
  { name: "RSC", host: "pubs.rsc.org", file: "rsc.html", expectedIds: ["rsc-abstract", "rsc-body1", "rsc-caption", "rsc-body2"], forbiddenIds: ["rsc-author", "rsc-date", "rsc-table-bio", "rsc-ref"] },
  { name: "PLOS", host: "journals.plos.org", file: "plos.html", expectedIds: ["plos-abstract", "plos-body1", "plos-caption", "plos-body2"], forbiddenIds: ["plos-citation", "plos-editor", "plos-ref", "plos-nav"] },
  { name: "NCBI", host: "www.ncbi.nlm.nih.gov", file: "ncbi.html", expectedIds: ["pmc-body1", "pmc-figcap", "pmc-tablecap", "pmc-body2"], forbiddenIds: ["pmc-ref", "pmc-contributor", "pmc-table-cell"] },
  { name: "arXiv", host: "arxiv.org", file: "arxiv.html", expectedIds: ["ax-abstract", "ax-equation-body", "ax-permission-near-collision", "ax-caption", "ax-body2"], forbiddenIds: ["ax-bib", "ax-author", "ax-dialog", "ax-permission"] },
  { name: "ACS", host: "pubs.acs.org", file: "acs.html", expectedIds: ["acs-body1", "acs-caption", "acs-nlm-div"], forbiddenIds: ["acs-nlm-wrapper", "acs-ref", "acs-nav"], profileOnlyId: "acs-nlm-div" },
  { name: "Springer", host: "link.springer.com", file: "springer.html", expectedIds: ["sp-para-div", "sp-caption", "sp-body"], forbiddenIds: ["sp-ref", "sp-footer"], profileOnlyId: "sp-para-div" },
  { name: "IEEE", host: "ieeexplore.ieee.org", file: "ieee.html", expectedIds: ["ieee-abstract-div", "ieee-body1", "ieee-caption", "ieee-body2"], forbiddenIds: ["ieee-ref", "ieee-sidebar", "ieee-related", "ieee-doi-meta"] },
  { name: "Science.org", host: "www.science.org", file: "science.html", expectedIds: ["sci-body1", "sci-caption", "sci-body2"], forbiddenIds: ["sci-backmatter", "sci-collateral", "sci-alert"], profileOnlyId: "sci-caption" },
];
