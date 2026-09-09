import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { stateRoot } from "./lease"
import { loadProfile } from "./profile"
import type { Command, SessionClient, SessionRecord } from "./types"
export type * from "./types"
export { loadProfile } from "./profile"

const validateId = (id: string) => { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid session ID"); return id }
export function connectSession(id: string, root = stateRoot()): SessionClient {
  const record = JSON.parse(readFileSync(join(root, "sessions", validateId(id), "session.json"), "utf8")) as SessionRecord
  const send = async (command: Command, payload?: unknown) => {
    const response = await fetch(record.url, { method: "POST", headers: { authorization: `Bearer ${record.token}`, "content-type": "application/json" }, body: JSON.stringify({ command, payload }) })
    const result = await response.json() as { value?: unknown; error?: string }
    if (!response.ok) throw new Error(result.error ?? `Session returned ${response.status}`)
    return result.value
  }
  return { record, observe: () => send("observe"), interact: payload => send("interact", payload), capture: () => send("capture"), logs: () => send("logs"), reset: () => send("reset"), close: () => send("close") }
}

export async function startSession(profilePath: string, options: { mode?: "attach" | "provision" } = {}): Promise<SessionClient> {
  const absolute = resolve(profilePath)
  loadProfile(absolute)
  const root = stateRoot()
  const id = crypto.randomUUID()
  const directory = join(root, "sessions", id)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const config = join(directory, "start.json")
  writeFileSync(config, JSON.stringify({ id, profilePath: absolute, root, mode: options.mode ?? "attach" }), { mode: 0o600 })
  const output = openSync(join(directory, "controller.log"), "a", 0o600)
  const child = spawn(process.execPath, [join(import.meta.dir, "daemon.ts"), config], { detached: true, stdio: ["ignore", output, output], env: { ...process.env, CANOE_E2E_STATE: root } })
  child.unref()
  closeSync(output)
  const deadline = Date.now() + (options.mode === "provision" ? 3_600_000 : 90_000)
  while (!existsSync(join(directory, "session.json"))) {
    if (existsSync(join(directory, "failure.json"))) throw new Error(JSON.parse(readFileSync(join(directory, "failure.json"), "utf8")).error)
    if (Date.now() > deadline) {
      child.kill("SIGTERM")
      throw new Error(`Session startup timed out; evidence: ${directory}`)
    }
    await Bun.sleep(50)
  }
  return connectSession(id, root)
}
