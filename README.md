# dsh-general-agentics

**General Agentics 發行套件（bundle）for DeepSeek Harness (DSH)。**

用戶先安裝 DSH，再安裝本套件，一次獲得：

1. **貼牌**：側邊欄 mark/wordmark、對話首頁 hero 文字 logo 與致敬行、品牌主色、分頁標題、favicon、輸入框下方的 START HERE 模塊（皆為執行期替換，不修改、不破壞已安裝的 DSH）
2. **自帶技能**：14 個（`ga-identity` ＋ 13 個方法論技能，見下）
3. **MCP 預配置**：`ga-status`（`ga_bundle_info` 身分回報 ＋ `ga_health_check` 安裝健康自檢）
4. **設定面板**：Settings → General Agentics（bundle 版本、每個精選插件的版本與更新狀態、隨附技能、一鍵／手動更新）
5. **13 個精選第三方插件**：隨套件安裝並啟用（見「精選插件」一節）

Built on DeepSeek Harness (DSH), MIT licensed.

## 設計原則

- **只走官方縫隙**：品牌透過三個 generic brand slot 佔位（`priority: -1` 陰影覆蓋官方 occupants——slot 規則是「同 cell 最低 priority 者渲染」），不停用 `ui-brand-official`，不修改任何 DSH 檔案。
- **不破簽章、不怕升級**：本套件存在於 profile（`~/.dsh/profiles/<name>/node_modules`），DSH 升級不會覆蓋它；解除安裝即完全還原官方品牌。
- **手寫、零建置**：`lib/client.js` 採用 shell module loader 的 lazy-CJS 形狀（與 dsh-pomodoro 等第三方出貨格式一致），無需 repo 內未發佈的 build preset。

## 覆蓋範圍（誠實清單）

| 表面 | 本套件 | 備註 |
|---|---|---|
| 側邊欄 mark / wordmark | ✅ | slot 佔位；2026-10-13 瀏覽器實測（乾淨 profile）確認渲染 |
| 對話首頁 hero mark | ✅ | slot 佔位；實測確認我們的 wordmark 渲染 |
| 品牌主色 | ✅ | `theme.overrideTokens`（light/dark 成對，契約要求）。注意 token 寫在 `<body>` 的 inline style 上，不是 `:root`；量測時別探 `document.documentElement` |
| 分頁標題 | ✅ | 執行期改寫 + MutationObserver 抵抗 shell 重設；實測 `document.title === "General Agentics"` |
| favicon | ✅ | 執行期替換 `link[rel=icon]`；實測兩個 link 皆為 data URI 且含品牌色 |
| PWA 名稱 | ⚠️ 盡力 | manifest link 換 data URI，瀏覽器是否採納視實作 |
| 首跑 Preview Notice 彈窗 | ❌ 未覆蓋 | client 樹內字串，一次點名 DeepSeek Harness 三次，是客戶第一眼看到的畫面。2026-10-13 瀏覽器實測發現；client.js 修得到（尚未修） |
| Hero tagline「Into the Unknown」 | ❌ 未覆蓋 | 與我們的 hero wordmark 並排顯示；同為 client 樹內字串，尚未修 |
| 桌面殼（Dock icon／選單／About） | ❌ | 在簽章保護的 app.asar 內，本套件不碰 |
| host 端字串（system prompt、User-Agent） | ❌ | 硬編碼；以 `ga-identity` skill 於任務層補償 |

## 安裝

```sh
# 方式一：GUI（App 運行中）——側欄 Plugins → Add plugin → 貼包名或本機路徑
dsh-general-agentics            # npm 包名（發佈後）
/path/to/dsh-general-agentics   # 本機 clone 的絕對路徑

# 方式二：模型側工具（App 運行中）——對話中請 agent 執行
#   plugin_manager { action: "install_bundle", target: "dsh-general-agentics" }

# 方式三：CLI（desktop profile 須先完全退出桌面 App）
dsh plugin --profile desktop add dsh-general-agentics
```

安裝後：
- **網頁重新整理一次**（Cmd+R）即可載入品牌 client half（側邊欄 mark/wordmark、hero 文字 logo 與致敬行、主色、分頁標題、favicon、輸入框下方的 START HERE 模塊）
- **新建的 session** 會獲得 `ga-identity` 等 14 個技能與 `mcp__ga-status__ga_bundle_info` 工具（MCP 伺服器於組合套用時即由 host spawn）
- 完全重啟 App 亦無妨

