/** SSH control channel to a guest, over the harness key. */
export type SshTarget = {
  readonly host: string
  readonly port?: number
  readonly user: string
  readonly key: string
}

export type ExecResult = { readonly code: number; readonly stdout: string; readonly stderr: string }

const BASE_ARGS = ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15"]

export function sshArgs(target: SshTarget): string[] {
  return [...BASE_ARGS, "-i", target.key, "-p", String(target.port ?? 22)]
}

export async function sshExec(target: SshTarget, command: string, options: { readonly timeoutMs?: number; readonly stdin?: string } = {}): Promise<ExecResult> {
  const child = Bun.spawn(["ssh", ...sshArgs(target), `${target.user}@${target.host}`, command], {
    stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => child.kill(), options.timeoutMs)
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (timer !== undefined) clearTimeout(timer)
  return { code, stdout, stderr }
}

export async function sshRun(target: SshTarget, command: string, options: { readonly timeoutMs?: number } = {}): Promise<string> {
  const result = await sshExec(target, command, options)
  if (result.code !== 0) throw new Error(`ssh ${target.user}@${target.host}: ${command}\nexit ${result.code}\n${result.stderr}`)
  return result.stdout
}

export async function scpTo(target: SshTarget, local: string, remote: string, options: { readonly recursive?: boolean } = {}): Promise<void> {
  const args = ["-q", ...BASE_ARGS, "-i", target.key, "-P", String(target.port ?? 22), ...(options.recursive === true ? ["-r"] : []), local, `${target.user}@${target.host}:${remote}`]
  const child = Bun.spawn(["scp", ...args], { stdout: "ignore", stderr: "pipe" })
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`scp ${local} -> ${remote}: ${stderr}`)
}

export async function scpFrom(target: SshTarget, remote: string, local: string): Promise<void> {
  const args = ["-q", ...BASE_ARGS, "-i", target.key, "-P", String(target.port ?? 22), `${target.user}@${target.host}:${remote}`, local]
  const child = Bun.spawn(["scp", ...args], { stdout: "ignore", stderr: "pipe" })
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`scp ${remote} -> ${local}: ${stderr}`)
}

export async function waitForSsh(target: SshTarget, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await sshExec(target, "echo ready", { timeoutMs: 20_000 })
    if (result.code === 0 && result.stdout.includes("ready")) return
    if (Date.now() > deadline) throw new Error(`ssh to ${target.user}@${target.host}:${target.port ?? 22} did not come up: ${result.stderr}`)
    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }
}
