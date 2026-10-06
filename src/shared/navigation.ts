export function translationPageKey(href: string): string {
  try {
    const url = new URL(href);
    url.hash = "";
    return url.href;
  } catch {
    const hashIndex = href.indexOf("#");
    return hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  }
}

export function shouldResetTranslationForNavigation(previousHref: string, currentHref: string): boolean {
  return translationPageKey(previousHref) !== translationPageKey(currentHref);
}
