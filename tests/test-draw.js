/* 情境 B：同小隊四人在同一瞬間按下「抽情境牌」，會不會抽到重複號碼／紀錄被互相蓋掉？
   末段另外驗證：重新整理頁面後，還能不能認得自己原本抽到的那一張。 */
const { makeWorld, joinAs, ok } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";
const N = 4;

async function myNumber(page) {
  const el = await page.$("text=/第 \\d+ 號（只有你看得到）/");
  if (!el) return null;
  const m = (await el.textContent()).match(/第 (\d+) 號/);
  return m ? Number(m[1]) : null;
}

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");

  await host.click("text=星攻略");
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

  await host.click("text=開始：偽裝洞穴");
  for (const p of players) {
    await p.waitForSelector("text=選擇你的小隊", { timeout: 15000 });
    await p.click(".grid.grid-cols-3 button:has-text('1')");
  }

  await host.click("text=抽任務卡");
  for (const p of players) await p.waitForSelector('button:has-text("抽情境牌")', { timeout: 15000 });

  // 同時按下，不逐一等待 —— 這正是現場所有人一起動作的情形
  await Promise.all(players.map((p) => p.click('button:has-text("抽情境牌")')));
  await host.waitForTimeout(6000);

  const nums = [];
  for (const p of players) nums.push(await myNumber(p));
  console.log("四人各自看到的號碼:", JSON.stringify(nums));

  ok(nums.every((n) => n !== null), "四人都拿到號碼");
  ok(new Set(nums.filter((n) => n !== null)).size === nums.filter((n) => n !== null).length, "四人的號碼互不重複");

  const stored = world.store.read(code, "state");
  const taken = (stored.takenNumbers && stored.takenNumbers["1"]) || {};
  const count = Array.isArray(taken) ? taken.length : Object.keys(taken).length;
  ok(count === N, `伺服器記錄了 ${count} 張認領（應為 ${N}）：${JSON.stringify(taken)}`);

  const progress = await host.textContent(".grid.grid-cols-2");
  ok(progress.includes(`${N}/`), `指揮官的抽取進度顯示正確：${progress.replace(/\s+/g, " ").trim().slice(0, 40)}`);

  // 重新整理後應該還記得自己的號碼，且不能再抽一張（挑一位確實抽到牌的人來測）
  const idx = nums.findIndex((n) => n !== null);
  const before = nums[idx];
  await players[idx].reload();
  await players[idx].waitForSelector("text=/第 \\d+ 號（只有你看得到）/", { timeout: 15000 }).catch(() => {});
  const after = await myNumber(players[idx]);
  ok(after !== null && after === before, `重新整理後仍是同一張（前 ${before} → 後 ${after}）`);
  const canDrawAgain = await players[idx].isEnabled('button:has-text("抽情境牌")').catch(() => false);
  ok(!canDrawAgain, "重新整理後無法再抽第二張");

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
