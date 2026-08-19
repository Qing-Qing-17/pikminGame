/* B5：假情報的答案不可以出現在共用狀態裡，但判定仍要正確。 */
const { makeWorld, joinAs, ok } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";

async function fill(page, i, lieIdx) {
  await page.fill('input[placeholder="所屬基地"]', "基地" + i);
  await page.fill('input[placeholder="代號"]', "代號" + i);
  await page.fill('input[placeholder="暱稱"]', "皮" + i);
  for (let k = 1; k <= 4; k++) await page.fill(`input[placeholder="第 ${k} 則情報"]`, `皮${i}的情報${k}`);
  await page.locator('input[type="radio"]').nth(lieIdx).check();
  await page.click('button:has-text("提交")');
  await page.waitForSelector("text=提交完成！", { timeout: 20000 });
}

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");
  await host.click("text=培訓");
  await host.click("text=開始第一關：皮克敏迫降");
  await host.click("text=前往下一關");
  await host.waitForSelector("text=皮克敏加入");
  const code = (await host.textContent(".text-4xl.font-black.tracking-widest")).trim();

  const a = await world.device("a");
  const b = await world.device("b");
  await joinAs(a, code);
  await joinAs(b, code);
  await host.click("text=開始：情報交換");
  for (const p of [a, b]) {
    await p.waitForSelector("text=選擇你的小隊", { timeout: 20000 });
    await p.click(".grid.grid-cols-3 button:has-text('1')");
  }
  await fill(a, 0, 2);   // 皮0 的假情報是第 3 則（索引 2）
  await fill(b, 1, 0);

  // 共用狀態裡不能有任何答案欄位
  const raw = JSON.stringify((await world.db.room(code)));
  ok(!/lieIndex/.test(raw), "共用狀態裡沒有 lieIndex 欄位");
  const profiles = (await world.db.room(code)).ttol.profiles;
  const keys = new Set();
  Object.values(profiles).forEach((p) => Object.keys(p).forEach((k) => keys.add(k)));
  ok(!keys.has("lieIndex") && !keys.has("lie"), `上傳的情報欄位只有：${[...keys].join(", ")}`);

  await host.click("text=大家自我介紹完了，開始情報判讀");
  for (const p of [a, b]) await p.waitForSelector("text=的哪一則情報是假的？", { timeout: 20000 });

  // 皮1 猜皮0 的第 1 則（錯的）
  await b.locator('button:has-text("1. ")').first().click();
  await b.click('button:has-text("送出第一次判讀")');
  // 猜測者只上傳「我猜第幾則」，對錯欄位留白，由對方的裝置填上
  let firstRecord = null;
  for (let i = 0; i < 20 && !firstRecord; i++) {
    const g = ((await world.db.room(code)).ttol.guesses || {});
    const forA = g[Object.keys(g)[0]] || {};
    firstRecord = Object.values(forA)[0] || null;
    if (!firstRecord) await b.waitForTimeout(200);
  }
  ok(firstRecord && typeof firstRecord.pick === "number",
     `上傳的是猜測本身而非對錯判定：${JSON.stringify(firstRecord)}`);
  await b.waitForSelector("text=還沒判讀成功", { timeout: 25000 });
  ok(true, "第一次猜錯，由對方的裝置判定為未成功");

  // 第二次猜對
  await b.locator('button:has-text("3. ")').first().click();
  await b.click('button:has-text("再判讀一次（第 2 次）")');
  await b.waitForSelector("text=判讀成功", { timeout: 25000 });
  ok(true, "第二次猜中，判定為成功");

  // 指揮官看得到統計
  let tally = "";
  for (let i = 0; i < 12; i++) {
    await host.waitForTimeout(2000);
    tally = await host.textContent("#root");
    if (/判讀成功 1/.test(tally)) break;
  }
  ok(/判讀成功 1/.test(tally), "指揮官的統計正確反映判定結果");

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
