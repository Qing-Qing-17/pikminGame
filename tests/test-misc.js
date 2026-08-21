/* 情境 F：故事編輯器、計時器、以及玩家端同步顯示。 */
const { makeWorld, joinAs, ok, hostAdvance, finishSetup, openTimer } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");
  await host.click("text=星攻略");
  // 設定完小隊數、按下進入故事，才會看得到序章
  await finishSetup(host);
  await host.click("text=進入故事");
  await host.waitForSelector("text=下一頁", { timeout: 20000 });

  // 故事編輯器
  await host.click("text=編輯故事");
  await host.waitForSelector("textarea");
  await host.fill("textarea >> nth=0", "這是改寫過的序章。");
  await host.click('button:has-text("儲存")');
  await host.waitForSelector("text=已儲存", { timeout: 20000 });
  await host.click('button:has-text("返回")');
  ok(await host.isVisible("text=這是改寫過的序章。"), "編輯後的序章有顯示在畫面上");
  const stored = await world.db.room(await world.db.onlyRoom());
  ok(Array.isArray(stored.storyText.star.intro) && stored.storyText.star.intro[0] === "這是改寫過的序章。",
     `改寫後的故事以「一行一頁」存進伺服器：${JSON.stringify(stored.storyText.star.intro)}`);
  // 沒改寫過的活動不會有覆寫值，畫面會退回預設故事——確認退回機制仍然有效
  ok(!stored.storyText.training || !stored.storyText.training.intro, "沒改寫過的活動不會被寫入覆寫值");

  // 計時器（現在是隨開隨關的小工具，不再固定佔著關卡畫面）
  await hostAdvance(host, "開始第一關：皮克敏迫降");
  await openTimer(host);
  ok(await host.isVisible("text=03:00"), "預設倒數為 3 分鐘");
  await host.click('button:has-text("01:00")');
  ok(await host.isVisible("text=01:00"), "可以切換為 1 分鐘");

  const code = await world.db.onlyRoom();
  const p = await world.device("p0");
  await joinAs(p, code);
  // 「開始」與標題列的「重新開始（換活動）」都含有「開始」，取後者以外的那一個
  await host.click('[data-testid="timer-tool"] button:has-text("開始")');
  await host.click("text=縮小視窗");
  await p.waitForTimeout(4000);
  const seen = await p.textContent("body");
  ok(/00:5\d/.test(seen), `皮克敏看到同步的倒數（畫面上有 ${(seen.match(/00:\d\d/) || ["?"])[0]}）`);

  await host.click("text=自動隨機");
  await host.waitForSelector("text=現在就換一個", { timeout: 15000 });
  await host.click("text=現在就換一個");
  await p.waitForTimeout(4000);
  const hostTarget = (await host.textContent('[data-testid="cell-target"]')).trim();
  const playerTarget = (await p.textContent('[data-testid="cell-target"]')).trim();
  ok(hostTarget === playerTarget, `集合人數同步一致（指揮官 ${hostTarget} / 皮克敏 ${playerTarget}）`);

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
