/* C 階段：CDN 掛掉的提示、錯誤邊界、以及預先編譯版的載入速度。 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");
const { makeWorld, ok, hostAdvance, finishSetup } = require("./harness");

const ROOT = path.join(__dirname, "..");
const NM = path.join(ROOT, "node_modules");
const LOCAL = {
  "react/18.2.0/umd/react.production.min.js": path.join(NM, "react/umd/react.production.min.js"),
  "react-dom/18.2.0/umd/react-dom.production.min.js": path.join(NM, "react-dom/umd/react-dom.production.min.js"),
  "babel-standalone/7.23.5/babel.min.js": path.join(NM, "@babel/standalone/babel.min.js"),
};

async function serve(file) {
  const html = fs.readFileSync(file, "utf8");
  const s = http.createServer((q, r) => { r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { s, url: `http://127.0.0.1:${s.address().port}/` };
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

  // 1. 四支外部腳本全掛時，要看得到可讀的提示而不是一片空白
  {
    const { s, url } = await serve(path.join(ROOT, "index.html"));
    const ctx = await browser.newContext();
    await ctx.route("**://cdnjs.cloudflare.com/**", (r) => r.abort("connectionfailed"));
    await ctx.route("**://cdn.tailwindcss.com/**", (r) => r.abort("connectionfailed"));
    await ctx.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, body: "", contentType: "text/css" }));
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForTimeout(2500);
    const txt = await page.textContent("#root");
    ok(/載入失敗/.test(txt), `CDN 掛掉時顯示可讀的提示（${txt.replace(/\s+/g, " ").trim().slice(0, 26)}…）`);
    await ctx.close(); s.close();
  }

  // 2. 資料結構壞掉時，錯誤邊界要接住並給出可操作的畫面
  {
    const world = await makeWorld(path.join(ROOT, "index.html"));
    const host = await world.device("host");
    await host.click("text=星攻略");
    await hostAdvance(host, "開始第一關：皮克敏迫降");
    await host.click("text=前往下一關");
    await finishSetup(host);
    const code = await world.db.onlyRoom();

    // 塞一張缺少 scenarios 欄位的任務卡，並直接指定它為當前題目——
    // 畫面讀到它時會在 scenarios.map 拋錯，正好用來驗證錯誤邊界。
    await world.db.write(`rooms/${code}/cards`, [{ id: "broken", line: "壞掉的卡" }]);
    await hostAdvance(host, "開始：偽裝洞穴");
    await host.waitForSelector("text=抽任務卡", { timeout: 15000 });
    await host.waitForTimeout(2000); // 等指揮官那次 session 寫入落地，否則會把下面的 cardId 蓋掉
    await world.db.write(`rooms/${code}/session/cardId`, "broken");
    await world.db.write(`rooms/${code}/session/cardRevealed`, true);
    await host.waitForTimeout(1500);
    const p = await world.device("p0");
    await p.goto(p.url().split("?")[0] + `?join=${code}`);
    await p.waitForSelector('input[placeholder="房間代碼"]', { timeout: 20000 });
    await p.click('button:has-text("加入遊戲")');
    // 要先選小隊才會進到讀取任務卡的畫面
    await p.waitForSelector("text=選擇你的小隊", { timeout: 20000 });
    await p.click(".grid.grid-cols-3 button:has-text('1')");
    await p.waitForTimeout(3000);
    const ptxt = await p.textContent("#root");
    if (!/畫面出了點問題/.test(ptxt)) console.log("    皮克敏畫面:", ptxt.replace(/\s+/g, " ").trim().slice(0, 120));
    ok(/畫面出了點問題/.test(ptxt), "render 例外被錯誤邊界接住，不再是一片空白");
    ok(await p.isVisible("text=清除本機資料並重新載入"), "錯誤畫面提供了可操作的退路");
    await world.close();
  }

  // 3. 預先編譯版的載入速度
  for (const [label, file] of [["原始版（瀏覽器即時編譯）", "index.html"], ["建置版（預先編譯）", "dist/index.html"]]) {
    const times = [];
    for (let run = 0; run < 3; run++) {
      const { s, url } = await serve(path.join(ROOT, file));
      const ctx = await browser.newContext();
      await ctx.route("**://cdnjs.cloudflare.com/**", (route, req) => {
        const hit = Object.keys(LOCAL).find((k) => req.url().includes(k));
        return route.fulfill({ status: 200, contentType: "application/javascript", body: hit ? fs.readFileSync(LOCAL[hit], "utf8") : "" });
      });
      await ctx.route("**://cdn.tailwindcss.com/**", (r) => r.fulfill({ status: 200, body: "", contentType: "application/javascript" }));
      await ctx.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, body: "", contentType: "text/css" }));
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto(url);
      await page.waitForSelector("text=選擇今天要進行的活動", { timeout: 30000 });
      times.push(Date.now() - t0);
      await ctx.close(); s.close();
    }
    times.sort((a, b) => a - b);
    console.log(`  · ${label}：可互動耗時中位數 ${times[1]} ms（三次：${times.join(" / ")}）`);
  }

  await browser.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
