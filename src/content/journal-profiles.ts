export interface JournalProfile {
  hostPattern: RegExp;
  selectors: string[];
  skipSelectors: string[];
  skipPredicate?: (el: Element) => boolean;
  captionSelectors?: string[];
  readingSkipSelectors?: string[];
  readingSkipPredicate?: (el: Element) => boolean;
}

const ARXIV_PERMISSION_NOTICE_RE =
  /\b(?:provided proper attribution|grants? permission|permission (?:is )?granted)\b[\s\S]{0,240}\b(?:reproduce|reuse|distribute)\b/i;

export function matchesOrClosest(el: Element, selector: string): boolean {
  try {
    return el.matches(selector) || el.closest(selector) !== null;
  } catch {
    return false;
  }
}

export function isArxivPermissionNotice(el: Element): boolean {
  if (matchesOrClosest(el, ".ltx_permission")) return true;

  const text = el.textContent?.trim() ?? "";
  if (!ARXIV_PERMISSION_NOTICE_RE.test(text)) return false;
  if (matchesOrClosest(el, ".ltx_section, .ltx_abstract")) return false;

  return el.matches("p.ltx_align_center") && el.closest(".ltx_para") !== null;
}

function isScienceDirectDuplicateCopy(el: Element): boolean {
  if (el.tagName === "TABLE") return false;
  if (el.closest("figcaption, caption")) return false;
  if (!matchesOrClosest(el, ".figure, .tables")) return false;
  // ScienceDirect renders duplicate expanded figure/table copies as plain
  // <div class="figure"><p>...</p></div> or <div class="tables"><p>...</p></div>
  // wrappers alongside real <figure><figcaption> and <table> elements.
  return !el.closest("figure") || el.matches(".figure p, .figure div[id^='p'], .tables p, .tables div[id^='p']");
}

