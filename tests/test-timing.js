/* 量測：6 人同時按下「提交」後，各自過多久才真的寫進伺服器（或宣告失敗）。 */
const { makeWorld, joinAs, ok } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";
const N = 6;

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");
  await host.click("text=培訓");
  await host.click("text=開始第一關：皮克敏迫降");
  await host.click("text=前往下一關");
  await host.waitForSelector("text=皮克敏加入");
  const code = (await host.textContent(".text-4xl.font-black.tracking-widest")).trim();

  const players = [];
  for (let i = 0; i < N; i++) {
    const p = await world.device("p" + i);
    await joinAs(p, code);
    players.push(p);
  }
  await host.click("text=開始：情報交換").catch(async (e) => {
    const body = (await host.textContent("body")).replace(/\s+/g, " ");
    console.log("指揮官所在關卡:", (body.match(/目前身份：指揮官 · ([^·]+)/) || [])[1]);
    throw e;
  });
  for (const p of players) {
    await p.waitForSelector("text=選擇你的小隊", { timeout: 20000 });
    await p.click(".grid.grid-cols-3 button:has-text('1')");
    await p.waitForSelector('input[placeholder="所屬基地"]', { timeout: 20000 });
  }
  await Promise.all(players.map(async (p, i) => {
    await p.fill('input[placeholder="所屬基地"]', "基地" + i);
    await p.fill('input[placeholder="代號"]', "代號" + i);
    await p.fill('input[placeholder="暱稱"]', "皮" + i);
    for (let k = 1; k <= 4; k++) await p.fill(`input[placeholder="第 ${k} 則情報"]`, `情報${i}-${k}`);
  }));

  const t0 = Date.now();
  const results = await Promise.all(players.map(async (p, i) => {
    await p.click('button:has-text("提交")');
    try {
      await p.waitForSelector("text=提交完成！", { timeout: 60000 });
      return { i, ms: Date.now() - t0, outcome: "成功" };
    } catch (e) {
      const failed = await p.isVisible("text=沒有提交成功");
      return { i, ms: Date.now() - t0, outcome: failed ? "宣告失敗" : "仍在嘗試" };
    }
  }));

  results.sort((a, b) => a.ms - b.ms);
  for (const r of results) console.log(`  皮${r.i}: ${r.outcome}，耗時 ${(r.ms / 1000).toFixed(1)}s`);
  const immediate = Object.keys(((await world.db.room(code)).ttol || {}).profiles || {}).length;
  console.log(`  按下提交後立刻查看：伺服器上有 ${immediate} 份`);

  // 自我修復是靠輪詢進行的，給它幾個輪詢週期
  for (let s = 3; s <= 15; s += 3) {
    await host.waitForTimeout(3000);
    const n = Object.keys(((await world.db.room(code)).ttol || {}).profiles || {}).length;
    console.log(`  ${s}s 後：${n} 份`);
    if (n === N) break;
  }
  const stored = (await world.db.room(code));
  const n = Object.keys((stored.ttol && stored.ttol.profiles) || {}).length;
  ok(n === N, `最終伺服器上共有 ${n} 份情報（應為 ${N}）`);
  console.log(`  kvdb 請求量: GET ${world.stats.requests} / PUT ${world.stats.requests}`);
  const slowest = Math.max(...results.map((r) => r.ms));
  ok(slowest < 12000, `最慢的一位在 ${(slowest / 1000).toFixed(1)}s 內完成（門檻 12s）`);

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
