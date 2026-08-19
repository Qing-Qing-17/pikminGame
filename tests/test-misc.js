/* 情境 F：故事編輯器、計時器、以及玩家端同步顯示。 */
const { makeWorld, joinAs, ok } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");
  await host.click("text=星攻略");

  // 故事編輯器
  await host.click("text=編輯故事");
  await host.waitForSelector("textarea");
  await host.fill("textarea >> nth=0", "這是改寫過的序章。");
  await host.click('button:has-text("儲存")');
  await host.waitForSelector("text=已儲存", { timeout: 20000 });
  await host.click('button:has-text("返回")');
  ok(await host.isVisible("text=這是改寫過的序章。"), "編輯後的序章有顯示在畫面上");
  const stored = world.store.read((await host.evaluate(() => location.href), "bkt1"), "state");
  ok(stored.storyText.star.intro === "這是改寫過的序章。", "改寫後的故事有寫進伺服器");
  ok(stored.storyText.training && typeof stored.storyText.training.intro === "string", "另一個活動的故事欄位結構完整");

  // 計時器
  await host.click("text=開始第一關：皮克敏迫降");
  await host.waitForSelector("text=遊戲倒數");
  ok(await host.isVisible("text=03:00"), "預設倒數為 3 分鐘");
  await host.click('button:has-text("01:00")');
  ok(await host.isVisible("text=01:00"), "可以切換為 1 分鐘");

  const p = await world.device("p0");
  await joinAs(p, "bkt1");
  // 「開始」與標題列的「重新開始（換活動）」都含有「開始」，取後者以外的那一個
  await host.locator('button:has-text("開始")').last().click();
  await p.waitForTimeout(4000);
  const seen = await p.textContent("body");
  ok(/00:5\d/.test(seen), `皮克敏看到同步的倒數（畫面上有 ${(seen.match(/00:\d\d/) || ["?"])[0]}）`);

  await host.click("text=隨機變換人數");
  await p.waitForTimeout(4000);
  const hostTarget = (await host.textContent(".text-6xl")).trim();
  const playerTarget = (await p.textContent(".text-7xl")).trim();
  ok(hostTarget === playerTarget, `集合人數同步一致（指揮官 ${hostTarget} / 皮克敏 ${playerTarget}）`);

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
