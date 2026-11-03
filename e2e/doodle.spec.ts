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

async function inkedPixels(page: Page, canvasTestId = "screen-canvas"): Promise<number> {
  return page.getByTestId(canvasTestId).evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    // Count only opaque, non-white pixels: an unpainted (transparent) canvas must not count as ink.
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 255 && (d[i]! < 250 || d[i + 1]! < 250 || d[i + 2]! < 250)) n++;
    }
    return n;
  });
}

/** Bounding box of the ink on a canvas, in its 800×600 backing-store pixels. */
async function inkBounds(page: Page, canvasTestId: string) {
  return page.getByTestId(canvasTestId).evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i + 3] === 255 && (d[i]! < 250 || d[i + 1]! < 250 || d[i + 2]! < 250)) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    return { minX, minY, maxX, maxY };
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

test("phones-only: a sideways drawer sees guesses beside the canvas and its strokes reach guessers", async ({ browser }) => {
  // A small phone held sideways: the drawer gets the landscape layout, not a "rotate" overlay.
  const host = await (await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 667, height: 375 } })).newPage();
  await host.goto("/");
  await host.getByTestId("host-phone").click();
  await host.getByTestId("name-input").fill("Host");
  await host.getByTestId("join-submit").click();
  await expect(host.getByTestId("phone-lobby")).toBeVisible();
  const code = new URL(host.url()).pathname.split("/").pop()!;

  const guest = await joinPhone(browser, code, "Guest");
  await host.getByTestId("start-game").click();
  await host.getByTestId("word-choice").first().click();
  await expect(host.getByTestId("secret-word")).toBeVisible();
  await expect(host.getByTestId("rotate-hint")).toHaveCount(0);

  // The feed sits in the right-hand column, beside (not above) the canvas, with room for a line.
  const feed = host.locator(".dd-phone-draw .dd-feed");
  await expect(feed).toBeVisible();
  const canvas = host.getByTestId("draw-canvas");
  const feedBox = (await feed.boundingBox())!;
  const box = (await canvas.boundingBox())!;
  expect(feedBox.x).toBeGreaterThanOrEqual(box.x + box.width);
  expect(feedBox.height).toBeGreaterThanOrEqual(24);

  // A wrong guess from the other phone shows up in the drawer's feed.
  await guest.getByTestId("guess-input").fill("blorptastic");
  await guest.getByTestId("guess-input").press("Enter");
  await expect(feed).toContainText("Guest: blorptastic");

  // A stroke on the sideways canvas reaches the guesser's canvas.
  await expect(guest.getByTestId("phone-canvas")).toBeVisible();
  await host.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await host.mouse.down();
  for (let i = 1; i <= 12; i++) await host.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * (0.2 + i * 0.04));
  await host.mouse.up();
  await expect.poll(() => inkedPixels(guest, "phone-canvas"), { timeout: 5000 }).toBeGreaterThan(200);

  // The ink lands under the pointer: the stroke ran from (0.2, 0.2) to (0.8, 0.68) of the canvas,
  // i.e. (160, 120)–(640, 408) on the 800×600 bitmap, give or take the 10px brush.
  const ink = await inkBounds(host, "draw-canvas");
  for (const [got, want] of [[ink.minX, 160], [ink.maxX, 640], [ink.minY, 120], [ink.maxY, 408]] as const) {
    expect(Math.abs(got - want)).toBeLessThanOrEqual(10);
  }
  // The sideways drawer stays in normal flow, one viewport tall, like the portrait one: iOS Safari
  // can hit-test touches on a position: fixed layer away from where it paints it, which drew
  // strokes a constant distance below the finger.
  const layout = await host.evaluate(() => ({
    position: getComputedStyle(document.querySelector(".dd-phone-draw")!).position,
    overflow: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(layout.position).not.toBe("fixed");
  expect(layout.overflow).toBeLessThanOrEqual(0);
});

test("the host kicks players from the lobby and during a game", async ({ browser }) => {
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto("/");
  await screen.getByTestId("host-screen").click();
  const code = (await screen.getByTestId("room-code").innerText()).trim();

  const ana = await joinPhone(browser, code, "Ana");
  const ben = await joinPhone(browser, code, "Ben");
  const cy = await joinPhone(browser, code, "Cy");
  await expect(screen.getByTestId("lobby-player")).toHaveCount(3);
  // Only the host can kick: a guest's chips aren't buttons. Wait for Ana's lobby to list everyone
  // first, so the no-kick-button check isn't passing on a not-yet-rendered list.
  await expect(ana.getByTestId("lobby-player")).toHaveCount(3);
  await expect(ana.getByTestId("kick-Ben")).toHaveCount(0);

  // Lobby: tapping a chip asks first; Escape cancels and returns focus to the chip.
  await screen.getByTestId("kick-Cy").click();
  const confirm = screen.getByRole("dialog", { name: "Kick Cy?" });
  await expect(confirm).toBeVisible();
  await screen.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(screen.getByTestId("kick-Cy")).toBeFocused();

  await screen.getByTestId("kick-Cy").click();
  await screen.getByTestId("kick-confirm").click();
  await expect(screen.getByTestId("lobby-player")).toHaveCount(2);
  await expect(ana.getByTestId("lobby-player")).toHaveCount(2);
  await expect(cy.getByText("You were removed from the room.")).toBeVisible();

  // In game: the host bar's Players dialog.
  await screen.getByTestId("start-game").click();
  await expect(ana.getByTestId("word-choice")).toHaveCount(3);
  await screen.getByTestId("host-players").click();
  await expect(screen.getByRole("dialog", { name: "Players" })).toBeVisible();
  await screen.getByTestId("kick-Ben").click();
  await screen.getByTestId("kick-confirm").click();
  await expect(ben.getByText("You were removed from the room.")).toBeVisible();
  await expect(screen.getByTestId("kick-Ben")).toHaveCount(0);
});
