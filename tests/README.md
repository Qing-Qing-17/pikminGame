# 多人同步回歸測試

用 Playwright 實際開多個瀏覽器分頁跑 `index.html`：每個參與者一個獨立的 browser context
（各自的 localStorage，等同不同裝置），CDN 換成本地檔案，`kvdb.io` 換成共用的記憶體版並
模擬網路延遲。這樣才測得出「大家同時操作」時的行為——沒有延遲的話競態窗口小到測不出來。

## 執行

```bash
npm install react@18.2.0 react-dom@18.2.0 @babel/standalone@7.23.5 playwright
node tests/test-ttol.js
```

`@babel/standalone` 必須釘在 7.23.5，與 `index.html` 載入的版本一致：Babel 8 的 JSX
預設改成 automatic runtime，會產生 `import` 而在瀏覽器直接壞掉。

環境變數：

- `GAME=/path/to/index.html` — 指定要測的檔案（可用來對照修改前後的版本）
- `LATENCY=120` — 模擬的單次往返延遲毫秒數，預設 120
- `TRACE=1` — 印出每一次寫入伺服器的狀態（關卡、情報份數）

一次只跑一個檔案。連續啟動多個 Chromium 會在資源吃緊時出現點擊逾時。

## 各測試涵蓋的情境

| 檔案 | 情境 |
| --- | --- |
| `test-ttol.js` | 指揮官看得到玩家提交的情報；按下「開始情報判讀」不會清空大家的資料 |
| `test-draw.js` | 四人同時抽情境牌不重複、不遺漏；重整頁面後仍認得自己那張 |
| `test-stress.js` | 六人同時提交情報、同時送出判讀，全部落地 |
| `test-timing.js` | 量測六人同時提交各自要多久才真的寫入伺服器 |
| `test-offline.js` | 完全連不上 kvdb 時仍可用單機模式，且不對死掉的伺服器空轉 |
| `test-reset.js` | 指揮官重置後，玩家的自我修復不會把舊資料寫回去 |
| `test-misc.js` | 故事編輯器、倒數計時器、集合人數的跨裝置同步 |
