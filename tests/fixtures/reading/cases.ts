export interface ReadingFixture {
  name: string;
  host: string;
  sourceLayout: string;
  accessState: "loaded" | "restricted";
  html: string;
  expectedIds: string[];
}

// Minimal structural fixtures with hand-annotated passages. These are layout
// regression targets, not live publisher snapshots or publisher-wide claims.
const layouts = [
  { name: "Nature", host: "www.nature.com", start: '<article><div class="c-article-body main-content">', end: "</div></article>", paragraph: "p" },
  { name: "Wiley", host: "onlinelibrary.wiley.com", start: '<article><div id="article__body">', end: "</div></article>", paragraph: 'div class="paragraph-element"' },
  { name: "ScienceDirect", host: "www.sciencedirect.com", start: '<main><div class="Body" id="body">', end: "</div></main>", paragraph: 'div class="section-paragraph"' },
  { name: "Cell", host: "www.cell.com", start: '<article><div class="article-text">', end: "</div></article>", paragraph: 'div class="NLM_p"' },
  { name: "Springer", host: "link.springer.com", start: '<article><div class="c-article-section__content">', end: "</div></article>", paragraph: 'div class="Para"' },
  { name: "ACS", host: "pubs.acs.org", start: '<article><div class="article__body">', end: "</div></article>", paragraph: 'div class="NLM_p"' },
  { name: "RSC", host: "pubs.rsc.org", start: '<main><div class="article__body">', end: "</div></main>", paragraph: "p" },
  { name: "AIP", host: "pubs.aip.org", start: '<main><div class="widget-ArticleFulltext">', end: "</div></main>", paragraph: 'div class="NLM_p"' },
  { name: "IEEE", host: "ieeexplore.ieee.org", start: '<main><xpl-document-full-text><div class="article-body">', end: "</div></xpl-document-full-text></main>", paragraph: "p" },
  { name: "AAAS", host: "www.science.org", start: '<article><div class="hlFld-Fulltext">', end: "</div></article>", paragraph: 'div class="NLM_p"' },
  { name: "Taylor and Francis", host: "www.tandfonline.com", start: '<article><div class="hlFld-Fulltext">', end: "</div></article>", paragraph: "p" },
  { name: "SAGE", host: "journals.sagepub.com", start: '<article><div class="article__body">', end: "</div></article>", paragraph: 'div class="NLM_p"' },
  { name: "Oxford", host: "academic.oup.com", start: '<article><div class="widget-ArticleFulltext">', end: "</div></article>", paragraph: "p" },
  { name: "Cambridge", host: "www.cambridge.org", start: '<article><div class="article-body">', end: "</div></article>", paragraph: "p" },
  { name: "MDPI", host: "www.mdpi.com", start: '<article><div class="html-body">', end: "</div></article>", paragraph: 'div class="html-p"' },
  { name: "Frontiers", host: "www.frontiersin.org", start: '<article><div class="article-container">', end: "</div></article>", paragraph: "p" },
  { name: "PLOS", host: "journals.plos.org", start: '<article id="artText">', end: "</article>", paragraph: "p" },
  { name: "PMC", host: "pmc.ncbi.nlm.nih.gov", start: '<article><div class="jig-ncbiinpagenav">', end: "</div></article>", paragraph: "p" },
  { name: "arXiv", host: "arxiv.org", start: '<main><div class="ltx_document">', end: "</div></main>", paragraph: 'div class="ltx_para"' },
];

export const READING_FIXTURES: ReadingFixture[] = layouts.flatMap((layout) => {
  const tag = layout.paragraph.split(" ")[0];
  const prose = (id: string, text: string) => `<${layout.paragraph} id="${id}">${text}</${tag}>`;
  const header = '<header><h1>Device stability study</h1><p id="lead">No drift.</p></header>';
  const loaded = `${layout.start}${header}<section><h2>Results</h2>
    ${prose("passage", "Independent measurements showed stable switching across the tested devices.")}
    ${prose("short", "The effect disappeared.")}
    <ul><li id="list">Use short pulses.</li></ul><blockquote id="quote">Repeat the test.</blockquote>
    <figure><figcaption id="caption">Figure 1. Stable current.</figcaption></figure>
    <table id="table"><caption>Table 1. Measurements</caption><thead><tr><th>Device</th><th>TER (%)</th></tr></thead>
      <tbody><tr><th scope="row">A</th><td>120</td></tr></tbody></table>
    </section><section class="Appendices"><h2>Appendix A. Methods</h2>${prose("appendix", "Pulse width: 10 ns.")}</section>
    <section id="references"><h2>References</h2><p id="reference">A bibliographic citation appears here.</p></section>
    <aside class="related-content"><p id="related">An unrelated article is recommended here.</p></aside>
    ${layout.end}`;
  return [
    { name: layout.name, host: layout.host, sourceLayout: `Constructed ${layout.name} fragmented/caption/table/appendix layout`, accessState: "loaded" as const,
      html: loaded, expectedIds: ["lead", "passage", "short", "list", "quote", "caption", "table", "appendix"] },
    { name: `${layout.name} restricted`, host: layout.host, sourceLayout: `Constructed ${layout.name} abstract with access gate`, accessState: "restricted" as const,
      html: `${layout.start}${header}<div class="paywall"><p id="gate">Sign in to read the complete article.</p></div>${layout.end}`, expectedIds: ["lead"] },
  ];
});
