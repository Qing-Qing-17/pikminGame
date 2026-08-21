/* QR code 是自己實作的編碼器，所以一定要用真正的解碼器驗證掃得出來，
   而且掃出來的網址要真的能讓玩家進入房間。 */
const jsQR = require("jsqr");
const { makeWorld, hostAdvance, finishSetup, roomCodeOnScreen, ok } = require("./harness");

const GAME = process.env.GAME || "/home/user/pikminGame/index.html";

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");
  await host.click("text=星攻略");
  await hostAdvance(host, "開始第一關：皮克敏迫降");
  await host.click("text=前往下一關");
  await finishSetup(host);
  const code = await roomCodeOnScreen(host);

  await host.waitForSelector('[data-testid="qr"]', { timeout: 15000 });
  ok(true, "房間代碼旁邊有顯示 QR code");

  // 把 SVG 畫到 canvas 再取出像素，交給真正的解碼器
  const shot = await host.evaluate(async () => {
    const svg = document.querySelector('[data-testid="qr"]');
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    const scale = 4;
    const box = svg.viewBox.baseVal.width;
    await new Promise((res, rej) => {
      img.onload = res; img.onerror = rej;
      img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
    });
    const cv = document.createElement("canvas");
    cv.width = cv.height = box * scale;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const d = ctx.getImageData(0, 0, cv.width, cv.height);
    return { w: cv.width, h: cv.height, data: Array.from(d.data) };
  });

  const decoded = jsQR(Uint8ClampedArray.from(shot.data), shot.w, shot.h);
  ok(!!decoded, "QR code 可以被真正的解碼器讀出來");
  if (!decoded) { await world.close(); return; }
  console.log("  解碼結果:", decoded.data);

  const url = new URL(decoded.data);
  ok(url.searchParams.get("join") === code, `掃出來的代碼與畫面一致（${url.searchParams.get("join")} / ${code}）`);

  // 用掃出來的網址實際加入
  const p = await world.device("p0");
  await p.goto(decoded.data);
  await p.waitForSelector('input[placeholder="房間代碼"]', { timeout: 20000 });
  ok((await p.inputValue('input[placeholder="房間代碼"]')) === code, "掃描後自動帶入代碼");
  await p.click('button:has-text("加入遊戲")');
  const joined = await p.waitForSelector('[data-testid="app"][data-role="player"]', { timeout: 20000 }).then(() => true).catch(() => false);
  ok(joined, "掃 QR code 可以直接進入房間");

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
