/* 測試用的世界：真的 Firebase Realtime Database 模擬器 + 多個獨立的瀏覽器 context。
   每個參與者一個 context（各自的 localStorage），等同不同裝置。
   CDN 換成本地檔案；資料庫請求加上模擬延遲，否則競態窗口小到測不出來。 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");
const emulator = require("../tools/emulator.js");

const NM = path.join(__dirname, "..", "node_modules");
const LOCAL = {
  "react/18.2.0/umd/react.production.min.js": path.join(NM, "react/umd/react.production.min.js"),
  "react-dom/18.2.0/umd/react-dom.production.min.js": path.join(NM, "react-dom/umd/react-dom.production.min.js"),
  "babel-standalone/7.23.5/babel.min.js": path.join(NM, "@babel/standalone/babel.min.js"),
};

const LATENCY = Number(process.env.LATENCY || 120);
const lag = () => new Promise((r) => setTimeout(r, LATENCY * (0.6 + Math.random() * 0.8)));

/* 把資料庫網址注入頁面，取代原始碼裡留白的常數 */
async function startServer(gameFile, dbUrl) {
  let html = fs.readFileSync(gameFile, "utf8");
  const pattern = /const FIREBASE_DB_URL = "[^"]*";/;
  // 注意要檢查「有沒有比對到」而不是「內容有沒有變」——測試空網址時前後會一模一樣
  if (!pattern.test(html)) throw new Error("找不到 FIREBASE_DB_URL 常數，無法注入測試用的資料庫網址");
  html = html.replace(pattern, () => `const FIREBASE_DB_URL = ${JSON.stringify(dbUrl)};`);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

