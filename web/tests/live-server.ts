import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => done(port));
    });
  });
}

async function waitUntilUp(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      await new Promise((resume) => setTimeout(resume, 100));
    }
  }
  throw new Error(`the Go server did not come up at ${url}`);
}

/** Builds and starts the real Go server on free ports for the tests that speak lv.1 to it. */
export default async function setup(): Promise<() => void> {
  const serverDir = resolve(import.meta.dirname, "../../server");
  const work = mkdtempSync(join(tmpdir(), "live-web-"));
  const binary = join(work, "live");
  const build = spawnSync("go", ["build", "-o", binary, "./cmd/live"], { cwd: serverDir, encoding: "utf8" });
  if (build.status !== 0) throw new Error(`go build failed: ${build.stderr}`);
  const [http, signal] = [await freePort(), await freePort()];
  const child: ChildProcess = spawn(binary, [], { cwd: work, env: { ...process.env, PORT: String(http), SIGNAL_PORT: String(signal) }, stdio: "ignore" });
  process.env.LIVE_HTTP = `http://127.0.0.1:${http}`;
  process.env.LIVE_SIGNAL = `ws://127.0.0.1:${signal}/ws`;
  await waitUntilUp(`${process.env.LIVE_HTTP}/up`);
  return () => {
    child.kill("SIGTERM");
    rmSync(work, { recursive: true, force: true });
  };
}
