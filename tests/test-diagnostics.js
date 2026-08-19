/* 同步失敗時，畫面要說出「為什麼」而不只是「連不上」。
   最常見的兩種：Firebase 規則拒絕存取，以及網路完全不通。 */
const { makeWorld, ok } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";

(async () => {
  // 一、Firebase 回 401 Permission denied（規則是鎖定模式，或測試模式已過期）
  {
    const world = await makeWorld(GAME);
    const host = await world.device("host", { denyDb: true });
    await host.waitForSelector("text=選擇今天要進行的活動", { timeout: 20000 });
    await host.click("text=星攻略");
    await host.click("text=開始第一關：皮克敏迫降");
    await host.click("text=前往下一關");
    await host.waitForSelector("text=皮克敏加入", { timeout: 20000 });
    const txt = await host.textContent("#root");
    ok(/權限不足/.test(txt), "指出是權限問題，不是網路問題");
    ok(/規則/.test(txt), "告訴使用者要去改哪裡（Firebase 的規則）");
    ok(!/請檢查網路連線後再試一次/.test(txt), "沒有誤導使用者去查自己的網路");

    await host.click("text=我是皮克敏（輸入房間代碼加入）");
    await host.fill('input[placeholder="房間代碼"]', "ABC123");
    await host.click('button:has-text("加入遊戲")');
    await host.waitForSelector("text=不是代碼打錯", { timeout: 20000 });
    const jtxt = await host.textContent("#root");
    ok(/權限不足/.test(jtxt), "玩家端也看得到真正的原因");
    await world.close();
  }

  // 二、完全連不上（網路不通或網址打錯）
  {
    const world = await makeWorld(GAME);
    const host = await world.device("host", { blockDb: true });
    await host.click("text=星攻略");
    await host.click("text=開始第一關：皮克敏迫降");
    await host.click("text=前往下一關");
    await host.waitForSelector("text=皮克敏加入", { timeout: 20000 });
    const txt = await host.textContent("#root");
    ok(/網路不通|網址打錯/.test(txt), `斷線時說明可能是網路或網址問題`);
    ok(/測試：進入皮克敏介面/.test(txt), "同時告知還能怎麼繼續");
    await world.close();
  }
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
