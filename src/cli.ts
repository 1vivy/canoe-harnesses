#!/usr/bin/env bun
import { connectSession, startSession } from "./index"
import type { Interaction } from "./types"

const [command, target, json] = process.argv.slice(2)
try {
  if (!target) throw new Error("Usage: canoe-harnesses attach|provision PROFILE.json; observe|interact|capture|logs|reset|close SESSION_ID [JSON]")
  if (command === "attach" || command === "provision") {
    const session = await startSession(target, { mode: command })
    const { token: _token, ...record } = session.record
    console.log(JSON.stringify(record, null, 2))
  } else {
    const session = connectSession(target)
    const output = command === "interact" ? await session.interact(JSON.parse(json ?? "{}") as Interaction)
      : command === "observe" ? await session.observe()
      : command === "capture" ? await session.capture()
      : command === "logs" ? await session.logs()
      : command === "reset" ? await session.reset()
      : command === "close" ? await session.close()
      : (() => { throw new Error(`Unknown command ${command}`) })()
    console.log(JSON.stringify(output, null, 2))
  }
} catch (error) { console.error(String(error)); process.exitCode = 1 }
