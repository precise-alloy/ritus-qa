import BasePage from '../../commons/BasePage';
import CommonPageUI from '../../page_interfaces/commons/CommonPageUI';

/**
 * Actions for elements shared across pages. Selectors live in CommonPageUI.
 */
export default class CommonPage extends BasePage {
  async acceptCookieBanner() {
    if (await this.isElementVisible(CommonPageUI.ACCEPT_ALL_COOKIES_BUTTON)) {
      await this.clickToElement(CommonPageUI.ACCEPT_ALL_COOKIES_BUTTON);
    }
  }

  async fillHeaderSearch(text: string) {
    await this.fillElement(CommonPageUI.HEADER_SEARCH_TEXTBOX, text);
  }
}
