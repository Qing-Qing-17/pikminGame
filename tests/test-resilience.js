/* C 階段：錯誤邊界會不會兜住例外、CDN 掛掉時有沒有可讀的提示、預先編譯版快多少。 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const NM = path.join(__dirname, "..", "node_modules");
const ok = (c, m) => console.log(`  ${c ? "✓" : "✗ 失敗:"} ${m}`);

async function serve(file) {
  const html = fs.readFileSync(file, "utf8");
  const s = http.createServer((q, r) => { r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { s, url: `http://127.0.0.1:${s.address().port}/` };
}
const LOCAL = {
  "react/18.2.0/umd/react.production.min.js": path.join(NM, "react/umd/react.production.min.js"),
  "react-dom/18.2.0/umd/react-dom.production.min.js": path.join(NM, "react-dom/umd/react-dom.production.min.js"),
  "babel-standalone/7.23.5/babel.min.js": path.join(NM, "@babel/standalone/babel.min.js"),
};
async function wire(ctx, { blockCdn = false } = {}) {
  await ctx.route("**://kvdb.io/**", (r) => r.fulfill({ status: 404, body: "" }));
  await ctx.route("**://cdnjs.cloudflare.com/**", (route, req) => {
    if (blockCdn) return route.abort("connectionfailed");
    const hit = Object.keys(LOCAL).find((k) => req.url().includes(k));
    return route.fulfill({ status: 200, contentType: "application/javascript", body: hit ? fs.readFileSync(LOCAL[hit], "utf8") : "" });
  });
  await ctx.route("**://cdn.tailwindcss.com/**", (r) => r.fulfill({ status: 200, body: "", contentType: "application/javascript" }));
  await ctx.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, body: "", contentType: "text/css" }));
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

  // 1. CDN 全掛時要看得到可讀的提示，而不是一片空白
  {
    const { s, url } = await serve(path.join(__dirname, "..", "index.html"));
    const ctx = await browser.newContext();
    await wire(ctx, { blockCdn: true });
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForTimeout(2500);
    const txt = await page.textContent("body");
    ok(/載入失敗/.test(txt), `CDN 掛掉時顯示可讀的提示（畫面：${txt.replace(/\s+/g, " ").trim().slice(0, 30)}…）`);
    await ctx.close(); s.close();
  }

  // 2a. 結構不完整的遠端狀態，應該被正規化吸收而不是把畫面弄壞
  {
    const { s, url } = await serve(path.join(__dirname, "..", "index.html"));
    const ctx = await browser.newContext();
    await wire(ctx);
    await ctx.unroute("**://kvdb.io/**");
    await ctx.route("**://kvdb.io/**", (route, req) => {
      if (req.method() === "POST") return route.fulfill({ status: 200, body: "bad1" });
      if (req.url().endsWith("/state")) return route.fulfill({ status: 200, body: JSON.stringify({ activity: "star", stage: "intro", storyText: null, ttol: null }) });
      return route.fulfill({ status: 404, body: "" });
    });
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForTimeout(3000);
    const txt = await page.textContent("#root");
    ok(!/畫面出了點問題/.test(txt), "結構不完整的遠端狀態被正規化吸收，沒有弄壞畫面");
    ok(/序章/.test(txt), "畫面照常顯示序章");
    await ctx.close(); s.close();
  }

  // 2b. 真的丟出 render 例外時，錯誤邊界要接住並給出可操作的畫面
  {
    const { s, url } = await serve(path.join(__dirname, "..", "index.html"));
    const ctx = await browser.newContext();
    await wire(ctx);
    await ctx.unroute("**://kvdb.io/**");
    await ctx.route("**://kvdb.io/**", (route, req) => {
      if (req.method() === "POST") return route.fulfill({ status: 200, body: "bad2" });
      if (req.url().endsWith("/state")) return route.fulfill({ status: 200, body: JSON.stringify({ activity: "star", stage: "bar", cardId: null }) });
      // 任務卡回傳一個不是陣列的東西，偽裝洞穴畫面在 cards.map 會直接拋錯
      if (req.url().endsWith("/cards")) return route.fulfill({ status: 200, body: JSON.stringify({ oops: true }) });
      return route.fulfill({ status: 404, body: "" });
    });
    const page = await ctx.newPage();
    page.on("pageerror", () => {});
    await page.goto(url);
    await page.waitForTimeout(3500);
    const txt = await page.textContent("#root");
    ok(/畫面出了點問題/.test(txt), "render 例外被錯誤邊界接住，不再是一片空白");
    ok(await page.isVisible("text=清除本機資料並重新載入"), "錯誤畫面提供了可操作的退路");
    await ctx.close(); s.close();
  }

  // 3. 預先編譯版的載入速度
  for (const [label, file] of [["原始版（瀏覽器即時編譯）", "index.html"], ["建置版（預先編譯）", "dist/index.html"]]) {
    const { s, url } = await serve(path.join(__dirname, "..", file));
    const ctx = await browser.newContext();
    await wire(ctx);
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(url);
    await page.waitForSelector("text=選擇今天要進行的活動", { timeout: 30000 });
    console.log(`  · ${label}：可互動耗時 ${Date.now() - t0} ms`);
    await ctx.close(); s.close();
  }

  await browser.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
