/* 啟動官方的 Firebase Realtime Database 模擬器供測試使用。
   用的是 firebase-tools 下載下來的 jar，直接以 java 執行——繞過 CLI，
   因為 CLI 啟動時會去抓遠端設定，在沒有對外網路的環境會失敗。 */
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const NS = process.env.FB_NS || "demo-pikmin";
const PORT = Number(process.env.FB_PORT || 9000);
const HOST = "127.0.0.1";

function findJar() {
  const roots = [path.join(process.env.HOME || "/root", ".cache/firebase/emulators")];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const hit = fs.readdirSync(root).find((f) => /^firebase-database-emulator.*\.jar$/.test(f));
    if (hit) return path.join(root, hit);
  }
  return null;
}

async function waitReady(url, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch (e) { /* 還沒起來 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function start() {
  const jar = findJar();
  if (!jar) {
    throw new Error("找不到 Firebase 模擬器 jar。請先執行：npx firebase-tools setup:emulators:database");
  }
  const proc = spawn("java", ["-jar", jar, "--port", String(PORT), "--host", HOST], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", () => {});
  proc.stderr.on("data", () => {});
  const base = `http://${HOST}:${PORT}`;
  const ok = await waitReady(`${base}/.json?ns=${NS}`);
  if (!ok) { proc.kill(); throw new Error("模擬器啟動逾時"); }
  return {
    // 用戶端會拿到的資料庫網址；?ns= 由 dbUrl 內建，程式碼不必知道模擬器的存在
    url: `${base}/?ns=${NS}`,
    base,
    ns: NS,
    async reset() {
      await fetch(`${base}/.json?ns=${NS}`, { method: "DELETE" });
    },
    stop() { try { proc.kill("SIGKILL"); } catch (e) {} },
  };
}

module.exports = { start };
