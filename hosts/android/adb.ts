import { mkdirSync, appendFileSync } from "node:fs"
import { dirname } from "node:path"

export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

/** Every invocation targets an explicit virtual-device serial. Never use adb's default device. */
export function androidControl(serial: string, log: string) {
  if (!/^(?:localhost|127\.0\.0\.1):\d+$/u.test(serial)) {
    throw new Error("Android E2E requires an explicit loopback Cuttlefish serial, e.g. 127.0.0.1:6520")
  }
  mkdirSync(dirname(log), { recursive: true })
  const adb = async (args: readonly string[], timeoutMs = 30_000): Promise<string> => {
    const child = Bun.spawn([process.env["ADB"] ?? "adb", "-s", serial, ...args], {
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
    try {
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ])
      appendFileSync(log, `${new Date().toISOString()} adb ${JSON.stringify(args)}\n${out}${err}\nexit=${code} timeout=${timedOut}\n`)
      if (timedOut || code !== 0) throw new Error(`adb ${args[0]} ${timedOut ? "timed out" : `exited ${code}`}: ${err || out}`)
      return out.trim()
    } finally { clearTimeout(timer) }
  }
  const shell = (command: string, timeoutMs?: number) => adb(["shell", command], timeoutMs)
  const root = (command: string, timeoutMs?: number) => shell(`su -c ${shellQuote(command)}`, timeoutMs)
  return { adb, shell, root }
}
