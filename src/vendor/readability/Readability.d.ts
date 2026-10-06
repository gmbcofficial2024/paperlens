interface ReadabilityOptions<TContent> {
  debug?: boolean;
  maxElemsToParse?: number;
  charThreshold?: number;
  serializer?: (element: Node) => TContent;
}

interface ReadabilityResult<TContent> {
  title: string;
  content: TContent | null | undefined;
  textContent: string;
  length: number;
  excerpt: string;
  byline: string | null;
  dir: string | null;
  siteName: string | null;
  lang: string | null;
  publishedTime: string | null;
}

declare class Readability<TContent = string> {
  constructor(document: Document, options?: ReadabilityOptions<TContent>);
  parse(): ReadabilityResult<TContent> | null;
}

export = Readability;
