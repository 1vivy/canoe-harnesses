import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium, type Browser, type Page } from "playwright-core"
import { sshExec } from "../hosts/common/ssh"
import { androidControl } from "../hosts/android/adb"
import { qemuControl } from "../hosts/windows/control"
import type { Hook, Interaction, TargetProfile } from "./types"

export class Target {
  private browser?: Browser
  private page?: Page
  private ownedBrowser = false
  private adbForward?: string
  private readonly android?: ReturnType<typeof androidControl>
  private readonly errors: string[] = []
  private readonly events: string

  constructor(readonly profile: TargetProfile, readonly evidenceDir: string, readonly profilePath: string) {
    mkdirSync(evidenceDir, { recursive: true, mode: 0o700 })
    this.events = join(evidenceDir, "events.jsonl")
    if (profile.control.kind === "adb") this.android = androidControl(profile.control.serial, join(evidenceDir, "adb.log"))
  }
  private event(kind: string, value: unknown) { appendFileSync(this.events, JSON.stringify({ time: new Date().toISOString(), kind, value }) + "\n") }
  private async local(argv: string[], options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}) {
    const process = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe", cwd: options.cwd, env: { ...globalThis.process.env, ...options.env } })
    let timeout = false
    const timer = setTimeout(() => { timeout = true; process.kill() }, options.timeoutMs ?? 30_000)
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
      if (timeout || code !== 0) throw new Error(`${argv[0]} ${timeout ? "timed out" : `exited ${code}`}: ${stderr || stdout}`)
      return stdout.trimEnd()
    } finally { clearTimeout(timer) }
  }
  async hook(name: NonNullable<TargetProfile["hooks"]> extends Partial<Record<infer K, Hook>> ? K : never) {
    const hook = this.profile.hooks?.[name]
    if (!hook) throw new Error(`No ${name} hook is configured; the harness will not infer product operations`)
    const result = await this.local(hook.argv, { ...hook, env: { ...hook.env,
      CANOE_HARNESS_PROFILE: this.profilePath, CANOE_HARNESS_EVIDENCE: this.evidenceDir,
      CANOE_HARNESS_TARGET: this.profile.id, CANOE_HARNESS_MODULE_ZIP: this.profile.application?.moduleZip ?? "",
      CANOE_HARNESS_MODULE_ID: this.profile.application?.moduleId ?? "",
      CANOE_HARNESS_EXECUTABLE: this.profile.application?.executable ?? "",
      CANOE_HARNESS_URL: this.profile.application?.url ?? "",
    } })
    this.event(`hook:${name}`, result)
    return result
  }
  async command(command: string, root = false): Promise<string> {
    const control = this.profile.control
    if (control.kind === "adb") return root ? this.android!.root(command) : this.android!.shell(command)
    if (root) throw new Error("root is only an explicit Android shell option; use the SSH profile's own authorization")
    if (control.kind === "ssh") {
      const result = await sshExec(control, command, { timeoutMs: 30_000 })
      if (result.code !== 0) throw new Error(`Guest command exited ${result.code}: ${result.stderr}`)
      return result.stdout.trimEnd()
    }
    return this.local([process.platform === "win32" ? "powershell.exe" : "sh", process.platform === "win32" ? "-Command" : "-c", command])
  }
  async attach() {
    const control = this.profile.control
    if (control.kind === "adb") {
      // Connecting a transport is allowed; changing a manager, booting a guest,
      // restarting adbd, and clearing data are deliberately absent here.
      await this.android!.adb(["connect", control.serial])
      const device = await this.android!.shell("getprop ro.product.device")
      if (!/^vsoc_[a-zA-Z0-9_]+$/.test(device) || (control.expectedDevice && device !== control.expectedDevice)) throw new Error(`Unexpected virtual Android target: ${device}`)
      if (await this.android!.shell("getprop sys.boot_completed") !== "1") throw new Error("Guest is not booted; attach does not boot it")
      if (control.managerPackage) {
        if (!/^[A-Za-z0-9_.]+$/.test(control.managerPackage)) throw new Error("Invalid manager package")
        const manager = await this.android!.shell(`pm path ${control.managerPackage}`)
        if (!manager.startsWith("package:")) throw new Error(`Manager ${control.managerPackage} is not installed`)
      }
      if (control.kernelVersion) {
        const version = await this.android!.root("/data/adb/ksud debug version")
        if (!version.includes(control.kernelVersion)) throw new Error(`Kernel differs from profile: ${version}`)
      }
    } else if (control.kind === "ssh") {
      await this.command(this.profile.platform === "windows" ? "$env:COMPUTERNAME" : "uname -s")
    }
    if (this.profile.browser && "cdpEndpoint" in this.profile.browser) await this.connectBrowser(this.profile.browser.cdpEndpoint, this.profile.browser.urlPattern)
    this.event("attached", { profile: this.profile.id, control: control.kind })
  }
  private installPage(page: Page) {
    this.page = page
    page.on("pageerror", error => this.errors.push(String(error)))
    page.on("console", message => { if (message.type() === "error") this.errors.push(message.text()) })
    // Explicit interactions own native dialog decisions. Do not auto-dismiss.
    page.on("dialog", () => {})
  }
  private async connectBrowser(endpoint: string, pattern?: string) {
    if (this.browser) throw new Error("A browser is already attached")
    this.browser = await chromium.connectOverCDP(endpoint, { timeout: 15_000 })
    const matching = this.browser.contexts().flatMap(context => context.pages()).filter(page => !pattern || new RegExp(pattern).test(page.url()))
    if (matching.length !== 1) { await this.browser.close(); this.browser = undefined; throw new Error(`Expected one page, found ${matching.length}; specify urlPattern`) }
    this.installPage(matching[0])
  }
  async observe() {
    const system = this.profile.control.kind === "adb"
      ? await this.command("getprop ro.product.device; getprop ro.build.fingerprint; getenforce; dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity' || true")
      : this.profile.control.kind === "ssh" ? await this.command(this.profile.platform === "windows" ? "Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version | ConvertTo-Json" : "uname -sr; hostname") : "local controller"
    const page = this.page ? { url: this.page.url(), title: await this.page.title(), text: (await this.page.locator("body").innerText()).slice(0, 40_000), errors: [...this.errors] } : null
    const result = { profile: this.profile.id, platform: this.profile.platform, system, page }
    this.event("observe", result)
    return result
  }
  async interact(action: Interaction): Promise<unknown> {
    this.event("interaction", action)
    switch (action.kind) {
      case "launch": {
        if (this.browser) throw new Error("Browser already attached")
        const spec = this.profile.browser
        if (!spec || !("url" in spec)) throw new Error("Launch requires a browser URL profile; native application launch belongs in explicit setup hooks")
        this.browser = await chromium.launch({ executablePath: spec.executablePath, headless: spec.headless ?? true })
        this.ownedBrowser = true
        const page = await this.browser.newPage()
        this.installPage(page)
        await page.goto(spec.url, { waitUntil: "domcontentloaded" })
        return { url: page.url() }
      }
      case "command": return this.command(action.command, action.root)
      case "qemu": return this.local(action.argv)
      case "qemu-monitor":
        if (!this.profile.qemu) throw new Error("QEMU container is not selected in this profile")
        return qemuControl(this.profile.qemu.container).monitor(action.command)
      case "windows-consent":
        if (this.profile.platform !== "windows" || !this.profile.qemu || !this.profile.application?.consentIdentity) throw new Error("Windows consent requires a QEMU profile and explicit expected consent identity")
        return qemuControl(this.profile.qemu.container).consent(this.profile.application.consentIdentity, action.accept, this.evidenceDir)
      case "android-key":
        if (!this.android || !/^[A-Za-z0-9_]+$/.test(action.key)) throw new Error("Invalid Android key")
        return this.android.adb(["shell", "input", "keyevent", action.key])
      case "android-tap":
        if (!this.android || !Number.isSafeInteger(action.x) || !Number.isSafeInteger(action.y) || action.x < 0 || action.y < 0) throw new Error("Invalid Android coordinates")
        return this.android.adb(["shell", "input", "tap", String(action.x), String(action.y)])
      case "android-text":
        if (!this.android) throw new Error("Android control required")
        return this.android.shell(`input text '${action.text.replaceAll("'", "'\\''").replaceAll(" ", "%s")}'`)
      case "android-hierarchy": {
        if (!this.android) throw new Error("Android control required")
        const path = `/data/local/tmp/canoe-hierarchy-${crypto.randomUUID()}.xml`
        return this.android.shell(`uiautomator dump ${path} >/dev/null && cat ${path}; rm -f ${path}`)
      }
      case "android-webview": {
        if (!this.android || !/^[A-Za-z0-9_.]+$/.test(action.package)) throw new Error("Android package required")
        const pid = (await this.android.shell(`pidof ${action.package}`)).split(" ")[0]
        if (!/^\d+$/.test(pid)) throw new Error("Selected Android app is not running")
        const socket = `webview_devtools_remote_${pid}`
        if (!(await this.android.root("cat /proc/net/unix")).includes(`@${socket}`)) throw new Error("WebView debugging is not enabled; attach will not change app preferences")
        this.adbForward = await this.android.adb(["forward", "tcp:0", `localabstract:${socket}`])
        await this.connectBrowser(`http://127.0.0.1:${this.adbForward}`, action.urlPattern)
        return { attached: socket }
      }
    }
    if (!this.page) throw new Error("No browser page attached; launch or connect a selected page first")
    switch (action.kind) {
      case "click": await this.page.locator(action.selector).click({ timeout: 15_000 }); break
      case "fill": await this.page.locator(action.selector).fill(action.value, { timeout: 15_000 }); break
      case "press": await this.page.keyboard.press(action.key); break
      case "navigate": await this.page.goto(action.url, { waitUntil: "domcontentloaded" }); break
      case "evaluate": return this.page.evaluate(action.expression)
      default: throw new Error("Unknown interaction")
    }
    return { completed: action.kind }
  }
  async capture() {
    const stem = `capture-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    if (this.page) {
      const path = join(this.evidenceDir, `${stem}.png`)
      await this.page.screenshot({ path, fullPage: true })
      return { path }
    }
    if (this.android && this.profile.control.kind === "adb") {
      const path = join(this.evidenceDir, `${stem}.png`)
      const child = Bun.spawn([process.env.ADB ?? "adb", "-s", this.profile.control.serial, "exec-out", "screencap", "-p"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
      const [bytes, stderr, code] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited])
      if (code !== 0) throw new Error(stderr)
      writeFileSync(path, new Uint8Array(bytes))
      return { path }
    }
    if (this.profile.hooks?.capture) return { output: await this.hook("capture"), evidenceDir: this.evidenceDir }
    if (this.profile.qemu) return { path: await qemuControl(this.profile.qemu.container).capture(join(this.evidenceDir, `${stem}.ppm`)) }
    throw new Error("No screenshot surface attached or capture hook configured")
  }
  async logs() {
    const output = this.profile.hooks?.logs ? await this.hook("logs") : this.android ? await this.android.adb(["logcat", "-d", "-v", "threadtime"]) : JSON.stringify(this.errors, null, 2)
    const path = join(this.evidenceDir, `logs-${Date.now()}.txt`)
    writeFileSync(path, output)
    return { path, events: this.events }
  }
  async close(runHook = true) {
    if (this.browser) await this.browser.close() // CDP connection: disconnect only; launched browser: terminate owned process.
    this.page = undefined; this.browser = undefined
    if (this.android && this.adbForward) await this.android.adb(["forward", "--remove", `tcp:${this.adbForward}`])
    this.adbForward = undefined
    if (runHook && this.profile.hooks?.close) await this.hook("close")
    this.event("closed", { ownedBrowser: this.ownedBrowser })
  }
}