export const JOURNAL_PROFILES: JournalProfile[] = [
  {
    hostPattern: /nature\.com/,
    selectors: [
      "article .c-article-body.main-content > p",
      "article.c-article-body section p",
      "article .article-body section p",
      "div.c-article-section__content p",
    ],
    skipSelectors: [
      "#references p",
      ".c-article-references p",
      ".c-article-references__container p",
      "[id^='Bib'][id$='-section'] p",
      "section[data-title='References'] p",
      "section[data-title='Bibliography'] p",
      "section[data-title='Author information'] p",
      "section[data-title='Ethics declarations'] p",
      ".c-article-table tbody p",
      "nav p", "header p", "footer p",
    ],
    readingSkipSelectors: [
      "#references",
      ".c-article-references",
      ".c-article-references__container",
      "[id^='Bib'][id$='-section']",
      "section[data-title='References']",
      "section[data-title='Bibliography']",
      "section[data-title='Author information']",
      "section[data-title='Ethics declarations']",
      ".c-article-table tbody p",
      ".c-article-section__figure-link",
      "[data-track-component='figure-link']",
      ".c-reading-companion",
      ".c-pdf-download",
      ".c-article-share-box",
      ".c-article-metrics-bar",
      ".c-article-subject-list",
      ".c-article-info-details",
      ".c-article-extras",
      ".c-article-recommendations",
      ".c-article-rights",
      "[data-test='article-metrics']",
      "[data-test='rights-and-permissions']",
      "[data-test='citation-section']",
      "[data-component='article-recommendations']",
    ],
    captionSelectors: ["figcaption p", ".c-article-table caption"],
  },
  {
    hostPattern: /wiley\.com|onlinelibrary\.wiley\.com/,
    selectors: [
      "#article__body p",
      ".article-section__content p",
      "div.paragraph-element > p",
      "div.paragraph-element",
    ],
    skipSelectors: [
      ".article-section--references p",
      ".article-section--references div.paragraph-element",
      "nav p", "header p", "footer p",
    ],
    readingSkipSelectors: [
      ".article-section--references",
      ".article-header__references-container",
      ".loa-wrapper",
      ".epub-section",
      ".article-citation",
      ".article__toc",
      ".article-row-right",
    ],
    captionSelectors: ["figcaption p"],
  },
  {
    hostPattern: /sciencedirect\.com/,
    selectors: [
      "#abstracts .abstract div[id^='spara']",
      ".Abstracts .abstract div[id^='spara']",
      ".abstract div[id^='spara']",
      "#body div.u-margin-s-bottom[id^='p']",
      ".Body div.u-margin-s-bottom[id^='p']",
      "#body div.u-margin-s-bottom > div[id^='p']",
      ".Body div.u-margin-s-bottom > div[id^='p']",
      "#body section[id^='sec'] div[id^='p']",
      ".Body section[id^='sec'] div[id^='p']",
      "#abstracts div[id^='abspara']",
      ".Abstracts div[id^='abspara']",
      ".abstract div[id^='abspara']",
      "section[id^='abst'] div[id^='abspara']",
      ".section-paragraph",
      "#body section[id^='sec'] > p",
      ".Body section[id^='sec'] > p",
    ],
    skipSelectors: [
      ".reference-links p",
      ".reference-links",
      ".author-group p",
      ".AuthorGroups",
      ".RelatedArticles",
      ".recommended-articles",
      ".sticky-table-of-contents",
      "#reading-assistant-container",
      "#issue-navigation",
      ".figure p",
      ".figure div[id^='p']",
      ".tables p",
      ".tables div[id^='p']",
      ".captions p",
      ".captions div[id^='p']",
      "#coi0001 div[id^='p']",
      "#ack0001 div[id^='p']",
      "#refdata001 div[id^='p']",
      ".Appendices div[id^='p']",
      "#bibliography p",
      "#bibliography div[id^='p']",
      "#references p",
      "#references div[id^='p']",
      "section[id^='bib'] p",
      "section[id^='bib'] div[id^='p']",
      ".bibliography p",
      ".bibliography div[id^='p']",
      "nav p", "header p", "footer p",
    ],
    readingSkipSelectors: [
      ".reference-links",
      ".author-group",
      ".AuthorGroups",
      ".RelatedArticles",
      ".recommended-articles",
      ".sticky-table-of-contents",
      "#reading-assistant-container",
      "#issue-navigation",
      "#coi0001",
      "#ack0001",
      "#refdata001",
      "#bibliography",
      "#references",
      "section[id^='bib']",
      ".bibliography",
    ],
    readingSkipPredicate: isScienceDirectDuplicateCopy,
  },
  {
    hostPattern: /researchgate\.net/,
    selectors: [
      "main article p",
      "article p",
      "[data-testid*='publication'] p",
      "[class*='publication'] p",
      ".nova-legacy-e-text p",
    ],
    skipSelectors: [
      "[class*='reference'] p",
      "[class*='citation'] p",
      "[class*='recommend'] p",
      "[class*='comment'] p",
      "[class*='profile'] p",
      "[class*='metric'] p",
      "[class*='share'] p",
      "nav p", "header p", "footer p",
    ],
    readingSkipSelectors: [
      "[class*='reference']",
      "[class*='citation']",
      "[class*='recommend']",
      "[class*='comment']",
      "[class*='profile']",
      "[class*='metric']",
      "[class*='share']",
    ],
    captionSelectors: [
      "p[id^='spara']",
      "figcaption p",
      "[class*='figure'] p",
      "[class*='caption'] p",
    ],
  },
  {
    hostPattern: /pubs\.aip\.org|aip\.scitation\.org/,
    selectors: [
      ".widget-ArticleFulltext .article-section-wrapper > .abstract p",
      ".widget-ArticleFulltext .article-section-wrapper > .abstractInFull p",
      ".widget-ArticleFulltext .article-section-wrapper > p",
      ".widget-ArticleFulltext .abstract p",
      ".hlFld-Abstract .abstractSection p",
      ".article__abstract .abstractSection p",
      ".abstractSection p",
      ".hlFld-Fulltext .NLM_p",
      ".article__body .NLM_p",
      ".article-body .NLM_p",
      ".NLM_sec .NLM_p",
      ".hlFld-Fulltext p",
      ".article__body p",
    ],
    skipSelectors: [
      ".paywall .NLM_p",
      ".paywall p",
      "figshare-widget .NLM_p",
      "figshare-widget p",
      "[class*='figshare'] .NLM_p",
      "[class*='figshare'] p",
      ".fig-modal .NLM_p",
      ".fig-modal p",
      ".article-references .NLM_p",
      ".article-references p",
      ".references .NLM_p",
      ".references p",
      ".NLM_ref-list .NLM_p",
      ".NLM_ref-list p",
      "[class*='reference'] .NLM_p",
      "[class*='reference'] p",
      "[class*='citation'] .NLM_p",
      "[class*='citation'] p",
      ".author-info .NLM_p",
      ".author-info p",
      ".related-content .NLM_p",
      ".related-content p",
      ".article-metrics .NLM_p",
      ".article-metrics p",
      "nav .NLM_p", "header .NLM_p", "footer .NLM_p",
      "nav p", "header p", "footer p",
    ],
    readingSkipSelectors: [
      ".paywall",
      "figshare-widget",
      "[class*='figshare']",
      ".fig-modal",
      ".article-references",
      ".references",
      ".NLM_ref-list",
      "[class*='reference']",
      "[class*='citation']",
      ".author-info",
      ".related-content",
      ".article-metrics",
    ],
    captionSelectors: [
      ".widget-ArticleFulltext .fig-section .fig-caption p",
      ".widget-ArticleFulltext .fig-section .caption p",
      ".widget-ArticleFulltext figure figcaption p",
      ".hlFld-Fulltext .NLM_caption .NLM_p",
      ".hlFld-Fulltext .NLM_caption p",
      ".article__body .NLM_caption .NLM_p",
      ".article__body .NLM_caption p",
    ],
  },
  {
    hostPattern: /pubs\.rsc\.org/,
    selectors: [
      "div.abstract p",
      "p.otherpara",
    ],
    skipSelectors: [
      "p.header_text",
      "p.bold.italic",
      "table td p",
      ".references p",
      ".article-reference p",
      "nav p", "header p", "footer p",
    ],
    readingSkipSelectors: [
      "p.header_text",
      "p.bold.italic",
      "table td p",
      ".references",
      ".article-reference",
    ],
    captionSelectors: [
      "figcaption p",
      ".image_table p",
      ".graphic_title p",
    ],
  },
  {
    hostPattern: /journals\.plos\.org/,
    selectors: [
      "#artText .abstract-content p",
      "#artText .section p",
    ],
    skipSelectors: [
      "#artText .articleinfo p",
      "#artText .references p",
      "#references p",
      "[id^='author-meta'] p",
      "#author-list p",
      ".author-info p",
      "nav p", "header p", "footer p",
    ],
    readingSkipSelectors: [
      "#artText .articleinfo",
      ".articleinfo",
      "#artText .references",
      "#references",
      "[id^='author-meta']",
      "#author-list",
      ".author-info",
    ],
    captionSelectors: [
      "#artText figcaption p",
      "#artText .figure p",
    ],
  },
  {
    hostPattern: /ncbi\.nlm\.nih\.gov/,
    selectors: ["#mc_main_content p", ".tsec p", "#__article_content p"],
    skipSelectors: [
      ".ref-list p", ".contrib-group p", ".table-wrap tbody p",
      "nav p", "header p", "footer p",
    ],
    readingSkipSelectors: [
      ".ref-list",
      ".contrib-group",
      ".table-wrap tbody p",
    ],
    captionSelectors: [".fig .caption p", ".table-wrap .caption p"],
  },
  {
    hostPattern: /arxiv\.org/,
    selectors: [
      ".ltx_abstract p",
      ".ltx_section .ltx_para p",
      ".ltx_section p",
    ],
    skipSelectors: [
      ".ltx_bibliography p",
      "dialog p",
      ".ltx_authors p",
      "nav p", "header p", "footer p",
    ],
    readingSkipSelectors: [
      ".ltx_bibliography",
      "dialog",
      ".ltx_authors",
      ".ltx_dates",
      ".ltx_page_navbar",
      ".ltx_page_footer",
      ".ltx_toc",
      ".ltx_TOC",
      ".ltx_equation",
      ".ltx_equationgroup",
      ".ltx_eqn_table",
    ],
    skipPredicate: isArxivPermissionNotice,
    readingSkipPredicate: isArxivPermissionNotice,
    captionSelectors: [".ltx_caption p"],
  },
  {
    hostPattern: /acs\.org/,
    selectors: [".article_content p", ".NLM_p > [role='paragraph']", ".NLM_p"],
    skipSelectors: [".article_references p", "nav p", "header p", "footer p"],
    readingSkipSelectors: [
      ".article_references",
      ".article_header-meta",
      ".article_header-authors",
      ".article_header-metrics",
      ".article_header-doi",
      ".citation-tools",
    ],
    captionSelectors: [".figure__caption p"],
  },
  {
    hostPattern: /springer\.com/,
    selectors: [".c-article-body p", "article .Para"],
    skipSelectors: ["section[data-title='References'] p", "nav p", "header p", "footer p"],
    readingSkipSelectors: [
      "section[data-title='References']",
      ".c-article-references",
      ".c-article-references__container",
      ".c-article-section__figure-link",
      "[data-track-component='figure-link']",
      ".c-reading-companion",
      ".c-pdf-download",
      ".c-article-share-box",
      ".c-article-metrics-bar",
      ".c-article-subject-list",
      ".c-article-info-details",
      ".c-article-extras",
      ".c-article-recommendations",
      ".c-article-rights",
    ],
    captionSelectors: ["figcaption p"],
  },
  {
    hostPattern: /ieee\.org/,
    selectors: [
      // IEEE Xplore abstract and full-text viewers. Keep these specific;
      // broad content selectors pick up recommendations and footer text.
      "xpl-document-abstract div.abstract-text-content",
      ".document-abstract div.abstract-text-content",
      ".abstract-text div.abstract-text-content",
      ".section p",
      "div.section p",
      "#article-body p",
      ".article-content p",
      ".document-main-content-container p",
    ],
    skipSelectors: [
      ".reference-container p",
      ".references p",
      "[class*='reference'] p",
      ".author-info p",
      ".document-main-right-trail-content p",
      ".document-sidebar p",
      ".stats-document-abstract-doi p",
      ".stats-document-abstract-publishedIn p",
      ".header-rel-art p",
      ".header-rel-art-pub",
      "nav p", "header p", "footer p",
    ],
    readingSkipSelectors: [
      ".reference-container",
      ".references",
      "[class*='reference']",
      ".author-info",
      ".document-main-right-trail-content",
      ".document-sidebar",
      ".stats-document-abstract-doi",
      ".stats-document-abstract-publishedIn",
      ".header-rel-art",
      ".header-rel-art-pub",
    ],
    captionSelectors: [".figcaption p", "figcaption p"],
  },
  {
    hostPattern: /science\.org/,
    selectors: [
      "#bodymatter [role='paragraph']",
      "section[property='articleBody'] [role='paragraph']",
      "#bodymatter p",
      "section[property='articleBody'] p",
    ],
    skipSelectors: [
      "#backmatter [role='paragraph']",
      "#core-collateral-info [role='paragraph']",
      "#core-collateral-metrics [role='paragraph']",
      "#core-collateral-fulltext-options [role='paragraph']",
      ".alert-signup__dropzone [role='paragraph']",
      ".references [role='paragraph']",
      "nav p", "header p", "footer p",
    ],
    readingSkipSelectors: [
      "#backmatter",
      "#core-collateral-info",
      "#core-collateral-metrics",
      "#core-collateral-fulltext-options",
      ".alert-signup__dropzone",
      ".references",
      ".core-authors",
      ".core-date-published",
      ".core-doi",
      ".article-tools",
    ],
    captionSelectors: [
      "#bodymatter figcaption p",
      "#bodymatter figcaption [role='paragraph']",
    ],
  },
  {
    hostPattern: /gartner\.com/,
    selectors: [
      ".cmp-globalsite-articletext .article-text .rte p",
      ".article-text .rte p",
      "section.Analysis div.para",
      "section.KeyFindings div.para",
    ],
    skipSelectors: [
      ".embedded-form p",
      ".form-heading p",
      ".privacy-policy p",
      ".privacyConsent p",
      ".consent-error-msg p",
      ".promoted-conference p",
      "form p",
      "nav p", "header p", "footer p",
    ],
    readingSkipSelectors: [
      ".embedded-form",
      ".form-heading",
      ".privacy-policy",
      ".privacyConsent",
      ".consent-error-msg",
      ".promoted-conference",
      "form",
    ],
    captionSelectors: [
      "section.Analysis .caption .heading",
    ],
  },
  {
    hostPattern: /(^|\.)frontiersin\.org$/i,
    selectors: [
      ".ArticleDetailsV4__main__content p",
      ".article-container p",
    ],
    skipSelectors: [
      ".ArticleLayoutHeader p",
      ".PeopleList p",
      ".AffiliationList p",
      ".ArticleMetrics p",
      ".NotifyMeBanner p",
      ".Summary p",
      ".CardA p",
      ".CardJournal p",
      "nav p", "header p", "footer p",
    ],
    readingSkipSelectors: [
      ".ArticleLayoutHeader",
      ".PeopleList",
      ".AffiliationList",
      ".ArticleMetrics",
      ".NotifyMeBanner",
      ".Summary",
      ".CardA",
      ".CardJournal",
    ],
    captionSelectors: ["figcaption p"],
  },
];