async function makeWorld(gameFile, opts = {}) {
  const emu = await emulator.start();
  await emu.reset();
  const dbUrl = opts.noBackend ? "" : emu.url;
  const { server, url } = await startServer(gameFile, dbUrl);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const contexts = [];
  const stats = { requests: 0, streams: 0, writesByKey: {} };

  async function device(label, dopts = {}) {
    const ctx = await browser.newContext();
    if (dopts.clockSkewMs) {
      // 模擬這台裝置的系統時鐘偏差（Date.now 整體平移，但仍持續前進）
      await ctx.addInitScript(`(() => {
        const skew = ${dopts.clockSkewMs};
        const RealDate = Date;
        const D = function (...a) { return a.length ? new RealDate(...a) : new RealDate(RealDate.now() + skew); };
        D.prototype = RealDate.prototype;
        D.now = () => RealDate.now() + skew;
        D.parse = RealDate.parse; D.UTC = RealDate.UTC;
        window.Date = D;
      })()`);
    }
    contexts.push(ctx);

    // 資料庫請求加延遲；SSE 是長連線，攔截會破壞串流，所以直接放行
    await ctx.route("**://127.0.0.1:9000/**", async (route, req) => {
      const isStream = req.resourceType() === "eventsource" ||
        /text\/event-stream/.test(req.headers()["accept"] || "");
      if (isStream) { stats.streams++; return route.continue(); }
      stats.requests++;
      if (req.method() !== "GET") {
        // 依路徑分類寫入次數，測試才能斷言「編輯任務卡只送出一次」這類行為
        const m = req.url().match(/\/rooms\/[^/]+\/([^/.?]+)/);
        const key = m ? m[1] : "other";
        stats.writesByKey[key] = (stats.writesByKey[key] || 0) + 1;
      }
      if (dopts.blockDb) return route.abort("connectionfailed");
      // 模擬 Firebase 規則拒絕存取（鎖定模式，或測試模式過期）
      if (dopts.denyDb) return route.fulfill({
        status: 401, contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Permission denied" }),
      });
      await lag();
      return route.continue();
    });

    await ctx.route("**://cdnjs.cloudflare.com/**", (route, req) => {
      if (dopts.blockCdn) return route.abort("connectionfailed");
      const hit = Object.keys(LOCAL).find((k) => req.url().includes(k));
      return route.fulfill({
        status: 200, contentType: "application/javascript",
        body: hit ? fs.readFileSync(LOCAL[hit], "utf8") : "",
      });
    });
    await ctx.route("**://cdn.tailwindcss.com/**", (r) => r.fulfill({ status: 200, body: "", contentType: "application/javascript" }));
    await ctx.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, body: "", contentType: "text/css" }));

    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`  ✗ [${label}] 頁面錯誤: ${e.message}`));
    const rawClick = page.click.bind(page);
    page.click = async (sel, o) => {
      try { return await rawClick(sel, o); }
      catch (e) {
        const body = (await page.textContent("body").catch(() => "")).replace(/\s+/g, " ");
        const stage = (body.match(/目前身份：(指揮官|皮克敏) · ([^·]+)/) || [])[2];
        console.log(`  ✗ [${label}] 點不到「${sel}」；當下關卡=${(stage || "?").trim()}`);
        throw e;
      }
    };
    await page.goto(url);
    await page.waitForSelector("h1", { timeout: 20000 });
    return page;
  }

  let hostRoom = null; // 第一次查到就記住，之後玩家分頁也建房間就分不出來了
  const dbFetch = (p, init) => fetch(`${emu.base}/${p}.json?ns=${emu.ns}`, init);

  const db = {
    async raw(p) { const r = await dbFetch(p); return r.json(); },
    async wipe(p) { await dbFetch(p, { method: "DELETE" }); },
    async write(p, value) { await dbFetch(p, { method: "PUT", body: JSON.stringify(value) }); },
    /* 每次測試都是全新的資料庫，所以「唯一的那個房間」就是待測房間。
       比在畫面上找代碼可靠——代碼只在某些關卡才顯示。 */
    async onlyRoom() {
      if (hostRoom) return hostRoom;
      for (let i = 0; i < 40; i++) {
        const rooms = (await db.raw("rooms")) || {};
        const keys = Object.keys(rooms);
        if (keys.length === 1) { hostRoom = keys[0]; return hostRoom; }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error("找不到唯一的房間——請在建立玩家裝置「之前」呼叫，因為玩家分頁一開始也是指揮官身分，會各自建立房間");
    },
    /* 把房間樹組回舊測試熟悉的形狀，方便沿用既有斷言 */
    async room(code) {
      const t = (await db.raw(`rooms/${code}`)) || {};
      const asMap = (v) => {
        if (!v) return {};
        if (Array.isArray(v)) { const o = {}; v.forEach((x, i) => { if (x != null) o[String(i)] = x; }); return o; }
        return v;
      };
      const taken = asMap(t.taken);
      const nt = {}; Object.keys(taken).forEach((g) => { nt[g] = asMap(taken[g]); });
      const gs = asMap(t.guesses);
      const ng = {}; Object.keys(gs).forEach((k) => { ng[k] = asMap(gs[k]); });
      const s = t.session || null;
      if (!s) return null;
      return {
        ...s,
        takenNumbers: nt,
        ttol: { phase: s.ttolPhase || "writing", profiles: asMap(t.profiles), guesses: ng },
      };
    },
  };

  async function close() {
    for (const c of contexts) await c.close();
    await browser.close();
    server.close();
    emu.stop();
  }

  return { device, db, stats, close, dbUrl };
}

async function joinAs(page, code) {
  await page.click("text=我是皮克敏（輸入房間代碼加入）");
  await page.fill('input[placeholder="房間代碼"]', code);
  await page.click('button:has-text("加入遊戲")');
  await page.waitForSelector("text=返回指揮官介面", { timeout: 20000 }).catch(async () => {
    const err = await page.textContent("body");
    throw new Error("加入失敗，畫面訊息: " + err.replace(/\s+/g, " ").slice(0, 300));
  });
}

async function fillProfile(page, nickname, lieIdx = 0) {
  await page.fill('input[placeholder="所屬基地"]', "測試基地");
  await page.fill('input[placeholder="代號"]', nickname + "代號");
  await page.fill('input[placeholder="暱稱"]', nickname);
  for (let i = 1; i <= 4; i++) await page.fill(`input[placeholder="第 ${i} 則情報"]`, `${nickname}的情報${i}`);
  await page.locator('input[type="radio"]').nth(lieIdx).check();
  await page.click('button:has-text("提交")');
}

const ok = (cond, msg) => console.log(`  ${cond ? "✓" : "✗ 失敗:"} ${msg}`);

module.exports = { makeWorld, joinAs, fillProfile, ok };
