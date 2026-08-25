import { Locator, Page } from '@playwright/test';
import GlobalConstant from './GlobalConstant';

/**
 * Base wrapper around Playwright's Page. Page objects extend this and expose
 * domain actions; selectors live in the matching page_interfaces class.
 */
export default class BasePage {
  private mediumTimeout = GlobalConstant.mediumTimeout * 1000;

  private shortTimeout = GlobalConstant.shortTimeout * 1000;

  constructor(protected page: Page) {}

  /** Replaces each %s in the locator with the given values, in order. */
  protected getDynamicLocator(locator: string, ...dynamicValues: string[]) {
    return locator.replace(/%s/g, () => dynamicValues.shift() as string);
  }

  protected getElement(locator: string) {
    return this.page.locator(locator).first();
  }

  protected getDynamicElement(locator: string, ...dynamicValues: string[]) {
    return this.getElement(this.getDynamicLocator(locator, ...dynamicValues));
  }

  protected getAllElements(locator: string) {
    return this.page.locator(locator).all();
  }

  protected getElementByText(elementText: string) {
    return this.page.getByText(elementText).first();
  }

  protected async clickToElement(locator: string) {
    await this.getElement(locator).scrollIntoViewIfNeeded();
    await this.getElement(locator).click();
  }

  protected async clickToDynamicElement(locator: string, ...dynamicValues: string[]) {
    const dynamicLocator = this.getDynamicLocator(locator, ...dynamicValues);
    try {
      await this.getElement(dynamicLocator).scrollIntoViewIfNeeded();
      await this.getElement(dynamicLocator).click();
    } catch {
      throw new Error(`Element = "${dynamicLocator}" is unable to click or not found`);
    }
  }

  protected async fillElement(locator: string, text: string) {
    await this.getElement(locator).fill(text);
  }

  protected async fillDynamicElement(locator: string, text: string, ...dynamicValues: string[]) {
    await this.getDynamicElement(locator, ...dynamicValues).fill(text);
  }

  protected async waitForElementVisible(locator: string, timeout: number = this.mediumTimeout) {
    await this.page.waitForSelector(locator, { state: 'visible', strict: false, timeout });
  }

  protected async waitForDynamicElementVisible(locator: string, ...dynamicValues: string[]) {
    const dynamicLocator = this.getDynamicLocator(locator, ...dynamicValues);
    await this.page.waitForSelector(dynamicLocator, { state: 'visible', strict: false, timeout: this.mediumTimeout });
  }

  protected async waitForElementHidden(locator: string, timeout: number = this.mediumTimeout) {
    await this.page.waitForSelector(locator, { state: 'hidden', strict: false, timeout });
  }

  protected async isElementVisible(locator: string): Promise<boolean> {
    return this.getElement(locator).isVisible({ timeout: this.shortTimeout });
  }

  protected getPageUrl(): string {
    return this.page.url();
  }

  protected getPageTitle(): Promise<string> {
    return this.page.title();
  }

  protected async getElementText(locator: string): Promise<string> {
    return this.getElement(locator).innerText();
  }

  protected async getInputValue(locator: string): Promise<string> {
    return this.getElement(locator).inputValue();
  }

  protected async getSelectedOption(dropdownLocator: Locator): Promise<string> {
    return dropdownLocator.evaluate((dropdown) => {
      const el = dropdown as HTMLSelectElement;
      return el.options[el.selectedIndex].innerText;
    });
  }

  protected async redirectToURL(url: string) {
    await this.page.goto(url);
  }

  protected async waitForPageLoad(maxRetries = 3) {
    try {
      await this.page.waitForSelector('html', { state: 'attached' });
      await this.page.waitForLoadState('domcontentloaded');
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        if ((await this.page.evaluate(() => document.readyState)) === 'complete') return;
        await this.page.waitForTimeout(500);
      }
      console.warn('Page did not reach "complete" status within retries');
    } catch (error) {
      console.log('Error waiting for page load: ', error);
    }
  }

  protected async pressButton(buttonName: string) {
    await this.page.keyboard.press(buttonName);
  }
}
