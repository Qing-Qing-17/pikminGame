/* 情境 E：指揮官按「重新開始（換活動）」後，玩家的自我修復機制不可以把舊資料寫回去。 */
const { makeWorld, joinAs, ok } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");
  await host.click("text=培訓");
  await host.click("text=開始第一關：皮克敏迫降");
  await host.click("text=前往下一關");
  await host.waitForSelector("text=皮克敏加入");
  const code = (await host.textContent(".text-4xl.font-black.tracking-widest")).trim();

  const p = await world.device("p0");
  await joinAs(p, code);
  await host.click("text=開始：情報交換");
  await p.waitForSelector("text=選擇你的小隊", { timeout: 20000 });
  await p.click(".grid.grid-cols-3 button:has-text('1')");
  await p.fill('input[placeholder="所屬基地"]', "基地");
  await p.fill('input[placeholder="代號"]', "代號");
  await p.fill('input[placeholder="暱稱"]', "小綠");
  for (let k = 1; k <= 4; k++) await p.fill(`input[placeholder="第 ${k} 則情報"]`, `情報${k}`);
  await p.click('button:has-text("提交")');
  await p.waitForSelector("text=提交完成！", { timeout: 20000 });

  let n = Object.keys(((await world.db.room(code)).ttol || {}).profiles || {}).length;
  ok(n === 1, `重置前伺服器上有 ${n} 份情報`);

  await host.click("text=重新開始（換活動）");
  await host.waitForSelector("text=選擇今天要進行的活動", { timeout: 20000 });

  // 給玩家好幾個輪詢週期，看看修復機制會不會把舊情報寫回去
  await host.waitForTimeout(12000);
  const after = (await world.db.room(code));
  n = Object.keys((after.ttol || {}).profiles || {}).length;
  ok(n === 0, `重置後伺服器上有 ${n} 份情報（應為 0，舊資料不該被寫回）`);
  // Firebase 會直接刪除值為 null 的鍵，所以讀回來是 undefined；兩者都代表「沒有進行中的活動」
  ok(after.activity == null, `重置後沒有進行中的活動（實際: ${JSON.stringify(after.activity)}）`);
  ok(await p.isVisible("text=等待指揮官選擇今天要進行的活動"), "玩家畫面回到等待選擇活動");

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
