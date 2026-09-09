import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { SshTarget } from "../common/ssh"
import { sshExec } from "../common/ssh"

/** Encode PowerShell as UTF-16LE to preserve literal paths through SSH. */
export async function powershell(target: SshTarget, script: string): Promise<string> {
  const wrapped = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'\ntry {\n${script}\n} catch { Write-Error $_; exit 1 }\nexit 0`
  const result = await sshExec(target, `powershell -NoProfile -EncodedCommand ${Buffer.from(wrapped, "utf16le").toString("base64")}`, { timeoutMs: 120_000 })
  if (result.code !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout
}

/** Low-level controls require the caller's persistent platform lease. */
export function qemuControl(container: string) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(container)) throw new Error("Invalid QEMU container")
  const command = async (argv: string[], input?: string) => {
    const child = Bun.spawn(argv, { stdin: input === undefined ? "ignore" : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    if (code !== 0) throw new Error(stderr || stdout)
    return stdout
  }
  const monitor = async (input: string) => {
    if (/[\r\n]/.test(input)) throw new Error("One HMP command per call")
    const output = await command(["docker", "exec", "-i", container, "python3", "-", input], readFileSync(join(import.meta.dir, "provision/qemu-monitor.py"), "utf8"))
    if (/Error:|failed|not found/iu.test(output)) throw new Error(output)
    return output
  }
  const capture = async (destination: string) => {
    const name = `/tmp/harness-${crypto.randomUUID()}.ppm`
    await monitor(`screendump ${name}`)
    await command(["docker", "cp", `${container}:${name}`, destination])
    await command(["docker", "exec", container, "rm", "-f", name])
    return destination
  }
  const consent = async (identity: string, accept: boolean, evidenceDir: string, timeoutMs = 30_000) => {
    if (!identity.trim()) throw new Error("Expected executable or publisher identity is required for consent")
    mkdirSync(evidenceDir, { recursive: true })
    const path = join(evidenceDir, `uac-${Date.now()}.ppm`)
    const deadline = Date.now() + timeoutMs
    for (;;) {
      await capture(path)
      const shown = await command(["tesseract", path, "stdout", "--psm", "11"])
      writeFileSync(`${path}.txt`, shown)
      if (/User Account Contr[oa]l/iu.test(shown) && shown.toLowerCase().includes(identity.toLowerCase()) && /make changes to your/iu.test(shown) && /Yes/iu.test(shown)) {
        await monitor(`sendkey ${accept ? "alt-y" : "esc"}`)
        return { path, accepted: accept, identity }
      }
      if (Date.now() > deadline) throw new Error(`Expected consent identity ${identity} not visible; evidence: ${path}`)
      await Bun.sleep(500)
    }
  }
  return { monitor, capture, consent }
}
