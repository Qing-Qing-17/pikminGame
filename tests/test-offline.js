/* 情境 D：完全連不上資料庫（現場沒網路），以及後端根本還沒設定。
   指揮官都應該仍能跑完自己那台裝置的流程，並且不對死掉的端點空轉。 */
const { makeWorld, ok, hostAdvance, finishSetup } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";

(async () => {
  // 情況一：程式碼裡還沒填資料庫網址
  {
    const world = await makeWorld(GAME, { noBackend: true });
    const host = await world.device("host");
    await host.waitForSelector("text=選擇今天要進行的活動", { timeout: 20000 });
    ok(true, "尚未設定後端時，指揮官畫面仍正常載入");
    await host.click("text=星攻略");
    await finishSetup(host);
    const t = await host.textContent("#root");
    ok(/多人連線無法使用/.test(t) && /還沒有填入 Firebase 資料庫網址/.test(t), "警告中明確說出是「還沒填資料庫網址」");

    await host.goto(host.url().split("?")[0] + "?join");
    await host.waitForSelector('input[placeholder="房間代碼"]', { timeout: 20000 });
    await host.fill('input[placeholder="房間代碼"]', "123456");
    await host.click('button:has-text("加入遊戲")');
    await host.waitForSelector("text=還沒有設定同步伺服器", { timeout: 15000 });
    ok(true, "玩家會看到「尚未設定同步伺服器」而不是誤以為自己網路有問題");
    await world.close();
  }

  // 情況二：有設定，但連不上（現場網路擋住）
  {
    const world = await makeWorld(GAME);
    const host = await world.device("host", { blockDb: true });
    await host.waitForSelector("text=選擇今天要進行的活動", { timeout: 20000 });
    await host.click("text=星攻略");
    await hostAdvance(host, "開始第一關：皮克敏迫降");
    await host.click("text=前往下一關");
    await finishSetup(host);
    await hostAdvance(host, "開始：偽裝洞穴");
    await host.click("text=抽任務卡");
    await host.waitForSelector("text=各小隊抽取進度", { timeout: 15000 });
    ok(true, "連不上時指揮官仍能抽出任務卡");

    const before = world.stats.requests;
    await host.waitForTimeout(6000);
    ok(world.stats.requests - before <= 1, `不再對連不上的端點空轉（6 秒內新增 ${world.stats.requests - before} 個請求）`);
    await world.close();
  }
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
