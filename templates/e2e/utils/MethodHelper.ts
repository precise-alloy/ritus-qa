import { Page } from '@playwright/test';
import globalENV from '../config.env';
import CommonPageUI from '../page_interfaces/commons/CommonPageUI';

export default class MethodHelper {
  static async clickToAcceptCookieButton(page: Page) {
    if (globalENV.HAS_COOKIE_BANNER) {
      await page.click(CommonPageUI.ACCEPT_ALL_COOKIES_BUTTON);
      await MethodHelper.sleepInSeconds(2);
    }
  }

  static sleepInSeconds(seconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  static sleepInMiliSeconds(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  static getHostName(page: Page): Promise<string> {
    return page.evaluate(() => 'https://' + location.hostname);
  }

  static async getTextOfAllElements(page: Page, locator: string): Promise<string[]> {
    const elements = await page.locator(locator).all();
    const texts: string[] = [];
    for (const el of elements) {
      texts.push(await el.innerText());
    }
    return texts;
  }
}
