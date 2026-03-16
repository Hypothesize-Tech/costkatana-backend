declare module 'sanitize-html' {
  interface SanitizeHtmlOptions {
    allowedTags?: string[] | Record<string, string[]>;
    allowedAttributes?: Record<string, string[]>;
    disallowedTagsMode?: 'discard' | 'escape' | 'recursiveEscape';
  }
  function sanitizeHtml(html: string, options?: SanitizeHtmlOptions): string;
  export = sanitizeHtml;
}
