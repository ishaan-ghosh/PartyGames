import { devices, expect, test, type Browser, type Page } from "@playwright/test";

async function joinPhone(browser: Browser, code: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  await page.goto(`/room/${code}`);
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("join-submit").click();
  await expect(page.getByTestId("phone-lobby")).toBeVisible();
  return page;
}

async function inkedPixels(page: Page): Promise<number> {
  return page.getByTestId("screen-canvas").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    // Count only opaque, non-white pixels: an unpainted (transparent) canvas must not count as ink.
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 255 && (d[i]! < 250 || d[i + 1]! < 250 || d[i + 2]! < 250)) n++;
    }
    return n;
  });
}

test("screen + 3 phones play a turn, and a reloaded phone keeps its score", async ({ browser }) => {
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto("/");
  await screen.getByTestId("host-screen").click();
  const code = (await screen.getByTestId("room-code").innerText()).trim();
  expect(code).toMatch(/^[A-Z]{4}$/);

  const ana = await joinPhone(browser, code, "Ana");
  const ben = await joinPhone(browser, code, "Ben");
  const cy = await joinPhone(browser, code, "Cy");
  await expect(screen.getByTestId("lobby-player")).toHaveCount(3);

  await screen.getByTestId("start-game").click();

  // Ana joined first, so she draws first.
  await ana.getByTestId("word-choice").first().click();
  const word = (await ana.getByTestId("secret-word").innerText()).trim();

  const box = (await ana.getByTestId("draw-canvas").boundingBox())!;
  await ana.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await ana.mouse.down();
  for (let i = 1; i <= 12; i++) await ana.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * (0.2 + i * 0.04));
  await ana.mouse.up();
  await expect.poll(() => inkedPixels(screen), { timeout: 5000 }).toBeGreaterThan(200);

  // Ben's correct guess scores but its text never appears on the screen feed.
  await ben.getByTestId("guess-input").fill(word);
  await ben.getByTestId("guess-input").press("Enter");
  await expect(screen.getByTestId("score-Ben")).not.toHaveText("0");
  await expect(screen.locator(".dd-feed")).not.toContainText(word);
  // Nor on any phone feed: not the other guesser's, nor Ben's own. (Ana is drawing, so her phone has no feed.)
  // Wait for each phone to receive the correct-guess update before checking for absence.
  await expect(cy.locator(".dd-feed")).toContainText("Ben guessed it!");
  await expect(cy.locator(".dd-feed")).not.toContainText(word);
  await expect(ben.locator(".dd-feed")).toContainText("Ben guessed it!");
  await expect(ben.locator(".dd-feed")).not.toContainText(word);

  await cy.getByTestId("guess-input").fill(word);
  await cy.getByTestId("guess-input").press("Enter");
  await expect(screen.getByTestId("reveal")).toContainText(word);
  await expect(screen.getByTestId("score-Ana")).toHaveText("200");

  const benScore = await screen.getByTestId("score-Ben").innerText();
  await ben.reload();
  await expect(ben.getByTestId("my-score")).toHaveText(benScore);
  // The reloaded phone rejoined the game with its token: no lobby, no join form.
  await expect(ben.getByTestId("phone-lobby")).toHaveCount(0);
  await expect(ben.getByTestId("name-input")).toHaveCount(0);
  await expect(screen.getByTestId("lobby-player")).toHaveCount(0); // still in game, not lobby
});

test("phones-only: the host starts from a phone and guessers see the canvas", async ({ browser }) => {
  const host = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
  await host.goto("/");
  await host.getByTestId("host-phone").click();
  await host.getByTestId("name-input").fill("Host");
  await host.getByTestId("join-submit").click();
  await expect(host.getByTestId("phone-lobby")).toBeVisible();
  const code = new URL(host.url()).pathname.split("/").pop()!;

  const guest = await joinPhone(browser, code, "Guest");
  await host.getByTestId("start-game").click();

  await expect(host.getByTestId("word-choice")).toHaveCount(3);
  await expect(guest.getByTestId("phone-canvas")).toBeVisible();
});
