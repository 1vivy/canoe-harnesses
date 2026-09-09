/**
 * Page-side helpers shared by the CDP and WebDriver transports. Everything
 * here is serialised into the page, so it must not close over anything.
 */
export const TESTID_SELECTOR = (testid: string): string => `[data-testid="${testid}"]`

export function textOf(testid: string): string {
  const element = document.querySelector(`[data-testid="${testid}"]`)
  if (element === null) throw new Error(`no element with data-testid ${testid}`)
  return (element as HTMLElement).innerText
}

export function existsIn(testid: string): boolean {
  return document.querySelector(`[data-testid="${testid}"]`) !== null
}

export function installDialogStubs(answers: { readonly prompt?: string | null; readonly confirm?: boolean }): void {
  const w = window as unknown as Record<string, unknown>
  if (answers.prompt !== undefined) w["prompt"] = () => answers.prompt
  if (answers.confirm !== undefined) w["confirm"] = () => answers.confirm
  w["alert"] = () => undefined
}

/** Console errors captured by `installConsoleCapture`, read back by the driver. */
export function installConsoleCapture(): void {
  const w = window as unknown as { __canoeConsoleErrors?: string[] }
  if (w.__canoeConsoleErrors !== undefined) return
  const errors: string[] = []
  w.__canoeConsoleErrors = errors
  const original = console.error
  console.error = (...args: unknown[]) => {
    errors.push(args.map((arg) => (arg instanceof Error ? arg.stack ?? arg.message : String(arg))).join(" "))
    original.apply(console, args)
  }
  window.addEventListener("error", (event) => errors.push(String(event.message)))
  window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)))
}

export function readConsoleErrors(): string[] {
  return (window as unknown as { __canoeConsoleErrors?: string[] }).__canoeConsoleErrors ?? []
}
