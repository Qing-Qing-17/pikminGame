/* 情境 A：指揮官按下「開始情報判讀」時，會不會把玩家剛填好的情報清空？
   同時驗證指揮官的「已提交名單」看不看得到玩家。 */
const { makeWorld, joinAs, fillProfile, ok, roomCodeOnScreen, hostAdvance, finishSetup } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");

  // 指揮官：培訓 → 序章 → 皮克敏迫降 → 故事繼續一（此處會顯示房間代碼）
  await host.click("text=培訓");
  await hostAdvance(host, "開始第一關：皮克敏迫降");
  await host.click("text=前往下一關");
  await finishSetup(host);
  const code = await roomCodeOnScreen(host);
  console.log("房間代碼:", code);

  // 兩位皮克敏各自用獨立裝置加入，選第 1 小隊、填寫情報
  const p1 = await world.device("p1");
  const p2 = await world.device("p2");
  await joinAs(p1, code);
  await joinAs(p2, code);

  await hostAdvance(host, "開始：情報交換");
  for (const p of [p1, p2]) {
    await p.waitForSelector("text=選擇你的小隊", { timeout: 15000 });
    await p.click(".grid.grid-cols-3 button:has-text('1')");
  }
  await fillProfile(p1, "阿紅");
  await fillProfile(p2, "小藍");
  await p1.waitForSelector("text=提交完成！");
  await p2.waitForSelector("text=提交完成！");

  // 指揮官必須在自己畫面上看到兩人（這需要 host 也會輪詢遠端）
  await host.waitForTimeout(4000);
  const roster = await host.textContent(".rounded-2xl.p-4.mb-5");
  ok(roster.includes("阿紅") && roster.includes("小藍"), `指揮官看得到已提交名單：${roster.replace(/\s+/g, " ").trim()}`);

  // 關鍵：這一按曾經會把兩人的情報整包清掉
  await host.click("text=大家自我介紹完了，開始情報判讀");
  await host.waitForTimeout(4000);

  const stored = (await world.db.room(code));
  const names = Object.values((stored.ttol && stored.ttol.profiles) || {}).map((p) => p.nickname);
  ok(names.length === 2, `按下「開始情報判讀」後，伺服器上仍有 ${names.length} 份情報：${JSON.stringify(names)}`);

  // 玩家端不應該被退回填寫表單
  const p1BackToForm = await p1.isVisible('input[placeholder="所屬基地"]');
  ok(!p1BackToForm, "皮克敏沒有被退回重填情報表單");
  const p1Sees = await p1.isVisible("text=的哪一則情報是假的？");
  ok(p1Sees, "皮克敏順利進入判讀畫面");

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
