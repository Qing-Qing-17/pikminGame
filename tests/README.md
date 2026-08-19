# 回歸測試

用 Playwright 實際開多個瀏覽器分頁跑遊戲：每個參與者一個獨立的 browser context
（各自的 localStorage，等同不同裝置），CDN 換成本地檔案。

資料庫用的是**官方的 Firebase Realtime Database 模擬器**（`firebase-tools` 下載的 jar，
由 `tools/emulator.js` 直接以 java 啟動——繞過 CLI，因為它啟動時會去抓遠端設定）。
不是自己寫的假伺服器，所以 `PATCH` 合併、`ETag` 條件寫入、SSE 推播的語意都與正式環境一致。

資料庫請求會加上模擬延遲，否則競態窗口小到測不出來，多人覆蓋的問題會測不到。

## 執行

```bash
npm install
node tests/test-ttol.js
```

一次只跑一個檔案。連續啟動多個 Chromium 會在資源吃緊時出現點擊逾時。

故事現在是一頁一句，所以測試要用 `hostAdvance(page, "按鈕文字")` 翻完故事才按得到
關卡按鈕；房間代碼要先 `finishSetup(page)` 設定完小隊數才會出現。

環境變數：

- `GAME=/path/to/index.html` — 指定要測的檔案（可對照修改前後的版本，或改測 `dist/`）
- `LATENCY=120` — 模擬的單次往返延遲毫秒數，預設 120
- `TRACE=1` — 印出每一次寫入伺服器的狀態（關卡、情報份數）

## 各測試涵蓋的情境

| 檔案 | 情境 |
| --- | --- |
| `test-ttol.js` | 指揮官看得到玩家提交的情報；按下「開始情報判讀」不會清空大家的資料 |
| `test-draw.js` | 四人同時抽情境牌不重複、不遺漏；重整頁面後仍認得自己那張 |
| `test-stress.js` | 六人同時提交情報、同時送出判讀，全部落地 |
| `test-timing.js` | 量測六人同時提交各自要多久才真的寫入伺服器 |
| `test-order.js` | 指揮官快速連續切換關卡時，抵達伺服器的順序等於操作順序 |
| `test-offline.js` | 尚未設定後端、以及設定了但連不上時，仍可用單機模式且不空轉 |
| `test-reset.js` | 指揮官重置後，玩家的自我修復不會把舊資料寫回去 |
| `test-misc.js` | 故事編輯器、倒數計時器、集合人數的跨裝置同步 |
| `test-stage-a.js` | 房間代碼常駐、回上一關、編輯去抖動、空白情境不入抽牌池 |
| `test-clock.js` | 兩台裝置系統時鐘差 5 分鐘時，倒數仍然一致 |
| `test-perf.js` | 靜置時的請求量、切到背景的行為、變動後的同步延遲 |
| `test-resilience.js` | CDN 掛掉的提示、錯誤邊界、預先編譯版的載入速度 |
| `test-secrecy.js` | 假情報答案不上傳，判定由本人的裝置完成 |
| `test-tamper.js` | 房間資料被清空時，指揮官自動從本機備份還原 |
| `test-a11y.js` | 在實際渲染的畫面上量測文字對比度與互動元素的可讀名稱 |
| `test-diagnostics.js` | 同步失敗時畫面說得出真正原因（權限被拒／斷線），不誤導使用者查網路 |
| `test-features.js` | 純數字代碼、先設定小隊數、加入連結、猜題者、表演方式、表演者只看自己那題 |

`test-a11y.js` 預設測 `dist/index.html`：Tailwind 的 preflight 會重設按鈕的瀏覽器預設
底色，少了它量到的背景色是錯的，必須用含有真正 Tailwind 的建置版才等於使用者看到的畫面。
執行前請先 `npm run build`。
