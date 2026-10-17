# 驗收報告 — 0.2.0-alpha.24

環境：DSH **0.2.1-rc.2**（CLI runtime）、macOS arm64、Node 26.11.1、pnpm 11.28.5。
方法：全新 profile（web 模板）＋ 本機打包的 tarball 安裝，逐項留下指令輸出；不以「看起來可以」代替證據。

## 1. 安裝（含 0.2.1 相容性閘門）

| 檢查 | 結果 |
|---|---|
| `dsh plugin --profile ga-acc add <tarball>` | 退出碼 **0**、`Packages: +373`、**閘門未拒絕** |
| 安裝版本 | `dsh-general-agentics@0.2.0-alpha.24` |
| 組合層 | 208 entries、**13 條 `ga-` row**、**0 警告/錯誤** |

## 2. 啟動

| 檢查 | 結果 |
|---|---|
| HTTP | **200** |
| `did-not-activate` | 1（唯一失敗是 `dsh-mobile` 的 3443 埠衝突，屬本機環境） |
| `failed to import` | **0** |
| `disabled expression failed` | **0** |
| MCP | `ga-status: ready` |

## 3. 狀態 payload

| 欄位 | 值 |
|---|---|
| bundle / curated / skills | `0.2.0-alpha.24` / **13** / **14** |
| 未提供 / 有新版 | 0 / 1（`dsh-genui 0.12.0 → 0.13.0`，屬實） |
| `csrf` | 32 字元 token ✅ |
| `prerequisites` | 4 項（browser-use `found`；其餘 `unknown` 表示需自行確認） |
| profile 推導 | `ga-acc (argv-profile)`、`frozenInstall: true` |

## 4. 安全矩陣（偽造寫入）

| 請求 | 結果 |
|---|---|
| 無 token | **403 `forbidden`** |
| 錯 token | **403 `forbidden`** |
| 正確 token ＋ `Sec-Fetch-Site: cross-site` | **403 `forbidden`** |
| 正確 token ＋ 外站 `Origin` | **403 `forbidden`** |
| 版本是否被改動 | **否**（仍為 alpha.24） |

合法請求（token ＋ same-origin ＋ 相符 Origin）在另一輪實測為 **200**，把 profile 由 alpha.19 升到 alpha.22。

## 5. Client half 與品牌

| 檢查 | 結果 |
|---|---|
| `document.title` | **General Agentics** |
| 致敬行 | `Powered by DeepSeek Harness` 就位、舊標語消失 |
| START HERE 條 | 首頁可見 |
| favicon | 本套件的 SVG data URL |
| client half 送達 | general-agentics / comments / promptimizer / sentinel / better-sidebar 各 3 |
| 診斷計數器 | `window.__DSH_GA_DIAG__` 存在（啟動期間 flush 12 次，已合併） |

## 6. 效能（量測）

| 情境 | 結果 |
|---|---|
| 200 次同步 DOM 變動 | tagline flush **1**、placement flush **1**（原本各 200 次） |
| 新插入節點帶舊標語 | 仍被改寫 ✅ |

## 7. 載入（量測）

| 請求 | 耗時 |
|---|---|
| 快照 `GET /status` | 0.060s（第二次 0.002s） |
| `GET /status?plugins=1` | 0.337s（第二次 **0.002s**，60s TTL） |

## 8. 可移植性

把 `dsh-mobile/packages/question-fixes/lib/index.mjs` 改名後啟動：**`failed to import: 0`**（row 由守衛停用），只有環境的埠衝突。

## 9. 國際化

| 語言 | 結果 |
|---|---|
| en-US（瀏覽器預設） | 面板全英文、**零中文殘留**；`Needs attention (2)`、`All 13`、`Search & vision` 等 |
| zh（`localStorage['general-agentics/lang']='zh'`） | 面板全中文、**零英文殘留** |

## 10. 測試與守門

| 項目 | 結果 |
|---|---|
| `npm test` | **60/60** |
| `npm run prepublish-check` | 測試通過 ＋ overlay 以 js-yaml 解析成功 |
| 負向測試（故意破壞 overlay） | 守門 **exit 1** ✅ |

## 未完成 / 已知缺口

| 項目 | 狀態 |
|---|---|
| GitHub Actions workflow | 檔案已備妥，但本帳號 token 缺 `workflow` scope，**尚未推送**（需一次性授權） |
| `npm publish` alpha.24 | 未發佈（需要帳號的瀏覽器授權流程） |
| `dsh-mobile` 埠衝突 | 環境性：同機另一個 gateway 佔用 3443 |
| `@michengai/dsh-agency-agents` | 仍只能以風險豁免安裝（上游 peer 範圍限制） |
