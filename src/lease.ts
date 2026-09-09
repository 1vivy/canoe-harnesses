import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Platform } from "./types"

export function stateRoot(): string {
  const path = process.env.CANOE_E2E_STATE ?? join(homedir(), ".local/share/canoe-e2e")
  mkdirSync(path, { recursive: true, mode: 0o700 })
  return realpathSync(path)
}

/** Compatible with b4 operation.lock. The daemon, not each CLI, owns this. */
export function acquireLease(platform: Platform, root = stateRoot()): () => void {
  const directory = join(root, platform)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, "operation.lock")
  const content = JSON.stringify({ pid: process.pid, command: process.argv, started: new Date().toISOString() })
  for (;;) {
    let fd: number
    try { fd = openSync(path, "wx", 0o600) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const existing = readFileSync(path, "utf8")
      const owner = JSON.parse(existing) as { pid: number }
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error(`Invalid harness lock: ${path}`)
      try { process.kill(owner.pid, 0) } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe
        if (readFileSync(path, "utf8") === existing) unlinkSync(path)
        continue
      }
      throw new Error(`${platform} is in use by harness process ${owner.pid}`)
    }
    writeFileSync(fd, content)
    closeSync(fd)
    break
  }
  const release = () => {
    try { if (readFileSync(path, "utf8") === content) unlinkSync(path) } catch { /* owner already released */ }
  }
  process.once("exit", release)
  return release
}
