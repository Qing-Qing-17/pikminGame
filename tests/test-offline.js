/* 情境 D：完全連不上 kvdb（例如現場沒網路）。
   指揮官應該仍能跑完流程，「測試：進入皮克敏介面」也要能在同一台裝置上運作，
   而且不應該一直對著死掉的伺服器空轉發請求。 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";
const NM = path.join(__dirname, "node_modules");
const LOCAL = {
  "react/18.2.0/umd/react.production.min.js": path.join(NM, "react/umd/react.production.min.js"),
  "react-dom/18.2.0/umd/react-dom.production.min.js": path.join(NM, "react-dom/umd/react-dom.production.min.js"),
  "babel-standalone/7.23.5/babel.min.js": path.join(NM, "@babel/standalone/babel.min.js"),
};
const ok = (c, m) => console.log(`  ${c ? "✓" : "✗ 失敗:"} ${m}`);

(async () => {
  const html = fs.readFileSync(GAME, "utf8");
  const server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(html); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await browser.newContext();
  let kvHits = 0;
  await ctx.route("**://kvdb.io/**", (route) => { kvHits++; route.abort("connectionfailed"); });
  await ctx.route("**://cdnjs.cloudflare.com/**", (route, req) => {
    const hit = Object.keys(LOCAL).find((k) => req.url().includes(k));
    return route.fulfill({ status: 200, contentType: "application/javascript", body: hit ? fs.readFileSync(LOCAL[hit], "utf8") : "" });
  });
  await ctx.route("**://cdn.tailwindcss.com/**", (r) => r.fulfill({ status: 200, body: "", contentType: "application/javascript" }));
  await ctx.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, body: "", contentType: "text/css" }));

  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  ✗ 頁面錯誤:", e.message));
  await page.goto(url);

  await page.waitForSelector("text=選擇今天要進行的活動", { timeout: 20000 });
  ok(true, "連不上伺服器時，指揮官畫面仍然正常載入");

  await page.click("text=星攻略");
  await page.click("text=開始第一關：皮克敏迫降");
  await page.click("text=前往下一關");
  await page.waitForSelector("text=皮克敏加入");
  ok(await page.isVisible("text=目前連不上同步伺服器"), "有明確警告房間代碼無法給人加入");

  await page.click("text=開始：偽裝洞穴");
  await page.click("text=抽任務卡");
  await page.waitForSelector("text=各小隊抽取進度", { timeout: 10000 });
  ok(true, "指揮官能抽出任務卡");

  await page.click("text=測試：進入皮克敏介面");
  await page.waitForSelector("text=選擇你的小隊", { timeout: 10000 });
  await page.click(".grid.grid-cols-3 button:has-text('1')");
  await page.click('button:has-text("抽情境牌")');
  await page.waitForSelector("text=/第 \\d+ 號（只有你看得到）/", { timeout: 10000 });
  const num = (await page.textContent("text=/第 \\d+ 號（只有你看得到）/")).match(/第 (\d+) 號/)[1];
  ok(true, `單機測試模式下抽得到情境牌（第 ${num} 號）`);

  const before = kvHits;
  await page.waitForTimeout(6000);
  ok(kvHits === before, `確認離線後不再對死掉的伺服器空轉（6 秒內新增 ${kvHits - before} 次請求）`);

  await ctx.close(); await browser.close(); server.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
