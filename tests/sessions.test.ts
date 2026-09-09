import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startSession } from "../src/index"
import type { SessionClient, TargetProfile } from "../src/types"

const roots: string[] = []
const sessions: SessionClient[] = []
const previous = process.env.CANOE_E2E_STATE
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close().catch(() => undefined)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (previous === undefined) delete process.env.CANOE_E2E_STATE; else process.env.CANOE_E2E_STATE = previous
})
function fixture(extra: Partial<TargetProfile> = {}) {
  const root = mkdtempSync(join(tmpdir(), "canoe-harness-test-")); roots.push(root)
  process.env.CANOE_E2E_STATE = join(root, "state")
  const profile = join(root, "profile.json")
  writeFileSync(profile, JSON.stringify({ schemaVersion: 1, id: "isolated-test", platform: "linux", control: { kind: "local" }, ...extra }))
  return { root, profile }
}

test("attach preserves state, lease survives CLI exit, reset is explicit, close releases", async () => {
  const { root, profile } = fixture()
  const marker = join(root, "reset-marker")
  const hook = { argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'reset')`] }
  writeFileSync(profile, JSON.stringify({ schemaVersion: 1, id: "isolated-test", platform: "linux", control: { kind: "local" }, hooks: { provision: hook, stage: hook, setup: hook, reset: hook } }))
  const cli = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), "attach", profile], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  const [output, errors, code] = await Promise.all([new Response(cli.stdout).text(), new Response(cli.stderr).text(), cli.exited])
  expect(code).toBe(0); expect(errors).toBe("")
  const result = JSON.parse(output)
  const { connectSession } = await import("../src/index")
  const session = connectSession(result.id); sessions.push(session)
  const lock = join(root, "state/linux/operation.lock")
  expect(JSON.parse(readFileSync(lock, "utf8")).pid).toBe(session.record.pid)
  expect(session.record.pid).not.toBe(process.pid)
  expect(existsSync(marker)).toBe(false)
  await session.observe(); expect(existsSync(marker)).toBe(false)
  await expect(startSession(profile)).rejects.toThrow("is in use by harness process")
  await session.reset(); expect(readFileSync(marker, "utf8")).toBe("reset")
  await session.close(); expect(existsSync(lock)).toBe(false)
}, 20_000)

test("b4 lock prevents new controller; dead lock can be reclaimed", async () => {
  const { root, profile } = fixture()
  const directory = join(root, "state/linux"); mkdirSync(directory, { recursive: true })
  const lock = join(directory, "operation.lock")
  writeFileSync(lock, JSON.stringify({ pid: process.pid }))
  await expect(startSession(profile)).rejects.toThrow("is in use")
  expect(JSON.parse(readFileSync(lock, "utf8")).pid).toBe(process.pid)
  writeFileSync(lock, JSON.stringify({ pid: 2_147_483_647 }))
  const session = await startSession(profile); sessions.push(session)
  expect(JSON.parse(readFileSync(lock, "utf8")).pid).toBe(session.record.pid)
}, 20_000)

test("provision runs ordered hooks; missing reset fails without guessing", async () => {
  const { root, profile } = fixture()
  const marker = join(root, "hooks")
  const hook = (name: string) => ({ argv: [process.execPath, "-e", `require('fs').appendFileSync(${JSON.stringify(marker)},${JSON.stringify(name + "\n")})`] })
  writeFileSync(profile, JSON.stringify({ schemaVersion: 1, id: "isolated-test", platform: "linux", control: { kind: "local" }, hooks: { provision: hook("provision"), stage: hook("stage"), setup: hook("setup") } }))
  const session = await startSession(profile, { mode: "provision" }); sessions.push(session)
  expect(readFileSync(marker, "utf8")).toBe("provision\nstage\nsetup\n")
  await expect(session.reset()).rejects.toThrow("No reset hook")
  await session.observe()
}, 20_000)

test("real Chromium interaction and screenshot from independent directory", async () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response('<!doctype html><title>Generic harness</title><button id="button" onclick="document.querySelector(\'output\').textContent=\'clicked\'">Try</button><output>ready</output>', { headers: { "content-type": "text/html" } }) })
  try {
    const { profile } = fixture({ browser: { url: `http://127.0.0.1:${server.port}` } })
    const session = await startSession(profile); sessions.push(session)
    expect((await session.observe() as any).page).toBe(null)
    await session.interact({ kind: "launch" })
    await session.interact({ kind: "click", selector: "#button" })
    expect((await session.observe() as any).page.text).toContain("clicked")
    const capture = await session.capture() as { path: string }
    expect(readFileSync(capture.path).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
    expect(existsSync((await session.logs() as { path: string }).path)).toBe(true)
  } finally { server.stop(true) }
}, 30_000)
