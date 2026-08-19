/* A 階段：房間代碼常駐、回上一關、任務卡編輯去抖動、空白情境不入池、時鐘校正。 */
const { makeWorld, joinAs, ok, roomCodeOnScreen, hostAdvance, finishSetup } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");

  await host.click("text=星攻略");
  await hostAdvance(host, "開始第一關：皮克敏迫降");
  await host.click("text=前往下一關");
  await finishSetup(host);
  const code = await roomCodeOnScreen(host);

  // A1: 進入下一關之後，房間代碼仍然拿得到
  await hostAdvance(host, "開始：偽裝洞穴");
  await host.waitForSelector("text=抽任務卡", { timeout: 15000 });
  ok(await host.isVisible("text=房間代碼"), "偽裝洞穴這一關仍然看得到房間代碼");
  const shown = (await host.textContent("#root")).replace(/\s+/g, " ");
  ok(shown.includes(code), `代碼內容一致（讀到 ${code}；畫面上的數字：${JSON.stringify((shown.match(/\\b\\d{6}\\b/g) || []).slice(0,3))}）`);

  // A1: 回上一關
  await host.click("text=上一關");
  await host.waitForSelector("text=下一頁", { timeout: 20000 });
  ok(true, "可以回到上一關");
  await hostAdvance(host, "開始：偽裝洞穴");
  await host.waitForSelector("text=抽任務卡", { timeout: 15000 });

  // A2: 編輯任務卡時，逐鍵輸入只產生一次寫入
  await host.click("text=編輯任務卡");
  await host.waitForSelector('input[placeholder="皮克敏要喊出的暗號"]');
  // 只留一張任務卡，抽卡結果才是確定的
  while ((await host.locator('input[placeholder="皮克敏要喊出的暗號"]').count()) > 1) {
    await host.locator('button').filter({ hasText: "🗑️" }).last().click();
    await host.waitForTimeout(1200);
  }
  const putsBefore = world.stats.writesByKey.cards || 0;
  await host.locator('input[placeholder="皮克敏要喊出的暗號"]').first().fill("");
  await host.locator('input[placeholder="皮克敏要喊出的暗號"]').first().pressSequentially("快跑啊快跑", { delay: 60 });
  await host.waitForTimeout(2500);
  const puts = (world.stats.writesByKey.cards || 0) - putsBefore;
  ok(puts <= 3, `輸入 5 個字只產生 ${puts} 次寫入（未去抖動時每個字一次）`);

  // A3: 清空一則情境後，它不應該再被抽到
  const scen = host.locator('input[placeholder^="第 "]');
  for (let i = 0; i < 6; i++) await scen.nth(i).fill("");   // 只留下第 7、8 則
  await host.waitForTimeout(1500);
  await host.click("text=回到遊戲");
  await host.click("text=抽任務卡");
  await host.waitForTimeout(1500);
  const progress = await host.textContent('[data-testid="group-progress"]');
  ok(/0\/2/.test(progress), `進度分母只算已填寫的情境：${progress.replace(/\s+/g, " ").trim().slice(0, 22)}`);

  const p = await world.device("p0");
  await joinAs(p, code);
  await p.waitForSelector("text=選擇你的小隊", { timeout: 15000 });
  await p.click(".grid.grid-cols-3 button:has-text('1')");
  await p.click('button:has-text("抽情境牌")');
  await p.waitForSelector("text=/第 \\d+ 號/", { timeout: 20000 });
  const n = Number((await p.textContent("#root")).replace(/\s+/g, " ").match(/第 (\d+) 號/)[1]);
  ok(n === 7 || n === 8, `抽到的是有填內容的情境（第 ${n} 號，應為 7 或 8）`);

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
