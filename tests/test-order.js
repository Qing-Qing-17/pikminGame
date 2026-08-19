/* 指揮官快速連續切換關卡時，抵達伺服器的順序必須等於操作順序。
   網路抖動曾讓較晚發出的寫入先到，伺服器因此停在舊關卡、所有人被拉回去。 */
const { makeWorld, ok } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");

  // 連按不等待，模擬指揮官手速快
  await host.click("text=培訓");
  await host.click("text=開始第一關：皮克敏迫降");
  await host.click("text=前往下一關");
  await host.waitForTimeout(6000);
  const code = (await host.textContent(".text-4xl.font-black.tracking-widest")).trim();

  const stage = (await world.db.room(code)).stage;
  ok(stage === "transition1", `伺服器上的關卡是最後操作的那個（實際: ${stage}）`);
  ok(await host.isVisible("text=皮克敏加入"), "指揮官畫面停在正確的關卡");

  // 前進、後退、再前進連著按，最後應該停在 ttol
  await host.click("text=開始：情報交換");
  await host.click("text=上一關");
  await host.click("text=開始：情報交換");
  await host.waitForTimeout(6000);
  const stage2 = (await world.db.room(code)).stage;
  ok(stage2 === "ttol", `前進後退再前進，仍停在最後操作的關卡（實際: ${stage2}）`);
  ok(await host.isVisible("text=已提交名單"), "指揮官畫面與伺服器一致");

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