**解除安裝／停用**：
```sh
# 停用（保留檔案）：GUI Plugins 頁關閉 bundle，或在 profile 的 cordis.patch.yml 寫：
#   - id: general-agentics
#     disabled: true
# 解除安裝：GUI Plugins → Remove，或退出 App 後 CLI：
dsh plugin --profile desktop remove dsh-general-agentics
```

**開發迭代**：以 `link:` 指向本機 clone 安裝——改 `lib/client.js` 後重新整理頁面即生效；
改 `cordis.patch.yml` 或 `lib/index.js`（host 半）則套用新組合（HMR live）。
內容變更後重新以 `file:` 安裝時記得升版號——pnpm 對同版號的 `file:` 包可能不重新解包。
離線驗證組合用拋棄式 profile：見 `docs/ops-lessons.md` rule 13。

**發布前注意**：
- LICENSE 已在 repo 根目錄（npm 自動收入 tarball）
- MCP row 已是可攜形式（`process.execPath` + `baseUrl`，見 `cordis.patch.yml`；實測紀錄在 `docs/ops-lessons.md` rule 14）
- 對外表述維持 "Built on DeepSeek Harness (DSH), MIT licensed"

## 套件結構

```
dsh-general-agentics/
├── package.json        # dsh.bundle.patch + dsh.client 宣告＋精選插件 dependencies
├── cordis.patch.yml    # 本套件 Loader row＋MCP row＋精選插件 insert rows
├── lib/
│   ├── index.js        # host half：技能 provider（掃 skills/ 註冊）
│   └── client.js       # browser half：品牌 slot、主題、標題/favicon、START HERE
├── brand/
│   ├── mark.svg        # 佔位 mark 設計檔（client.js 內有對應 inline 版本）
│   └── wordmark.svg    # 佔位 wordmark 設計檔
├── skills/
│   ├── ga-identity/    # 自帶技能：General Agentics 身分與簽署
│   ├── (13 個方法論技能)  # vendored from obra/superpowers @ bb92a77（MIT，逐字未改）
│   ├── superpowers/    # 上游 LICENSE + UPSTREAM-SHA（無 SKILL.md，不註冊）
│   └── THIRD-PARTY.md  # 署名與更新指引
├── mcp/
│   └── ga-status-server.mjs  # ga_bundle_info 狀態回報（零依賴 stdio MCP server）
└── test/
    └── skill-provider.test.mjs  # node --test，零依賴
```

## 換正式品牌素材

| 要換什麼 | 改哪裡 |
|---|---|
| 產品名稱 | `lib/client.js` 的 `PRODUCT_NAME` / `PRODUCT_SHORT_NAME` |
| mark 圖形 | `lib/client.js` 的 `GAMark`（paths）＋ `brand/mark.svg` |
| wordmark | `lib/client.js` 的 `GAName` |
| 品牌色 | `lib/client.js` 的 `BRAND_COLOR` / `FAVICON_COLOR`（light/dark 成對） |
| favicon | `lib/client.js` 的 `faviconHref()` |

## 隨附技能（bundled skills）

14 個技能隨包註冊（`ctx.skills.registerProvider`，bundled rank 600——用戶自帶同名技能一律優先）：

