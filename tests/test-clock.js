/* A4：兩台裝置的系統時鐘差很多時，倒數是否仍然一致。
   SERVER_SKEW 讓假伺服器回報一個與本機不同的時間，程式應該以它為共同基準。 */
const { makeWorld, joinAs, ok } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";

async function countdown(page) {
  const m = (await page.textContent("body")).match(/\b(\d\d):(\d\d)\b/g);
  return m ? m[m.length - 1] : null;
}

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");
  await host.click("text=星攻略");
  await host.click("text=開始第一關：皮克敏迫降");
  await host.waitForSelector("text=遊戲倒數");

  // 讓皮克敏這台裝置的時鐘快 5 分鐘
  const p = await world.device("p0", { clockSkewMs: 300000 });
  await joinAs(p, "bkt1");

  await host.click('button:has-text("01:00")');
  await host.locator('button:has-text("開始")').last().click();
  await p.waitForTimeout(4000);

  const h = await countdown(host);
  const pl = await countdown(p);
  const diff = Math.abs(
    (Number(h.split(":")[0]) * 60 + Number(h.split(":")[1])) -
    (Number(pl.split(":")[0]) * 60 + Number(pl.split(":")[1]))
  );
  ok(diff <= 2, `裝置時鐘差 5 分鐘時倒數仍一致（指揮官 ${h} / 皮克敏 ${pl}，相差 ${diff} 秒）`);

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
