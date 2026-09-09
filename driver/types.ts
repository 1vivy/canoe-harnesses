/**
 * What a spec may do to the running app and to the guest it runs in. Specs
 * are written once against these two interfaces; each platform supplies a
 * `Host`, and the host hands out a `Driver` for the app window it launched.
 */
export interface Driver {
  /** Evaluate a function in the page. The result must be JSON-serialisable. */
  eval<T>(fn: () => T): Promise<T>
  /** A trusted native click (file pickers and prompts only open on real input events). */
  click(testid: string): Promise<void>
  type(testid: string, text: string): Promise<void>
  text(testid: string): Promise<string>
  exists(testid: string): Promise<boolean>
  waitFor(options: { readonly testid: string; readonly text?: RegExp; readonly timeoutMs?: number }): Promise<void>
  /** Replace window.prompt/confirm in the page for flow specs. The native-dialog contract is tested separately. */
  stubDialogs(answers: { readonly prompt?: string | null; readonly confirm?: boolean }): Promise<void>
  screenshot(name: string): Promise<Uint8Array>
  consoleErrors(): Promise<readonly string[]>
  close(): Promise<void>
}

