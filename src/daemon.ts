import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { acquireLease } from "./lease"
import { loadProfile } from "./profile"
import { Target } from "./target"
import type { Command, Interaction, SessionRecord } from "./types"

const config = JSON.parse(readFileSync(process.argv[2], "utf8")) as { id: string; profilePath: string; root: string; mode: "attach" | "provision" }
const directory = join(config.root, "sessions", config.id)
const evidenceDir = join(directory, "evidence")
mkdirSync(evidenceDir, { recursive: true, mode: 0o700 })
let release: (() => void) | undefined
let target: Target | undefined
let closing = false
let queue = Promise.resolve<unknown>(undefined)
let server: ReturnType<typeof Bun.serve> | undefined
const stop = async (runHook = false) => {
  if (closing) return
  closing = true
  try { await target?.close(runHook) } finally { release?.(); server?.stop(false) }
}
process.on("SIGTERM", () => { void queue.finally(stop).finally(() => process.exit(0)) })
process.on("SIGINT", () => { void queue.finally(stop).finally(() => process.exit(0)) })
try {
  const profile = loadProfile(config.profilePath)
  release = acquireLease(profile.platform, config.root)
  target = new Target(profile, evidenceDir, config.profilePath)
  if (config.mode === "provision") {
    await target.hook("provision")
    for (const hook of ["stage", "setup"] as const) if (profile.hooks?.[hook]) await target.hook(hook)
  }
  await target.attach()
  const token = crypto.randomUUID() + crypto.randomUUID()
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0,
    async fetch(request) {
      if (request.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ error: "Unauthorized" }, { status: 401 })
      if (request.method !== "POST") return Response.json({ error: "POST required" }, { status: 405 })
      try {
        const message = await request.json() as { command: Command; payload?: Interaction }
        const execute = async () => {
          if (closing) throw new Error("Session is closing")
          switch (message.command) {
            case "observe": return target!.observe()
            case "interact": return target!.interact(message.payload!)
            case "capture": return target!.capture()
            case "logs": return target!.logs()
            case "reset": return target!.hook("reset")
            case "close": {
              await stop(true)
              return { closed: config.id }
            }
            default: throw new Error("Unknown session command")
          }
        }
        const pending = queue.then(execute)
        queue = pending.catch(() => undefined)
        const value = await pending
        if (message.command === "close") setTimeout(() => process.exit(0), 200)
        return Response.json({ value })
      } catch (error) { return Response.json({ error: String(error) }, { status: 400 }) }
    },
  })
  const record: SessionRecord = { id: config.id, pid: process.pid, platform: profile.platform, profileId: profile.id, profilePath: config.profilePath,
    url: `http://127.0.0.1:${server.port}`, token, started: new Date().toISOString(), evidenceDir, stateRoot: config.root }
  writeFileSync(join(directory, "session.json"), JSON.stringify(record, null, 2), { mode: 0o600 })
} catch (error) {
  writeFileSync(join(directory, "failure.json"), JSON.stringify({ error: String(error) }), { mode: 0o600 })
  await stop().catch(() => undefined)
  process.exitCode = 1
}