export const FALLBACK_PROFILE: JournalProfile = {
  hostPattern: /.*/,
  selectors: ["article p", "main p", ".content p", "[role='main'] p"],
  skipSelectors: ["nav p", "header p", "footer p", ".sidebar p", ".comments p"],
  captionSelectors: ["figcaption p"],
};

const PROFILE_PARAGRAPH_TERMINAL_RE =
  /(?:\s+|>\s*)(?:p|\[role\s*=\s*(?:"paragraph"|'paragraph'|paragraph)\])\s*$/i;

export function getProfile(hostname = window.location.hostname): JournalProfile {
  return JOURNAL_PROFILES.find((p) => p.hostPattern.test(hostname)) ?? FALLBACK_PROFILE;
}

export function isProfileSkipped(el: Element, profile: JournalProfile): boolean {
  if (profile.skipPredicate?.(el)) return true;
  return profile.skipSelectors.some((sel) => {
    if (matchesOrClosest(el, sel)) return true;
    if (sel.endsWith(" p")) {
      return matchesOrClosest(el, sel.slice(0, -2));
    }
    return false;
  });
}

export function isProfileExcludedForReading(el: Element, profile: JournalProfile): boolean {
  if (profile === FALLBACK_PROFILE) return false;
  if (profile.readingSkipPredicate?.(el)) return true;
  const selectors = profile.readingSkipSelectors;
  if (!selectors || selectors.length === 0) return false;
  return selectors.some((sel) => matchesOrClosest(el, sel));
}

export function isInsideProfileExclusionScope(
  element: Element,
  profile: JournalProfile,
): boolean {
  return profile.skipSelectors.some((selector) => {
    const terminal = PROFILE_PARAGRAPH_TERMINAL_RE.exec(selector);
    if (!terminal) return false;
    const scopeSelector = selector.slice(0, terminal.index).trim();
    return scopeSelector.length > 0 && matchesOrClosest(element, scopeSelector);
  });
}
