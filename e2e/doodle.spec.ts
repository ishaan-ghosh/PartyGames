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

/** Bounding box of the ink on a canvas, in its 960×540 backing-store pixels. */
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

// Phones held sideways: 16:9 (iPhone SE, word strip above the canvas) and long (iPhone 13/14,
// word in the rail beside a full-height canvas).
for (const viewport of [{ width: 667, height: 375 }, { width: 844, height: 390 }]) {
  test(`phones-only: a sideways drawer at ${viewport.width}×${viewport.height} gets a big canvas, sees guesses, and its strokes reach guessers`, async ({ browser, browserName }) => {
    // The drawer gets the landscape layout, not a "rotate" overlay.
    const phone = browserName === "webkit" ? devices["iPhone 13"] : devices["Pixel 7"];
    const host = await (await browser.newContext({ ...phone, viewport })).newPage();
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

    // The canvas fills (nearly) the whole height, at 16:9.
    const canvas = host.getByTestId("draw-canvas");
    const box = (await canvas.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(0.85 * viewport.height);
    expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    // The feed (beside the canvas, or a strip above it) never covers the canvas, and has room for a line.
    const feed = host.locator(".dd-phone-draw .dd-feed");
    await expect(feed).toBeVisible();
    const feedBox = (await feed.boundingBox())!;
    expect(feedBox.x >= box.x + box.width || feedBox.y + feedBox.height <= box.y).toBe(true);
    expect(feedBox.height).toBeGreaterThanOrEqual(24);
    // So does the word.
    const wordBox = (await host.locator(".dd-secret").boundingBox())!;
    expect(wordBox.x >= box.x + box.width || wordBox.y + wordBox.height <= box.y).toBe(true);
    // The host bar would cover the canvas, so it's tucked away until the panel opens.
    await expect(host.getByTestId("host-skip")).toBeHidden();

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
    // i.e. (192, 108)–(768, 367) on the 960×540 bitmap, give or take the 9px brush.
    const ink = await inkBounds(host, "draw-canvas");
    for (const [got, want] of [[ink.minX, 192], [ink.maxX, 768], [ink.minY, 108], [ink.maxY, 367]] as const) {
      expect(Math.abs(got - want)).toBeLessThanOrEqual(10);
    }
    // The sideways drawer stays in normal flow, one viewport tall, like the portrait one: iOS Safari
    // can hit-test touches on a position: fixed layer away from where it paints it, which drew
    // strokes a constant distance below the finger. Nor may any ancestor of the canvas be transformed.
    const layout = await host.evaluate(() => {
      const ancestors: Element[] = [];
      for (let el = document.querySelector("[data-testid=draw-canvas]"); el; el = el.parentElement) ancestors.push(el);
      return {
        position: getComputedStyle(document.querySelector(".dd-phone-draw")!).position,
        fixedOrTransformed: ancestors
          .filter((el) => {
            const cs = getComputedStyle(el);
            return cs.position === "fixed" || cs.transform !== "none" || cs.translate !== "none";
          })
          .map((el) => el.className),
        overflow: document.documentElement.scrollHeight - window.innerHeight,
      };
    });
    expect(layout.position).not.toBe("fixed");
    expect(layout.fixedOrTransformed).toEqual([]);
    expect(layout.overflow).toBeLessThanOrEqual(0);

    // Colours and tools pull out from the rail; the host controls come with them.
    const toggle = host.getByTestId("tools-toggle");
    const toggleBox = (await toggle.boundingBox())!;
    expect(toggleBox.x).toBeGreaterThanOrEqual(box.x + box.width);
    expect(toggleBox.width).toBeGreaterThanOrEqual(44);
    expect(toggleBox.height).toBeGreaterThanOrEqual(44);
    const red = host.getByRole("radio", { name: "Red" });
    await expect(red).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(red).toBeVisible();
    await expect(host.getByTestId("host-skip")).toBeVisible();
    const panel = (await host.getByTestId("tools-panel").boundingBox())!;
    const skip = (await host.getByTestId("host-skip").boundingBox())!;
    expect(skip.x).toBeGreaterThanOrEqual(panel.x);
    expect(skip.x + skip.width).toBeLessThanOrEqual(panel.x + panel.width);
    const redBox = (await red.boundingBox())!;
    expect(redBox.height).toBeGreaterThanOrEqual(44);
    // Picking a colour closes the panel (it lies over the canvas's edge).
    await red.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(red).toBeHidden();
    await expect(host.locator(".dd-toggle-swatch")).toHaveCSS("background-color", "rgb(239, 68, 68)");
    // A tap on the drawing while the panel is out closes it without drawing a dot.
    await toggle.click();
    await expect(red).toBeVisible();
    const before = await inkedPixels(host, "draw-canvas");
    await host.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.9);
    await expect(red).toBeHidden();
    expect(await inkedPixels(host, "draw-canvas")).toBe(before);

    // Keyboard: the toggle opens the panel into its first control, and Escape hands focus back.
    await toggle.focus();
    await host.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(host.getByRole("radio", { name: "Black" })).toBeFocused();
    await host.keyboard.press("Escape");
    await expect(red).toBeHidden();
    await expect(toggle).toBeFocused();
    // Picking from the keyboard closes the panel without dropping focus to the page.
    await host.keyboard.press("Enter");
    await host.keyboard.press("Tab");
    await host.keyboard.press("Enter");
    await expect(red).toBeHidden();
    await expect(toggle).toBeFocused();

    // Escape in the Players dialog (opened from the panel's host bar) closes only the dialog.
    await toggle.click();
    await host.getByTestId("host-players").click();
    const dialog = host.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await host.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(host.getByTestId("host-players")).toBeVisible();
    await expect(host.getByTestId("host-players")).toBeFocused();
    // A second Escape closes the panel, and focus leaves the hidden host bar for the toggle.
    await host.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(host.getByTestId("host-skip")).toBeHidden();
    await expect(toggle).toBeFocused();
  });
}

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