- `ga-identity`：以 General Agentics 身分自介與簽署產出
- 13 個方法論技能 vendored 自 [obra/superpowers](https://github.com/obra/superpowers)（MIT，逐字未改）：
  `brainstorming`、`writing-plans`、`executing-plans`、`test-driven-development`、`systematic-debugging`、`verification-before-completion`、`writing-skills`、`diagnosing-superpowers`、`subagent-driven-development`、`dispatching-parallel-agents`、`requesting-code-review`、`receiving-code-review`、`finishing-a-development-branch`
  ——15 個上游技能取 13；`using-superpowers`（其「任何回應前必查技能」規則與 `ga-identity` 的身分主導權衝突）與 `using-git-worktrees`（團隊 git 工作流）刻意不入，理由見 `skills/THIRD-PARTY.md`。

**感謝**：Jesse Vincent (obra) 與 superpowers 貢獻者；詳見 `skills/THIRD-PARTY.md`。

## 精選插件（curated plugins）

隨套件安裝並自動啟用（`dependencies` ＋ `cordis.patch.yml` 的 insert row；row id 一律 `ga-` 前綴，避免與用戶直裝的同名插件撞 id）。

| 插件 | 功能 | 需要什麼才會「看得見」 |
|---|---|---|
| `dshmarket` | 插件市集 | 設定 → Plugin Market |
| `dsh-better-sidebar` | 側欄：檔案樹／編輯器／變更／任務／側聊 | 基本即有；`agentOpenTools` 與 sentinel tab 已預設開啟（只新增，不動其他 tab） |
| `dsh-sentinel` | 排程監看面板（BSD-3-Clause，隨包附授權） | 立即可用；better-sidebar 的 sentinel tab 已預設開啟 |
| `dsh-cost-meter` | 會話費用統計 | 每條回覆的用量行（本套件已預設 `performanceUsage: detailed`） |
| `@changfenhuang/dsh-genui` | 回覆內嵌互動 UI 卡片 | 本套件已預設區塊位置與提示 |
| `dsh-context` | 上下文洞察／管理 | 本套件已預設開啟 fleet 分頁 |
| `@liustack/modsearch` | 免費網頁＋X 搜尋聚合 | 本套件已接管 `web` 的 `searchProvider`（用戶 profile patch 可改回） |
| `dsh-web-search-pro` | 多引擎路由搜尋 | 立即可用 |
| `@ricardochen1996/dsh-browser-use` | 瀏覽器自動化 | **需 `uv`**（首次自動建 Python venv ~25MB） |
| `@michengai/dsh-agency-agents` | 331 位可召喚專家／專家團 | **專家與專家團預設停用**（上游 opt-in）：設定 → 专家 啟用；成員需一併啟用 |
| `@xmanrui/dsh-im` | 微信／飛書／企微／釘釘／TG／Slack… 橋接 | **需 IM 應用憑證**，否則只有背景日誌 |
| `@liustack/modlens` | 給純文字 LLM 的視覺能力 | **需 Antigravity CLI**（未隨包） |
| `dsh-mobile` | 手機／局域網安全訪問、目錄選擇器 | 佔用一個 TCP 埠（預設 3443）；同機第二個 gateway 會撞埠 |

## 設定面板（Settings → General Agentics）

設定側欄多一個 **General Agentics** 分頁，回答「這個 bundle 到底裝了什麼、要不要更新」：

- **bundle 版本**：目前版本 vs registry 最新版（本地開發版領先 registry 時會標「本地版本領先 registry」而不是誤報有更新）
- **13 個精選插件**：每個的宣告範圍、**實際已安裝版本**、registry 最新版，以及 `有新版` / `最新` / `未提供` 標記
- **14 個隨附技能**：名稱清單
- **更新**：一鍵更新走 profile 的 plugin manager（`installBundle`）；沒有 manager 的 profile 會顯示可複製的手動指令。`link:`／`file:` 安裝會額外提示「更新會改用 registry 版本」

資料來自 host 半註冊的唯讀端點 `GET /api/general-agentics/status`（`?plugins=1` 才逐一查 registry，避免每次開面板都打 13 個請求）；`POST` 同一路徑才會實際觸發更新。registry 不可達時面板仍會渲染，只是版本欄顯示「未知」。

## 安裝注意（常見「插件沒出現」的原因）

1. **不要同時直裝這些插件**。若該 profile 已經直裝任一精選插件，它會出現**兩行 row、激活兩次**（`insert` 不去重），舊版還會讓設定頁完全存不進去。裝本套件前先移除直裝，或用 `ga_health_check` 檢查（見下）。
2. **品牌外觀要重新整理頁面**（Cmd+R）才會載入；**技能與 MCP 工具只出現在新建的 session**。
3. **缺外部條件不是壞掉**：`browser-use` 要 `uv`、`modlens` 要 Antigravity CLI、`dsh-im` 要 IM 憑證——裝了不會報錯，但功能不會出現。
4. **專家團預設停用**是上游設計，要在 設定 → 专家 手動啟用（團隊與成員都要）。
5. **Windows 提醒**：`cordis.patch.yml` 的 MCP row 用 `new URL(...).pathname`，Windows 上會得到 `/C:/…`；屆時 `ga-status` 起不來（非致命，工具消失），需改成 win32-aware 寫法。

**自我診斷**：新 session 中請 agent 呼叫 `mcp__ga-status__ga_health_check`，它會回報套件版本、**哪些精選插件被直裝（重複）**、以及每個插件缺哪個外部條件與該怎麼做。

## 合規備忘

- 本套件 MIT；散布時保留 DSH 的 MIT 與 `THIRD_PARTY_NOTICES.md`（DSH 端授權義務）。
- 對外表述使用 "Built on DeepSeek Harness (DSH)"；不以 DeepSeek Harness 作為產品名，不使用官方 logo。
- `ga-identity` skill 內含給 agent 的對外表述規則。
