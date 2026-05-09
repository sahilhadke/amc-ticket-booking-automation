import { Page, Locator } from 'patchright';

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function humanType(locator: Locator, text: string): Promise<void> {
  await locator.click();
  await sleep(rand(200, 400));
  // Triple-click to select all existing content, then delete it
  await locator.click({ clickCount: 3 });
  await locator.page().keyboard.press('Delete');
  await sleep(rand(100, 200));
  for (const char of text) {
    await locator.pressSequentially(char, { delay: rand(60, 160) });
    if (Math.random() < 0.08) await sleep(rand(200, 500));
  }
  await sleep(rand(100, 300));
}

export async function humanClick(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  if (box) {
    // Move to a slightly random point within the element
    const x = box.x + box.width  * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.3 + Math.random() * 0.4);
    await page.mouse.move(x, y, { steps: rand(8, 20) });
    await sleep(rand(80, 200));
  }
  await locator.click();
  await sleep(rand(150, 400));
}
