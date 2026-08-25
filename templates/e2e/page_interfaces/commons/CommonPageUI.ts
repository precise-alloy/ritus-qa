/**
 * Selectors for elements shared across pages (header, footer, cookie banner...).
 * Static readonly strings; use %s as a placeholder for dynamic values.
 */
export default class CommonPageUI {
  static readonly ACCEPT_ALL_COOKIES_BUTTON = 'button#onetrust-accept-btn-handler';

  static readonly HEADER_SEARCH_TEXTBOX = 'input[type="search"]';

  static readonly HEADER_SEARCH_SUGGESTION = '//li[contains(@class, "suggestion")]//a[contains(text(), "%s")]';
}
