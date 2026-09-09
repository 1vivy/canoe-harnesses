import { chromium, type Browser, type Page } from "playwright-core"

import { installConsoleCapture, installDialogStubs, readConsoleErrors, TESTID_SELECTOR } from "./dom"
import type { Driver } from "./types"

/**
 * Chrome DevTools Protocol transport: WebView2 on Windows
 * (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=N) and the
 * Android WebView (adb forward to localabstract:webview_devtools_remote_<pid>).
 */
export async function connectCdp(endpoint: string, options: { readonly timeoutMs?: number; readonly urlPattern?: RegExp; readonly reload?: boolean } = {}): Promise<Driver> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000)
  let browser: Browser | undefined
  let lastError: unknown
  while (browser === undefined) {
    try {
      browser = await chromium.connectOverCDP(endpoint, { timeout: 5_000 })
    } catch (error) {
      lastError = error
      if (Date.now() > deadline) throw new Error(`CDP endpoint ${endpoint} did not answer: ${String(lastError)}`)
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }
  try {
    let page: Page | undefined
    while (page === undefined) {
      page = browser.contexts().flatMap((context) => context.pages())
        .find((candidate) => options.urlPattern === undefined || options.urlPattern.test(candidate.url()))
      if (page === undefined) {
        if (Date.now() > deadline) throw new Error(`CDP endpoint ${endpoint} exposes no matching page (${options.urlPattern ?? "any URL"})`)
        await Bun.sleep(250)
      }
    }
    // Playwright otherwise auto-dismisses JavaScript dialogs. Leave their
    // resolution to the real manager/OS UI (or explicitly requested stubs).
    page.on("dialog", () => {})
    await page.addInitScript(installConsoleCapture)
    await page.evaluate(installConsoleCapture)
    if (options.reload) await page.reload({ waitUntil: "domcontentloaded" })
    return pageDriver(page, async () => { await browser?.close() })
  } catch (error) {
    await browser.close()
    throw error
  }
}

export function pageDriver(page: Page, close: () => Promise<void>): Driver {
  return {
    eval: (fn) => page.evaluate(fn),
    click: async (testid) => {
      await page.click(TESTID_SELECTOR(testid), { timeout: 10_000 })
    },
    type: async (testid, text) => {
      await page.fill(TESTID_SELECTOR(testid), text, { timeout: 10_000 })
    },
    text: (testid) => page.innerText(TESTID_SELECTOR(testid), { timeout: 10_000 }),
    exists: async (testid) => (await page.$(TESTID_SELECTOR(testid))) !== null,
    waitFor: async ({ testid, text, timeoutMs }) => {
      const locator = page.locator(TESTID_SELECTOR(testid))
      await locator.first().waitFor({ state: "visible", timeout: timeoutMs ?? 30_000 })
      if (text !== undefined) {
        const deadline = Date.now() + (timeoutMs ?? 30_000)
        while (!text.test(await locator.first().innerText())) {
          if (Date.now() > deadline) throw new Error(`${testid} never matched ${text}: ${await locator.first().innerText()}`)
          await page.waitForTimeout(250)
        }
      }
    },
    stubDialogs: (answers) => page.evaluate(installDialogStubs, answers),
    screenshot: async () => new Uint8Array(await page.screenshot({ type: "png" })),
    consoleErrors: () => page.evaluate(readConsoleErrors),
    close,
  }
}
