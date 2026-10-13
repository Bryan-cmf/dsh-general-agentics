# dsh-general-agentics

**General Agentics 發行套件（bundle）for DeepSeek Harness (DSH)。**

用戶先安裝 DSH，再安裝本套件，一次獲得：

1. **貼牌**：側邊欄 mark/wordmark、對話首頁 hero 文字 logo、品牌主色、分頁標題、favicon（皆為執行期替換，不修改、不破壞已安裝的 DSH）
2. **自帶技能**：`ga-identity`（教導 agent 以 General Agentics 身分自介與簽署產出）
3. **MCP 預配置**：策劃中的 MCP 伺服器清單（見 `mcp/`）
4. **精選第三方插件**：機制保留（依賴＋顯式 insert row 隨套件啟用）；目前策劃清單為空，profile 端另行精選安裝

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

## 合規備忘

- 本套件 MIT；散布時保留 DSH 的 MIT 與 `THIRD_PARTY_NOTICES.md`（DSH 端授權義務）。
- 對外表述使用 "Built on DeepSeek Harness (DSH)"；不以 DeepSeek Harness 作為產品名，不使用官方 logo。
- `ga-identity` skill 內含給 agent 的對外表述規則。
