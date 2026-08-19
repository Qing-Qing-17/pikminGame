/* C 階段：量測輪詢請求量、背景暫停、以及預先編譯版的載入速度。 */
const { makeWorld, joinAs, ok } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");
  await host.click("text=星攻略");
  await host.click("text=開始第一關：皮克敏迫降");
  await host.click("text=前往下一關");
  await host.waitForSelector("text=皮克敏加入");
  const code = await world.db.onlyRoom();
  const p = await world.device("p0");
  await joinAs(p, code);

  // 靜置 20 秒，量測一位皮克敏會發出多少請求
  await host.waitForTimeout(3000);
  const before = world.stats.requests;
  await host.waitForTimeout(20000);
  const reqs = world.stats.requests - before;
  const perDevicePerSec = reqs / 2 / 20;
  ok(perDevicePerSec < 0.5, `靜置時每台裝置每秒 ${perDevicePerSec.toFixed(2)} 個請求（未調整前為 1.33）`);

  // 切到背景後應該完全停止
  await p.evaluate(() => Object.defineProperty(document, "hidden", { value: true, configurable: true }));
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await host.waitForTimeout(2000);
  const beforeHidden = world.stats.requests;
  await host.waitForTimeout(8000);
  const hostOnly = world.stats.requests - beforeHidden;
  ok(hostOnly <= 4, `皮克敏切到背景後停止輪詢（8 秒內全場僅 ${hostOnly} 個請求，只剩指揮官）`);

  // 變動後要立刻恢復靈敏
  await p.evaluate(() => Object.defineProperty(document, "hidden", { value: false, configurable: true }));
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await host.click("text=上一關");
  await host.waitForSelector("text=隨機變換人數", { timeout: 15000 });
  await host.click("text=隨機變換人數");
  const t0 = Date.now();
  await p.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    await host.textContent(".text-6xl"),
    { timeout: 10000 }
  );
  ok(Date.now() - t0 < 4000, `指揮官變更後 ${((Date.now() - t0) / 1000).toFixed(1)}s 內同步到皮克敏`);

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
