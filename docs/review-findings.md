# 審查發現台账

一筆一行；`status` 只有 `open` / `fixed` / `accepted`（已知限制，不修但要說明）。
編號 `S<n>` 一旦分配就不重用，測試名稱會引用它。

| id | 功能 | 嚴重度 | 發現 | 狀態 | 證據 |
|---|---|---|---|---|---|
| S1 | A2 回滾 | P0 | install 失敗後 remove 已完成，profile 失去整個 bundle | fixed | 測試 `S1: a failed rollback install puts the previous bundle back`；探針 P1 |
| S2 | C1 診斷包 | P1 | 報告含絕對路徑／使用者名稱；且為未授權 GET | fixed | 測試 `S2: diagnostics redacts…`；探針 P3；`profile.dir` 於 payload 亦去識別化 |
| S3 | A2 回滾 | P1 | 不驗證記錄與現況，stale 記錄可盲目降級 | fixed | 測試 `S3: a stale rollback record is refused…`；探針 P2；E2E 實測 409 |
| S4 | D1 accent | P2 | `applyAccent` 丟棄 `overrideTokens` 的 disposer，卸載後品牌色殘留 | fixed | 探針 P4（靜態斷言） |
| S5 | D3 locale | P2 | `locale` 不在 inject 清單，`ctx.locale` 可能永遠 undefined；改用 `ctx.get('locale')` | fixed | 探針 P5 |
| S6 | C2 使用洞察 | P2 | 跨所有 workspace 統計；記憶體上限只在單檔 | fixed | 測試 `S6: usage scanning is bounded…`；探針 P8（`scope` 標示＋位元組預算） |
| S7 | C1 診斷包 | P3 | 只有成功才寫 `last-result`，失敗時報告是空的 | fixed | 測試／探針 P9 |
| S8 | A1 預覽 | P3 | 預覽載入中仍可按 Confirm | fixed | 探針 P6 |
| S9 | i18n 測試 | P3 | 只掃字面 key，模板 key（`accent_${key}`）無覆蓋 | fixed | 測試 `S9: the i18n test covers template keys…` |
| S10 | A3 靜默 | P3 | 靜默時段用伺服器時間未標明；改設定後徽章要重載才更新 | fixed | 探針 P7；文案標明伺服器時間 |
| S13 | D1 accent | P2 | 換過 accent 後，卸載時清不到「目前那層」（主題的 disposer 認身分） | fixed | 探針 P13；`applyAccent` 先釋放上一層、effect 卸載時釋放當前層 |
| S14 | A2/C1 | P3 | 還原失敗的細節沒進 `last-result` | fixed | 探針 P11 檢查 `restoreError` 已記錄 |
| S15 | 循環 | P2 | 探針沒接進 `ci`／`prepublish`，可被繞過 | fixed | `npm run ci` 與 `prepublish-check` 都會跑探針 |
| S16 | client 半 | P3 | 沒有自動化的 DOM 測試（只有靜態探針＋手動瀏覽器） | accepted | 靜態探針 P4/P6/P7/P10/P13/P14 覆蓋接線；DOM 測試待補 |
| S17 | 寫入 | P2 | 並行 update＋rollback 會交錯兩組 remove/install | fixed | 探針 P12；序列化寫入，第二個請求 409 `busy` |
| S18 | D3 locale | P3 | 語言來源未驗證，無法證明真的走服務 | fixed | 瀏覽器實測 `window.__GA_LOCALE_SOURCE__ = "service"` |
| S19 | C1 讀取 | P3 | `?diagnostics=1`／`?usage=1` 無授權（現已去識別化） | accepted | 路徑已紅化；未授權可讀到的只剩版本與計數 |
| S20 | A2 回滾 | P3 | 還原成功只看「沒丟錯」，沒驗證磁碟版本 | fixed | 探針 P11；`installedVersion` 比對通過才回 `restored` |
| S21 | 版本讀取 | P2 | `installedVersion` 用 `require` → 同 process 換版後仍回舊版本 | fixed | 測試 `S21: installedVersion reads the disk…`；改為直接讀檔 |
| S11 | B3 徽章 | — | 查無其他 `plugins.detail.badge` 註冊者，覆蓋風險為理論性 | accepted | 仍**未目視驗證**（headless 到不了詳情頁） |
| S12 | C2 使用洞察 | — | 只計 `skill` 工具呼叫，平台自動觸發不計入 | accepted | 文案已寫「技能使用」；`scope: all-workspaces` |

## 已知限制（不打算修）

- **A4 只更新 patch**：需要先有 floor 分級流程，未纳入本輪。
- **C4 插件為何未啟動**：需要 `cordisInspect` 深度整合，L 級風險。
- **B3 目視驗證**：需在桌面 App 的 Plugins 詳情頁確認。
