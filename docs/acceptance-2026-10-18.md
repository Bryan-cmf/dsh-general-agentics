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

視覺骨架：第一次請求在 3 秒延遲下，面板先畫出「Reading status…」＋三條 placeholder，
而不是空盒子（`docs/img/panel-skeleton.png`）。

**registry 不可達**（`DSH_GA_REGISTRY_URL=http://127.0.0.1:9` 啟動，該埠沒有服務）：

| 檢查 | 結果 |
|---|---|
| 快照 payload | `current: 0.2.0-alpha.24`、`latest: undefined`、13 個 installed 有值、13 個 latest 無值 |
| 面板 | 標題 chip **「Registry unreachable」**、BUNDLE 卡「Cannot reach the registry…」、`13 plugins · 14 skills`、13 列全部渲染 |
| 每列徽章 | **13 個「Checking」、0 個「Latest」**（不謊報） |
| 崩潰 | 無 |
| 恢復正常 registry 後 | `latest: 0.2.0-alpha.22`、13/13 latest 有值 |

截圖：`docs/img/panel-offline.png`。

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
| GitHub Actions workflow | **以可驗證的替代方式交付**：workflow 定義已進 repo（`ci/github-actions.yml`，經 js-yaml 解析通過），等價閘門 `npm run ci` 可執行且通過（61 測試 ＋ 打包演練）。GitHub 上的自動化仍需 `workflow` scope 才能啟用：`gh auth refresh -h github.com -s workflow` 後照 `ci/README.md` 推一次，或直接在網頁新增。 |
| `npm publish` alpha.24 | 未發佈（需要帳號的瀏覽器授權流程） |
| `dsh-mobile` 埠衝突 | 環境性：同機另一個 gateway 佔用 3443 |
| `@michengai/dsh-agency-agents` | 仍只能以風險豁免安裝（上游 peer 範圍限制） |


## 附錄：0.2.0-alpha.25（A/B/C/D 創意功能）

環境同上（DSH 0.2.1-rc.2），全新 profile `ga-final`，安裝本機打包的 alpha.25。

| 檢查 | 結果 |
|---|---|
| 安裝 | exit 0、未被閘門拒、`0.2.0-alpha.25` |
| 組合 | 208 entries、13 條 `ga-` row、**0 警告** |
| 啟動 | HTTP 200、`failed to import 0`（唯一失敗是環境的 3443 埠衝突） |
| payload | curated 13、skills 14、skillDetails 15、health `94/100 (A)`、settings `{accent: indigo}` |
| 安全矩陣 | 無 token／錯 token／跨站／外站 Origin **全 403**，版本未被動到 |
| `?usage=1` | ok、12 sessions、2,176 tool calls、4 個技能 |
| `?diagnostics=1` | ok、45 行 Markdown（含 health、插件表、usage 段） |
| `?preview=1` | ok、target alpha.22、changes 0（本地與該版相依相同）；`&to=0.2.0-alpha.24` 正確回 `manifest-unavailable`（該版未發佈） |
| 面板（瀏覽器） | 標題 alpha.25、健康 chip `94/100`、外觀卡、首次精靈、提醒卡、14 個 Try、Copy diagnostics、篩選與分組 |
| 測試 | **74/74** |

功能逐項證據與已知限制見 CHANGELOG 的 alpha.25 段落；B3（Plugins 頁徽章）已實作並如實標記「未目視驗證」，A4／C4 明確延後。


## 附錄：0.2.0-alpha.27（面板 UX）

| 檢查 | 結果 |
|---|---|
| 安裝 | exit 0、未被閘門拒、`0.2.0-alpha.27`、208 entries、13 條 `ga-` row、0 警告 |
| 啟動 | HTTP 200、`failed to import 0`（唯一失敗為環境 3443 埠衝突） |
| payload | curated 13、skills 14、health 94、`profile.dir` 已去識別化（`~/.dsh/...`） |
| 安全矩陣 | 無 token／錯 token／跨站／外站 Origin 全 403，版本未動 |
| 面板（瀏覽器） | 版本 alpha.27、四個分頁（Status／Plugins／Skills／Settings）、健康 chip、無殘留骨架 |
| 分頁內容 | Plugins：清單＋篩選；Skills：搜尋＋6 筆＋Show all 14；Settings：外觀＋提醒 |
| 語言 | 切換中文/English **不重載**，分頁與狀態保留 |
| 狀態可見性 | 側欄 footer 顯示「Update available: 0.2.0-alpha.30」；標題變成「● General Agentics」（有更新時） |
| 測試 | **96/96**（含 12 個 client DOM 測試） |
| 探針 | **16/16**（含 title 冪等、list-slot 註冊、footer 狀態） |

截圖：`docs/img/panel-tabs-skills.png`、`docs/img/panel-footer-status.png`。

**過程中修掉一個自己造成的 P0**：標題改寫的某個分支無條件賦值 `document.title`，head 的
observer 因此無限觸發（實測 22 個瀏覽器進程、~800% CPU、頁面永遠載不完）。現在兩處
title 寫入都先比較再寫，並由探針 P15 固定。
