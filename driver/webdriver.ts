import { installConsoleCapture, installDialogStubs, readConsoleErrors, TESTID_SELECTOR } from "./dom"
import type { Driver } from "./types"

/**
 * A minimal W3C WebDriver client with consumer-supplied capabilities.
 * WebKitGTK does not speak the Chrome DevTools Protocol, so this is the one
 * transport the Linux tier can use. Only what the `Driver` interface needs.
 */
type Session = { readonly id: string; readonly base: string }

async function call<T>(session: Session | { readonly base: string }, method: string, path: string, body?: unknown): Promise<T> {
  const url = "id" in session ? `${session.base}/session/${session.id}${path}` : `${session.base}${path}`
  if (process.env["CANOE_E2E_TRACE"]) console.log(`webdriver ${method} ${url}`)
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(60_000),
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json = (await response.json()) as { value: T & { error?: string; message?: string } }
  if (!response.ok || (json.value !== null && typeof json.value === "object" && "error" in json.value && json.value.error !== undefined)) {
    throw new Error(`webdriver ${method} ${path}: ${json.value?.error ?? response.status} ${json.value?.message ?? ""}`)
  }
  return json.value
}

export type WebDriverLaunch = {
  /** tauri-driver's listen address, e.g. http://127.0.0.1:4444 */
  readonly base: string
  /** Absolute path of the app binary inside the toolkit layout. */
  readonly capabilities: Readonly<Record<string, unknown>>
  readonly args?: readonly string[]
  readonly timeoutMs?: number
}

export async function connectWebDriver(launch: WebDriverLaunch): Promise<Driver> {
  const deadline = Date.now() + (launch.timeoutMs ?? 60_000)
  let session: Session | undefined
  let lastError: unknown
  while (session === undefined) {
    try {
      const created = await call<{ sessionId: string }>({ base: launch.base }, "POST", "/session", {
        capabilities: { alwaysMatch: launch.capabilities },
      })
      session = { id: created.sessionId, base: launch.base }
    } catch (error) {
      lastError = error
      if (Date.now() > deadline) throw new Error(`WebDriver at ${launch.base} did not start a session: ${String(lastError)}`)
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }
  const s = session
  const execute = async <T>(fn: (...args: never[]) => T, ...args: unknown[]): Promise<T> =>
    call<T>(s, "POST", "/execute/sync", { script: `return (${fn.toString()}).apply(null, arguments)`, args })
  const find = async (testid: string): Promise<string> => {
    const element = await call<Record<string, string>>(s, "POST", "/element", { using: "css selector", value: TESTID_SELECTOR(testid) })
    const id = Object.values(element)[0]
    if (id === undefined) throw new Error(`no element with data-testid ${testid}`)
    return id
  }
  await execute(installConsoleCapture)
  return {
    eval: (fn) => execute(fn),
    click: async (testid) => {
      const deadline = Date.now() + 15_000
      for (;;) {
        const id = await find(testid)
        if (await call<boolean>(s, "GET", `/element/${id}/enabled`)) {
          await call(s, "POST", `/element/${id}/click`, {})
          return
        }
        if (Date.now() > deadline) throw new Error(`${testid} stayed disabled`)
        await Bun.sleep(100)
      }
    },
    type: async (testid, text) => {
      const id = await find(testid)
      await call(s, "POST", `/element/${id}/clear`, {})
      await call(s, "POST", `/element/${id}/value`, { text })
    },
    text: async (testid) => call<string>(s, "GET", `/element/${await find(testid)}/text`),
    exists: (testid) => execute((id: string) => document.querySelector(`[data-testid="${id}"]`) !== null, testid),
    waitFor: async ({ testid, text, timeoutMs }) => {
      const until = Date.now() + (timeoutMs ?? 30_000)
      for (;;) {
        try {
          const value = await call<string>(s, "GET", `/element/${await find(testid)}/text`)
          if (text === undefined || text.test(value)) return
        } catch {
          // not there yet
        }
        if (Date.now() > until) throw new Error(`${testid} did not appear${text === undefined ? "" : ` matching ${text}`}`)
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    },
    stubDialogs: (answers) => execute(installDialogStubs, answers),
    screenshot: async () => Uint8Array.from(Buffer.from(await call<string>(s, "GET", "/screenshot"), "base64")),
    consoleErrors: () => execute(readConsoleErrors),
    close: async () => {
      await call(s, "DELETE", "", undefined).catch(() => undefined)
    },
  }
}
