/* D 階段：在實際渲染的畫面上量測文字對比度，並檢查互動元素有沒有可讀的名稱。 */
const { makeWorld, joinAs, ok } = require("./harness");

/* 預設跑建置版：Tailwind 的 preflight 會把按鈕的瀏覽器預設底色（#EFEFEF）重設掉，
   少了它量到的背景色是錯的。建置版含有真正的 Tailwind，才等於使用者看到的畫面。 */
const GAME = process.env.GAME || require("path").join(__dirname, "..", "dist", "index.html");

const AUDIT = `(() => {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const parse = (s) => (s.match(/\\d+(\\.\\d+)?/g) || []).slice(0, 3).map(Number);
  const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  function bgOf(el) {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return parse(c);
      n = n.parentElement;
    }
    return [255, 255, 255];
  }
  const bad = [];
  document.querySelectorAll("#root *").forEach((el) => {
    if (!el.childNodes.length) return;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
    if (!text) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.5) return;
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    // WCAG：一般文字 4.5、大字（>=24px，或 >=18.66px 且粗體）3.0
    const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3.0 : 4.5;
    const r = ratio(parse(cs.color), bgOf(el));
    if (r < need) bad.push({ text: text.slice(0, 12), fg: cs.color, bg: "rgb(" + bgOf(el).join(",") + ")", ratio: Number(r.toFixed(2)) });
  });
  // 沒有可讀名稱的互動元素
  const unnamed = [];
  document.querySelectorAll("#root button, #root input, #root textarea").forEach((el) => {
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return; // 沒有顯示出來的元素不算
    const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim();
    if (!name) unnamed.push(el.tagName.toLowerCase() + (el.type ? "[" + el.type + "]" : ""));
  });
  return { bad, unnamed };
})()`;

async function audit(page, where) {
  const r = await page.evaluate(AUDIT);
  ok(r.bad.length === 0, `${where}：文字對比全部達標${r.bad.length ? "　不足者：" + JSON.stringify(r.bad) : ""}`);
  ok(r.unnamed.length === 0, `${where}：互動元素都有可讀名稱${r.unnamed.length ? "　缺名稱：" + JSON.stringify(r.unnamed) : ""}`);
}

(async () => {
  const world = await makeWorld(GAME);
  const host = await world.device("host");
  await audit(host, "活動選擇");

  await host.click("text=培訓");
  await audit(host, "序章");
  await host.click("text=開始第一關：皮克敏迫降");
  await audit(host, "皮克敏迫降（指揮官）");
  await host.click("text=前往下一關");
  await host.waitForSelector("text=皮克敏加入");
  await audit(host, "故事繼續＋房間代碼");

  const code = (await host.textContent(".text-4xl.font-black.tracking-widest")).trim();
  const p = await world.device("p0");
  await joinAs(p, code);
  await host.click("text=開始：情報交換");
  await p.waitForSelector("text=選擇你的小隊", { timeout: 20000 });
  await audit(p, "選擇小隊（皮克敏）");
  await p.click(".grid.grid-cols-3 button:has-text('1')");
  await p.waitForSelector('input[placeholder="所屬基地"]');
  await audit(p, "填寫情報表單");

  await host.click("text=上一關");
  await host.waitForSelector("text=皮克敏加入");
  await host.click("text=開始：情報交換");
  await host.waitForSelector("text=已提交名單");
  await audit(host, "情報交換（指揮官）");

  await world.close();
})().catch((e) => { console.error("測試中止:", e.message); process.exit(1); });
