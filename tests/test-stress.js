/* 情境 C：同一小隊 6 人「同時」提交情報、接著「同時」送出判讀。
   這正是 TtolHostView 說明文字宣告的玩法（大家同時判讀、不用輪流等待）。 */
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
    console.log("指揮官畫面目前是:", (await host.textContent("body")).replace(/\s+/g, " ").slice(0, 400));
    throw e;
  });
  for (const p of players) {
    await p.waitForSelector("text=選擇你的小隊", { timeout: 20000 });
    await p.click(".grid.grid-cols-3 button:has-text('1')");
    await p.waitForSelector('input[placeholder="所屬基地"]', { timeout: 20000 });
  }

  // 先各自把表單填好，最後才「同時」按提交
  await Promise.all(players.map(async (p, i) => {
    await p.fill('input[placeholder="所屬基地"]', "基地" + i);
    await p.fill('input[placeholder="代號"]', "代號" + i);
    await p.fill('input[placeholder="暱稱"]', "皮" + i);
    for (let k = 1; k <= 4; k++) await p.fill(`input[placeholder="第 ${k} 則情報"]`, `情報${i}-${k}`);
    // 第 i 個人把第 (i % 4) 則標為假的
    await p.locator('input[type="radio"]').nth(i % 4).check();
  }));
  await Promise.all(players.map((p) => p.click('button:has-text("提交")')));
  await host.waitForTimeout(20000);

  let stored = world.store.read(code, "state");
  let profiles = (stored.ttol && stored.ttol.profiles) || {};
  ok(Object.keys(profiles).length === N, `同時提交後，伺服器上有 ${Object.keys(profiles).length} 份情報（應為 ${N}）`);

  await host.click("text=大家自我介紹完了，開始情報判讀");
  for (const p of players) await p.waitForSelector("text=的哪一則情報是假的？", { timeout: 20000 });

  // 每個人同時對「同小隊第一位可判讀對象」送出一次判讀
  await Promise.all(players.map(async (p) => {
    await p.locator('button:has-text("1. ")').first().click();
    await p.click('button:has-text("送出第一次判讀")');
  }));
  await host.waitForTimeout(25000);

  stored = world.store.read(code, "state");
  const guesses = (stored.ttol && stored.ttol.guesses) || {};
  const totalGuesses = Object.values(guesses).reduce((sum, byJudge) => sum + Object.keys(byJudge).length, 0);
  ok(totalGuesses === N, `同時送出後，伺服器上有 ${totalGuesses} 筆判讀（應為 ${N}）`);
  ok(Object.keys((stored.ttol && stored.ttol.profiles) || {}).length === N, "判讀階段沒有弄丟任何人的情報");

  // 判讀畫面上每個人都應該看到自己那次判讀的結果，而不是還停在未送出
  const pending = [];
  for (let i = 0; i < N; i++) {
    const txt = await players[i].textContent("body");
    if (!/判讀成功|判讀失敗|還沒判讀成功/.test(txt)) pending.push(i);
  }
  ok(pending.length === 0, `每位皮克敏都看到自己的判讀結果（未顯示結果者：${JSON.stringify(pending)}）`);

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
