#!/usr/bin/env node
/* 產出 dist/index.html：把 JSX 預先編譯、Tailwind 產成靜態 CSS、React 直接內嵌。
   結果是一個不依賴任何 CDN 的單檔，載入時不必在手機上即時編譯上千行 JSX，
   現場網路擋掉外部網站時也照常運作。原始碼仍以根目錄的 index.html 為準。 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const babel = require("@babel/core");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "index.html");
const OUT_DIR = path.join(ROOT, "dist");
const OUT = path.join(OUT_DIR, "index.html");
const NM = path.join(ROOT, "node_modules");

function read(p) { return fs.readFileSync(p, "utf8"); }

const html = read(SRC);

// 1. 取出 JSX 並預先編譯成純 JS
const m = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/);
if (!m) { console.error("找不到 text/babel 區塊"); process.exit(1); }
const compiled = babel.transformSync(m[1], {
  filename: "app.jsx",
  babelrc: false,
  configFile: false,
  // 必須指定 classic：Babel 8 的 preset-react 預設改成 automatic runtime，
  // 會產生 import 陳述句，在沒有打包器的純瀏覽器環境直接壞掉。
  presets: [[require.resolve("@babel/preset-react"), { runtime: "classic" }]],
  compact: false,
}).code;

// 2. 用 Tailwind 掃描原始碼產出實際用到的 CSS
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pikmin-build-"));
const cssIn = path.join(tmp, "in.css");
const cssOut = path.join(tmp, "out.css");
fs.writeFileSync(cssIn, "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n");
execFileSync(path.join(NM, ".bin", "tailwindcss"),
  ["-i", cssIn, "-o", cssOut, "--content", SRC, "--minify"],
  { stdio: ["ignore", "ignore", "inherit"] });
const css = read(cssOut);

// 3. 組出成品：外部腳本全部換成內嵌內容
const react = read(path.join(NM, "react/umd/react.production.min.js"));
const reactDom = read(path.join(NM, "react-dom/umd/react-dom.production.min.js"));

let out = html;
out = out.replace(/\n?<script src="https:\/\/cdnjs\.cloudflare\.com[^>]*><\/script>/g, "");
out = out.replace(/\n?<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/g, "");
// CDN 檢查腳本在這個版本沒有意義（沒有任何外部腳本），整段移除
out = out.replace(/\n?<script>\s*\/\* 四支外部腳本[\s\S]*?<\/script>/, "");
/* 一律用替換函式，不用替換字串：React 的壓縮碼與 CSS 裡含有 $& $` 這類序列，
   被當成替換模式解讀會直接把程式碼改壞（症狀是成品出現語法錯誤）。 */
const put = (str, find, valueFn) => str.replace(find, () => valueFn());
out = put(out, "<style>", () => `<style>\n${css}\n`);
out = put(out, m[0], () => `<script>${react}</script>\n<script>${reactDom}</script>\n<script>\n${compiled}\n</script>`);
out = put(out, "<title>", () => "<!-- 由 tools/build.js 產生，請勿直接編輯；原始碼是根目錄的 index.html -->\n<title>");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, out);
// GitHub Pages 預設會用 Jekyll 處理靜態檔，這個空檔案讓它原封不動地送出去
fs.writeFileSync(path.join(OUT_DIR, ".nojekyll"), "");
fs.rmSync(tmp, { recursive: true, force: true });

const kb = (n) => (n / 1024).toFixed(0) + " KB";
console.log(`已產出 ${path.relative(ROOT, OUT)}`);
console.log(`  原始碼 ${kb(html.length)} → 成品 ${kb(out.length)}（已含 React 與 Tailwind，不再依賴任何 CDN）`);
if (/https:\/\/(cdnjs|cdn\.tailwindcss)/.test(out)) { console.error("  ✗ 成品仍殘留 CDN 連結"); process.exit(1); }
console.log("  剩下的外部資源只有 Google Fonts（字型擋掉時會退回系統字型，不影響功能）");
