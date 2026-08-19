/* B6：房間沒有存取控制，任何知道代碼的人都能清空它。
   指揮官應該偵測到並從本機備份還原，而不是整場重來。 */
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
  await host.click("text=開始：情報交換");
  await host.waitForSelector("text=已提交名單", { timeout: 15000 });
  await host.waitForTimeout(3000);

  ok(world.store.read(code, "state").stage === "ttol", "破壞前：伺服器上的關卡正確");

  // 模擬外部人士把房間資料清掉
  world.wipe(code, "state");
  ok(world.store.read(code, "state") === null, "房間資料已被清空");

  // 指揮官應該自動還原
  let restored = null;
  for (let i = 0; i < 15 && !restored; i++) {
    await host.waitForTimeout(2000);
    restored = world.store.read(code, "state");
  }
  ok(restored !== null, "指揮官偵測到並自動還原了房間資料");
  ok(restored && restored.stage === "ttol", `還原後仍停在原本的關卡（${restored && restored.stage}）`);
  ok(await host.isVisible("text=已從本機備份還原"), "畫面上有明確告知曾經發生過");

  // 還原後遊戲要能繼續
  const p = await world.device("p0");
  await joinAs(p, code);
  await p.waitForSelector("text=選擇你的小隊", { timeout: 20000 });
  ok(true, "還原後玩家仍可正常加入並繼續遊戲");

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
