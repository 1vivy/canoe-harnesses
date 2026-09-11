export type Platform = "linux" | "windows" | "android"
export type Hook = { argv: string[]; cwd?: string; env?: Record<string, string>; timeoutMs?: number }
export type TargetProfile = {
  schemaVersion: 1
  id: string
  platform: Platform
  control: { kind: "local" } | { kind: "ssh"; host: string; user: string; key: string; port?: number } |
    { kind: "adb"; serial: string; expectedDevice?: string; rootManagerPackage?: string; /** Legacy root-provider field. */ managerPackage?: string; kernelVersion?: string }
  browser?: { cdpEndpoint: string; urlPattern?: string } | { url: string; executablePath?: string; headless?: boolean }
  qemu?: { container: string }
  application?: { url?: string; executable?: string; moduleZip?: string; moduleId?: string; webuiPackage?: string; webuiVersionCode?: number; consentIdentity?: string }
  /** Only provision invokes provision/stage/setup. Attach never invokes hooks. */
  hooks?: Partial<Record<"provision" | "stage" | "setup" | "reset" | "logs" | "capture" | "close", Hook>>
}
export type SessionRecord = {
  id: string; pid: number; platform: Platform; profileId: string; profilePath: string
  url: string; token: string; started: string; evidenceDir: string; stateRoot: string
}
export type Interaction =
  | { kind: "launch" }
  | { kind: "click"; selector: string }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "press"; key: string }
  | { kind: "navigate"; url: string }
  | { kind: "evaluate"; expression: string }
  | { kind: "command"; command: string; root?: boolean }
  | { kind: "android-key"; key: string }
  | { kind: "android-tap"; x: number; y: number }
  | { kind: "android-text"; text: string }
  | { kind: "android-hierarchy" }
  | { kind: "android-webview"; package: string; process?: string; urlPattern?: string }
  | { kind: "qemu"; argv: string[] }
  | { kind: "qemu-monitor"; command: string }
  | { kind: "windows-consent"; accept: boolean }
export type Command = "observe" | "interact" | "capture" | "logs" | "reset" | "close"
export type SessionClient = {
  readonly record: SessionRecord
  observe(): Promise<unknown>
  interact(action: Interaction): Promise<unknown>
  capture(): Promise<unknown>
  logs(): Promise<unknown>
  reset(): Promise<unknown>
  close(): Promise<unknown>
}
