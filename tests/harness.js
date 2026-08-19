/* 用 Playwright 實際跑 index.html：CDN 換成本地檔案，kvdb.io 換成共用的記憶體版。
   每個參與者用獨立的 browser context（各自的 localStorage），等同不同裝置。
   頁面用本機 HTTP 提供，這樣 localStorage 才是正常可用的。 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const NM = path.join(__dirname, "..", "node_modules");
const LOCAL = {
  "react/18.2.0/umd/react.production.min.js": path.join(NM, "react/umd/react.production.min.js"),
  "react-dom/18.2.0/umd/react-dom.production.min.js": path.join(NM, "react-dom/umd/react-dom.production.min.js"),
  "babel-standalone/7.23.5/babel.min.js": path.join(NM, "@babel/standalone/babel.min.js"),
};

// 模擬真實網路往返，否則競態窗口小到測不出來（真的 kvdb.io 大約 100–300ms）
const LATENCY = Number(process.env.LATENCY || 120);
const lag = () => new Promise((r) => setTimeout(r, LATENCY * (0.6 + Math.random() * 0.8)));

function makeStore() {
  const buckets = new Map();
  let n = 0;
  const stats = { get: 0, put: 0, putByKey: {} };
  return {
    stats,
    wipe(bucket, key) { const b = buckets.get(bucket); if (b) b.delete(key); },
    read(bucket, key) {
      const b = buckets.get(bucket);
      const raw = b && b.get(key);
      return raw ? JSON.parse(raw) : null;
    },
    async handle(route, request) {
      await lag();
      const url = new URL(request.url());
      const method = request.method();
      const parts = url.pathname.split("/").filter(Boolean);
      if (method === "POST" && parts.length === 0) {
        const id = "bkt" + ++n;
        buckets.set(id, new Map());
        return route.fulfill({ status: 200, body: id });
      }
      if (method === "HEAD") return route.fulfill({ status: 200, body: "" });
      const [bucket, key] = parts;
      if (!bucket || !key) return route.fulfill({ status: 404, body: "" });
      if (!buckets.has(bucket)) buckets.set(bucket, new Map());
      const b = buckets.get(bucket);
      if (method === "PUT") {
        stats.put++;
        stats.putByKey[key] = (stats.putByKey[key] || 0) + 1;
        const body = request.postData();
        if (process.env.TRACE && key === "state") {
          let s = {};
          try { s = JSON.parse(body); } catch (e) {}
          console.log(`    PUT ${bucket}/state stage=${s.stage} profiles=${Object.keys((s.ttol || {}).profiles || {}).length} @${new Date().toISOString().slice(17, 23)}`);
        }
        b.set(key, body);
        return route.fulfill({ status: 200, body: "ok" });
      }
      stats.get++;
      if (!b.has(key)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, body: b.get(key) });
    },
  };
}

async function startServer(gameFile) {
  const html = fs.readFileSync(gameFile, "utf8");
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

async function makeWorld(gameFile) {
  const { server, url } = await startServer(gameFile);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const store = makeStore();
  const contexts = [];

  async function device(label, opts = {}) {
    const ctx = await browser.newContext();
    // 模擬這台裝置的系統時鐘偏差（Date.now 整體平移，但仍持續前進）
    if (opts.clockSkewMs) {
      await ctx.addInitScript(`(() => {
        const skew = ${opts.clockSkewMs};
        const RealDate = Date;
        const D = function (...a) { return a.length ? new RealDate(...a) : new RealDate(RealDate.now() + skew); };
        D.prototype = RealDate.prototype;
        D.now = () => RealDate.now() + skew;
        D.parse = RealDate.parse; D.UTC = RealDate.UTC;
        window.Date = D;
      })()`);
    }
    contexts.push(ctx);
    await ctx.route("**://kvdb.io/**", (route, req) => store.handle(route, req));
    await ctx.route("**://cdnjs.cloudflare.com/**", (route, req) => {
      const hit = Object.keys(LOCAL).find((k) => req.url().includes(k));
      return route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: hit ? fs.readFileSync(LOCAL[hit], "utf8") : "",
      });
    });
    await ctx.route("**://cdn.tailwindcss.com/**", (r) => r.fulfill({ status: 200, body: "", contentType: "application/javascript" }));
    await ctx.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, body: "", contentType: "text/css" }));
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`  ✗ [${label}] 頁面錯誤: ${e.message}`));
    // 點擊失敗時把當下畫面狀態印出來，才能分辨是程式問題還是測試時序問題
    const rawClick = page.click.bind(page);
    page.click = async (sel, opts) => {
      try { return await rawClick(sel, opts); }
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

  async function close() {
    for (const c of contexts) await c.close();
    await browser.close();
    server.close();
  }

  return { device, store, close, wipe: (b, k) => store.wipe(b, k) };
}

/* 讓一個分頁以皮克敏身分加入指定房間 */
async function joinAs(page, code) {
  await page.click("text=我是皮克敏（輸入房間代碼加入）");
  await page.fill('input[placeholder="房間代碼"]', code);
  await page.click('button:has-text("加入遊戲")');
  await page.waitForSelector("text=返回指揮官介面", { timeout: 15000 }).catch(async (e) => {
    const err = await page.textContent("body");
    throw new Error("加入失敗，畫面訊息: " + err.replace(/\s+/g, " ").slice(0, 300));
  });
}

async function fillProfile(page, nickname) {
  await page.fill('input[placeholder="所屬基地"]', "測試基地");
  await page.fill('input[placeholder="代號"]', nickname + "代號");
  await page.fill('input[placeholder="暱稱"]', nickname);
  for (let i = 1; i <= 4; i++) await page.fill(`input[placeholder="第 ${i} 則情報"]`, `${nickname}的情報${i}`);
  await page.click("text=提交");
}

const ok = (cond, msg) => console.log(`  ${cond ? "✓" : "✗ 失敗:"} ${msg}`);

module.exports = { makeWorld, joinAs, fillProfile, ok };
