import { readFileSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import type { Hook, TargetProfile } from "./types"

export function loadProfile(path: string): TargetProfile {
  const profile = JSON.parse(readFileSync(path, "utf8")) as TargetProfile
  if (profile.schemaVersion !== 1 || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile.id) ||
      !["linux", "windows", "android"].includes(profile.platform) || !profile.control ||
      !["local", "ssh", "adb"].includes(profile.control.kind)) throw new Error("Invalid target profile")
  const base = dirname(resolve(path))
  const local = (value: string) => isAbsolute(value) ? value : resolve(base, value)
  if (profile.control.kind === "ssh") {
    if (!profile.control.host || !profile.control.user || !profile.control.key) throw new Error("SSH profile requires host, user and key")
    profile.control.key = local(profile.control.key)
  }
  if (profile.control.kind === "adb" && !/^(localhost|127\.0\.0\.1):\d+$/.test(profile.control.serial)) {
    throw new Error("Android harness requires an explicit loopback virtual guest; physical phones are not target profiles")
  }
  for (const hook of Object.values(profile.hooks ?? {}) as Hook[]) {
    if (!Array.isArray(hook.argv) || !hook.argv.length || hook.argv.some(arg => typeof arg !== "string")) throw new Error("Hook requires an argv array")
    hook.cwd = hook.cwd ? local(hook.cwd) : base
  }
  if (profile.application?.moduleZip) profile.application.moduleZip = local(profile.application.moduleZip)
  if (profile.browser && "executablePath" in profile.browser && profile.browser.executablePath) profile.browser.executablePath = local(profile.browser.executablePath)
  return profile
}
