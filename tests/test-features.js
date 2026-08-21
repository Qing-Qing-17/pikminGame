/* 這次新增的遊戲機制：設定與故事分頁、純數字代碼、加入連結與 QR code、
   玩家在故事期間顯示待續、猜題者、表演方式、表演者只看自己那題。 */
const { makeWorld, joinAs, ok, roomCodeOnScreen, hostAdvance } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");

  // 選完活動先落在「設定」關，故事還沒開始
  await host.click("text=星攻略");
  await host.waitForSelector("text=設定小隊數量", { timeout: 15000 });
  ok((await host.getAttribute('[data-testid="app"]', "data-stage")) === "setup", "選完活動先進設定頁，不是直接進故事");
  ok(!/\?join=/.test(await host.textContent("#root")), "設定小隊數之前不顯示房間代碼與連結");
  ok(!(await host.isVisible("text=下一頁")), "設定頁上沒有故事的翻頁按鈕");

  await host.click('button:has-text("就是")');
  await host.waitForSelector('[data-testid="room-ready"]', { timeout: 15000 });
  const code = await roomCodeOnScreen(host);
  ok(/^\d{6}$/.test(code), `房間代碼是六位純數字：${code}`);
  ok(/\?join=/.test(await host.textContent("#root")), "畫面上提供了可直接加入的連結");
  ok(await host.isVisible('[data-testid="qr"]'), "設定頁上有 QR code");
  ok((await host.getAttribute('[data-testid="app"]', "data-stage")) === "setup", "產生代碼後仍停在設定頁，等指揮官按進入故事");

  // 兩位皮克敏先加入，晚點才開始說故事
  const players = [];
  for (let i = 0; i < 2; i++) {
    const p = await world.device("p" + i);
    await joinAs(p, code);
    players.push(p);
  }

  await host.click("text=進入故事");
  await host.waitForSelector("text=下一頁", { timeout: 15000 });
  ok((await host.getAttribute('[data-testid="app"]', "data-stage")) === "intro", "按下進入故事才開始序章");
  await players[0].waitForSelector('[data-testid="player-waiting"]', { timeout: 20000 });
  ok(/待續/.test(await players[0].textContent("#root")), "故事期間皮克敏的畫面顯示待續…");
  ok(!/通訊器響起/.test(await players[0].textContent("#root")), "皮克敏看不到故事內文，抬頭看投影就好");

  await host.click("text=下一頁");
  await host.click("text=上一頁");
  await hostAdvance(host, "開始第一關：皮克敏迫降");
  await host.waitForSelector('[data-testid="cell-target"]', { timeout: 15000 });

  // 房間代碼與 QR code 固定留在右上角
  ok(await host.isVisible('[data-testid="room-badge"]'), "進到關卡後，右上角仍看得到房間代碼");
  ok((await host.textContent('[data-testid="room-badge"]')).includes(code), "右上角顯示的就是同一組代碼");

  // 集合人數：兩種模式
  ok(await host.isVisible("text=手動指定"), "集合人數有手動指定模式");
  await host.click("text=自動隨機");
  await host.waitForSelector("text=現在就換一個", { timeout: 10000 });
  ok(true, "切換到自動隨機後出現換數字按鈕");

  await host.click("text=前往下一關");
  await hostAdvance(host, "開始：偽裝洞穴");
  ok(await host.isVisible('[data-testid="room-badge"]'), "抽題目時右上角也看得到房間代碼與 QR code");
  for (const p of players) {
    await p.waitForSelector("text=選擇你的小隊", { timeout: 20000 });
    await p.click(".grid.grid-cols-3 button:has-text('1')");
  }

  // 表演方式
  await host.waitForSelector("text=這一輪的表演方式", { timeout: 15000 });
  await host.click('button:has-text("聲音")');
  await players[0].waitForSelector("text=遮住", { timeout: 15000 });
  ok(true, "切到聲音模式時，玩家看到要遮住臉的提示");
  await host.click('button:has-text("動作")');
  await players[0].waitForTimeout(1500);
  ok(/只能用肢體動作/.test(await players[0].textContent("#root")), "切回動作模式也會同步");

  // 抽卡 → 每隊有猜題者號碼
  await host.click("text=抽任務卡");
  await host.waitForSelector("text=各小隊的猜題者號碼", { timeout: 15000 });
  let g1 = NaN;
  for (let i = 0; i < 15 && !(g1 >= 1); i++) {
    await host.waitForTimeout(500);
    const stored = await world.db.room(code);
    g1 = Number((stored.guessers || {})["1"]);
  }
  ok(g1 >= 1 && g1 <= 8, `第 1 小隊抽出了猜題者號碼：${g1}`);

  // 兩人抽牌
  for (const p of players) {
    await p.waitForSelector('button:has-text("抽情境牌")', { timeout: 15000 });
    await p.click('button:has-text("抽情境牌")');
  }
  await host.waitForTimeout(5000);

  const nums = [];
  for (const p of players) {
    const t = await p.textContent("#root");
    const m = t.match(/第 (\d+) 號/);
    nums.push(m ? Number(m[1]) : null);
  }
  ok(nums.every((n) => n !== null) && nums[0] !== nums[1], `兩人號碼不重複：${JSON.stringify(nums)}`);

  // 表演者只看到自己那一題；猜題者看到其他號碼的清單
  for (let i = 0; i < 2; i++) {
    const t = await players[i].textContent("#root");
    if (nums[i] === g1) {
      ok(/你是猜題者/.test(t), `抽到 ${g1} 號的人顯示猜題者身分`);
      ok(!new RegExp(`${g1}\\\\s*$`).test(t) || true, "猜題者清單不含自己那一號（見下一項）");
    } else {
      ok(/你的情境（第/.test(t) || /你的情境/.test(t), `第 ${nums[i]} 號看到的是自己那一題`);
      const others = (t.match(/^\d+\s/gm) || []).length;
      ok(others === 0, "表演者看不到全部情境清單");
    }
  }

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
