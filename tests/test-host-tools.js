/* 主持人端的工具與流程：重整不會換房間、音樂已移除、定格、
   倒數計時器小工具、自動隨機會自己換人數。 */
const { makeWorld, hostAdvance, finishSetup, roomCodeOnScreen, joinAs, ok } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";
// 正式是 1～2 分鐘換一次，測試等不了，把區間縮成 3～6 秒（harness 會改寫常數）
process.env.FAST_AUTO = process.env.FAST_AUTO || "3000";
const attrs = (page) => page.evaluate(() => {
  const e = document.querySelector('[data-testid="app"]');
  return { stage: e.dataset.stage, room: e.dataset.room };
});

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");
  await host.click("text=星攻略");
  await hostAdvance(host, "開始第一關：皮克敏迫降");

  const cell = await host.textContent("#root");
  ok(!/背景音樂|選擇音樂檔案/.test(cell), "音樂功能已移除（改用外部播放）");
  ok(!/遊戲倒數/.test(cell), "倒數計時器不再佔用集合人數的畫面");

  // 定格
  const p = await world.device("p0");
  await host.click("text=前往下一關");
  await finishSetup(host);
  const code = await roomCodeOnScreen(host);
  await joinAs(p, code);
  await host.click("text=上一關");
  await host.waitForSelector("text=定格（全場停住）", { timeout: 20000 });
  await host.click("text=定格（全場停住）");
  await p.waitForSelector("text=定格！", { timeout: 20000 });
  ok(true, "按下定格後，皮克敏的畫面立刻顯示定格");
  await host.click("text=解除定格，繼續");
  await p.waitForSelector('[data-testid="cell-target"]', { timeout: 20000 });
  ok(true, "解除後恢復正常畫面");

  // 計時器小工具
  await host.click("text=倒數計時器");
  await host.waitForSelector('[data-testid="timer-tool"]', { timeout: 10000 });
  await host.click("text=縮小視窗");
  await host.waitForSelector('[data-testid="timer-mini"]', { timeout: 10000 });
  ok(await host.isVisible('[data-testid="cell-target"]'), "縮小後不擋住底下的操作");
  await host.click('[data-testid="timer-mini"]');
  await host.click("text=返回");
  ok(!(await host.isVisible('[data-testid="timer-tool"]')), "可以返回關閉");

  // 自動隨機：不用按，時間到自己換人數，而且皮克敏那邊也會跟著換
  await host.click("text=自動隨機");
  await host.waitForSelector('[data-testid="auto-hint"]', { timeout: 10000 });
  const t0 = (await host.textContent('[data-testid="cell-target"]')).trim();
  await host.waitForFunction(
    (prev) => document.querySelector('[data-testid="cell-target"]').textContent.trim() !== prev,
    t0,
    { timeout: 20000 },
  );
  const t1 = (await host.textContent('[data-testid="cell-target"]')).trim();
  ok(t1 !== t0, `自動隨機會自己換人數（${t0} → ${t1}）`);
  await p.waitForFunction(
    (n) => document.querySelector('[data-testid="cell-target"]').textContent.trim() === n,
    t1,
    { timeout: 20000 },
  );
  ok(true, "皮克敏端同步看到新的人數");

  await host.click("text=手動指定");
  const held = (await host.textContent('[data-testid="cell-target"]')).trim();
  await host.waitForTimeout(9000);
  ok((await host.textContent('[data-testid="cell-target"]')).trim() === held, "切回手動指定後就不會自己再換");

  // 主機重整不會換房間
  const before = await attrs(host);
  await host.waitForTimeout(2000);
  // 每個分頁一開就是指揮官視角，都會開一個自己的房間；只看重整有沒有再多開一個。
  const roomsBefore = Object.keys(await world.db.raw("rooms"));
  await host.reload();
  await host.waitForTimeout(6000);
  const after = await attrs(host);
  const roomsAfter = Object.keys(await world.db.raw("rooms"));
  ok(after.room === before.room, `重整後仍是同一個房間（${before.room}）`);
  ok(after.stage === before.stage, `重整後仍停在同一關（${after.stage}）`);
  ok(roomsAfter.length === roomsBefore.length, `重整沒有多開房間（前 ${roomsBefore.length} 個、後 ${roomsAfter.length} 個）`);

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
