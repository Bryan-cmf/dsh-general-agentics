# General Agentics DSH Bundle — 打包與安裝通路調研暨規劃

> 版本：2026-10-13（基於 DSH 0.2.0-rc.2 桌面端實測與原始碼調研）
> 結論先行：**以 npm 發佈為主幹**，用戶動線主打「GUI 貼包名安裝」＋「提示詞一鍵安裝」雙軌，再輔以 awesome-dsh-plugin 目錄收錄（dshmarket 用戶可一鍵安裝）；`dsh://` 連結安裝與「下載後雙擊安裝」目前 DSH 不支援，不投入。

---

## 1. 調研發現：DSH 安裝機制全貌

### 1.1 安裝 spec：底層就是 pnpm spec

安裝規格解析（`@deepseek-ai/dsh-plugin-manager/lib/types/install-spec.js`）接受四種形式，GUI「Add plugin」對話框、模型側 `plugin_manager` 工具、CLI `dsh plugin add` 三者共用同一套解析：

| spec 形式 | 範例 | 備註 |
|---|---|---|
| npm 包名（可帶版本範圍） | `dsh-general-agentics`、`dsh-general-agentics@^0.1` | 走 registry；支援私有源＋fallback |
| 絕對路徑 | `/Users/x/dsh-general-agentics`、`file:`、`link:` | 開發用；相對路徑被拒 |
| tarball | `https://…/dsh-general-agentics-0.1.0.tgz` 或本地 `.tgz` 絕對路徑 | 離線/備援用 |
| git | `github:owner/repo`、`https://github.com/owner/repo` | 觸發 prepare build script，會被 pnpm 擋（allowBuilds 人工放行）→ 摩擦大 |

**registry 策略**（`registry.js`）：預設配置源 → fallback（npmmirror）依序嘗試；私有源被要求時單獨詢問、不會回退到公有源。中國網路環境自動走 npmmirror，無需額外處理。

### 1.2 四條真實存在的用戶安裝通道

**A. 官方 GUI：Settings → Plugins → Add plugin**（本機已實測，`dsh-client-ui-plugin-manager`）
- 貼 npm 包名／tarball URL／git／本地絕對路徑 → Install → 進度 → 完成後**重新整理頁面**（Cmd+R）即載入品牌 client half，新 session 獲得 skill 與 MCP。全程 App 運行中可做，live profile HMR。
- 對話框可直接填私有 registry（內網場景）。

**B. 模型側工具：`plugin_manager` install_bundle**（本機已實測，即「提示詞安裝」）
- 用戶在對話中貼一段提示詞 → agent 呼叫 `plugin_manager {action: "install_bundle", target: "dsh-general-agentics"}` → 用戶按一次核准 → 完成。與 GUI 走同一 host 服務（`installBundle`），運行中可用。
- 前提：session 檔案政策為 danger-full-access，或用戶接受核准彈窗（工具本身要求）。

**C. 社群市集 dshmarket：Settings → Plugin Market 一鍵安裝**（`dshmarket` v1.66.x，本機已安裝）
- 瀏覽/搜尋 4500+ 目錄 → 卡片 → 確認來源 → 即時進度 → 重新整理即生效；含一鍵更新、備份、熱停用。
- **收錄條件**：向 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 開 PR，`data/plugins/` 下加一個 YAML（`url`/`name`/`category`/`description.en/zh`），網站與市集通常一天內自動收錄；repo 加 `dsh-plugin` topic。
- 安裝來源鎖定策展目錄；偏好順序：npm 預建包 → 作者預建 GitHub Release tarball → 全源碼下載。我們是 npm 預建＋零 build script，屬最快檔。
- 限制：**用戶須已安裝 dshmarket**（官方桌面端不預裝）→ 對「我們自己導入的用戶」是選配，對「生態曝光」是加分。

**D. CLI：`dsh plugin --profile <p> add <spec>`**
- 對 desktop profile 有硬限制：官方錯誤訊息要求**先完全退出桌面 App**（`requireDesktopProfile`：須先開過一次 App 初始化 profile，且 CLI 變更期間 App 須退出）。對桌面用戶是四通道中體驗最差的，定位為進階/伺服器（web profile）用。

### 1.3 兩條「看起來可行、實際不存在」的通道

**E. `dsh://` 連結安裝 — 不存在**
桌面端確實註冊了 `dsh://` protocol（`app.setAsDefaultProtocolClient("dsh")`），但 `open-url` 只處理 `dsh://open`（聚焦視窗），**沒有任何安裝語義**。除非上游 DSH 未來新增（可提 feature request），否則「一條連結點了就裝」做不了。替代形態：landing page + 一鍵複製安裝指令/提示詞（見 §3）。

**F. 下載檔案雙擊安裝 — 不存在**
DSH 沒有 `.dshpack` 之類的檔案關聯或安裝器格式。macOS 上可做雙擊 `.command` 腳本包著 CLI，但 desktop profile 的 CLI 通道要求退出 App，體驗反而更差，且散播一個「可執行腳本」對新品牌是信任負債。**不做。** tarball 直鏈/本地路徑安裝保留為離線備援（GUI 貼 URL 即可）。

### 1.4 相容性與摩擦點（影響打包決策）

- **peerDependencies 豁免制**：宣告的 peer 與運行中 DSH 版式不符 → 安裝被擋，需 `dsh plugin allow-version <pkg>@<ver> --dsh-version <ver> --accept-risk` 逐一豁免。本 bundle **未宣告 peer → 零豁免摩擦**；代價是沒有強制版本門檻。補償：在 package.json 加 `engines.dsh`（市集卡片會顯示需求，core 不攔）＋ 維護測試矩陣。
- **allowBuilds**：pnpm ≥10 擋安裝期 build script。本 bundle 手寫、零依賴、零 build script → 全通道無此摩擦。**發佈時維持「不帶任何 install script」是硬約束**。
- **桌面端版本落差**：桌面 App 自帶 runtime，版本可能落後 npm 上的 dsh；brand half 依賴 slot/DOM，需按 DSH 版本跑驗證。
- **發佈前必修**（README 已列）：① 注入 LICENSE 檔（`files` 不含，散布義務會落空）；② `mcp/` 內絕對路徑改可攜形式（`!!js` env 或 baseUrl）；③ npm `latest` 若為 BSD-3 版本需另附義務。

---

## 2. 通道對比

| 通道 | 用戶步驟 | 前置條件 | 更新 | 離線 | 評價 |
|---|---|---|---|---|---|
| GUI 貼包名（A） | 開設定→貼名→Install→重新整理（約 4 步） | 無 | GUI/市集一鍵 | ✗（npm/tarball URL 可） | **主推**：零依賴、官方通道、運行中可用 |
| 提示詞安裝（B） | 貼一段話→按核准→重新整理（3 步） | session 政策允許 | 請 agent 再跑一次 | ✗ | **主推**：最短動線、landing page 可一鍵複製 |
| 市集一鍵（C） | 搜尋→Install（2 步） | 用戶已裝 dshmarket＋目錄收錄 | 市集一鍵 | ✗ | 選配：曝光＋安裝體驗最佳，但覆蓋面取決於市集滲透率 |
| CLI（D） | 退 App→終端機→指令→重開 | 會用終端機 | CLI | ✓(tarball) | 進階用戶/伺服器；桌面主流程不推薦 |
| tarball 直鏈/本地 | 下載→GUI 貼 URL/路徑 | 無 | 弱（來源釘死） | ✓ | **備援**：內網、air-gapped、npm 故障時 |
| dsh:// 連結 | — | DSH 不支援 | — | — | 不可行；關注上游，若支援即升級為最短動線 |
| 雙擊安裝包 | — | DSH 無檔案關聯 | — | — | 不可行；.command 變通方案體驗差且有信任成本，不做 |

---

## 3. 建議方案：npm 主幹＋雙軌動線＋目錄收錄

### 3.1 發佈主幹：npm

- 包名 `dsh-general-agentics` **尚未被註冊**（registry.npmjs.org 回 404，2026-10-13 查證）→ 儘早 `npm publish` 佔名（先發 0.1.0-alpha dist-tag 亦可）。
- npm 預建 tarball ＋ 零依賴 ＋ 零 build script ＝ 四通道中三個（A/B/C）直接受益，安裝秒級、無安全攔截。
- npmmirror 自動 fallback，中國用戶無障礙；私有源場景 GUI 原生支援。

### 3.2 用戶動線（對外說法）

1. **標準動線**：安裝 DSH 桌面端 → Settings → Plugins → Add plugin → 貼 `dsh-general-agentics` → Install → Cmd+R。
2. **最短動線（提示詞卡）**：新對話貼上——
   > 請用 plugin_manager 工具安裝並啟用 bundle 套件 `dsh-general-agentics`（npm 最新穩定版）到目前 profile：action=install_bundle, target=dsh-general-agentics。完成後提醒我重新整理頁面（Cmd+R）載入品牌外觀。
3. **市集動線**（收錄後自動生效）：Plugin Market 搜「General Agentics」→ Install。

Landing page（或 README 頂部）放三個一鍵複製塊：① 包名（給 Add plugin）② 安裝提示詞 ③ CLI 指令（`dsh plugin --profile web add dsh-general-agentics`，標註桌面端須退出 App）。這就是現階段可行的「一條連結安裝」形態：連結到頁面，頁面一鍵複製。

### 3.3 目錄收錄（選配但建議做）

- PR 一個 YAML 到 awesome-dsh-plugin `data/plugins/`：
  ```yaml
  url: https://github.com/<org>/dsh-general-agentics
  name: <org>/dsh-general-agentics
  category: theme          # 或 ui；貼牌屬外觀類
  description:
    en: 'One install turns DeepSeek Harness into General Agentics: white-label brand (sidebar/hero/colors/tab/favicon), bundled skills and MCP pre-config. Zero dependencies, zero build scripts, uninstall fully reverts.'
    zh: '一次安裝把 DeepSeek Harness 變成 General Agentics：貼牌品牌（側欄/首頁/主色/分頁/favicon）、自帶技能與 MCP 預配置。零依賴零建置腳本，解除安裝完全還原。'
  ```
- repo 加 `dsh-plugin` topic；通常一天內收錄。
- 注意：收錄 ≠ 背書（市集自己也這麼標示）；README 準備雙語與截圖（市集卡片會抽取）。

### 3.4 精選多作者插件：隨 bundle 一次安裝的機制與約束

**結論：可以一次安裝。** 機制（已對照 0.2.0-rc.2 原始碼驗證）：

1. **安裝**：精選插件宣告為本 bundle 的 `dependencies` → 用戶任一通道裝 `dsh-general-agentics` 時，pnpm 傳遞安裝把它們一併裝進 profile 的 node_modules（hoisted）。
2. **啟用**：本 bundle 的 `cordis.patch.yml` 為每個精選插件加顯式 insert row（`- id: <id>` + `name: '<pkg>'`，與本 bundle 自身 row 同款）。注意：plugin-manager 的 reconcile（`dsh-plugin-manager/lib/types/operations.js:44`）**只掃 profile 最上層 dependencies**（直接安裝者），不掃我們的傳遞依賴——所以精選插件的啟用靠我們的 patch 檔，不靠 reconcile。
3. **一致性**：啟用邏輯在我們的 patch 檔內 → GUI 貼包名／提示詞／CLI／市集任一通道，效果完全相同，一次 Cmd+R 全部生效。

**策展清單約束（每選一個插件都要過）**：

| # | 約束 | 原因 |
|---|---|---|
| 1 | 只選 npm 已發佈、預建、**零 install script** 的插件 | git/源碼來源會撞 allowBuilds 攔截，破壞「秒裝」體驗 |
| 2 | 無 peerDependencies，或 peer 範圍涵蓋目標 DSH 版式 | profile `autoInstallPeers: false`；peer 不符會產生警告、極端情況擋組合 |
| 3 | 版本釘選（精確版或窄區間） | 精選插件是傳遞依賴，更新隨 bundle 版本走；鬆區間會引入未驗證組合 |
| 4 | 授權相容：MIT/Apache-2.0 優先；**避免 GPL 入選** | 依賴各自從 npm 下載、各自攜帶 LICENSE（我們不複製程式碼）；GPL 入選會混淆 MIT 敘事 |
| 5 | 插入順序＝載入順序，策展後用 `--dump-config` 驗證組合 | 插件間可能搶同 slot／override |
| 6 | README 附感謝清單（作者＋repo＋授權） | 多作者開源的署名義務與禮節 |

**管理語義**（要寫進對外文檔）：
- 精選插件**不會**出現在用戶 GUI 的獨立插件列（不是 profile 直接依賴）→ 市集不會單獨更新它們；**更新隨本 bundle 版本走**（我們升版＝整組升級）。
- 用戶若自行直裝同名插件：**⚠️ 2026-10-13 實測推翻原本的「不算衝突」結論。** pnpm 確實會去重「包」，但**組合層不會去重「row」**——`applyEntryPatches`（dsh-app-boot lib/index.js:86-88）無條件 `data.push(...insert)`，`buildMap()` 對重複 id 只靜默覆蓋，結果是同一個插件出現**兩行活的 row**、零警告。所以正確說法是：用戶若已直裝某精選插件，**必須先移除直裝**再裝本 bundle，否則該插件雙重激活。只有 `dsh-better-sidebar` 自帶防護（它的 row 用 `disabled: !!js` 偵測同名 entry 並自我停用）。詳見 `docs/ops-lessons.md` 規則 12。
- 解除安裝本 bundle＝整組依賴一併移除，官方品牌完全還原。

### 3.5 技能集成：機制、兩種路徑與候選清單

#### 機制（已驗證）

`lib/index.js` 實作 `@deepseek-ai/dsh-skill-office` 模式：**`skills/<name>/SKILL.md` 目錄丟進包裡即自動註冊**——`ctx.skills.registerProvider()` 掃描整個目錄，rank 600（輸給用戶自帶同名技能）、可攜帶資源子目錄（`resourceBase: directory`）、隨包升級、停用 row 即全組消失、不複製任何檔案到用戶目錄。

#### 兩種集成路徑

| 路徑 | 做法 | 適合 | 代價 |
|---|---|---|---|
| **Vendor（內嵌）** | 把 SKILL.md＋資源＋授權檔複製進我們 `skills/` | 輕量純文字技能、要貼牌改寫的 | 授權隨行義務；上游更新要手動同步 |
| **依賴（隨行插件）** | 技能包作為 `dependencies`＋insert row（§3.4） | 結構複雜、帶工具鏈的技能包 | 更新隨包版本；受各包 peer 約束 |

#### 硬約束（本次調研發現）

1. **frontmatter 解析器只支援單行純量**（`lib/index.js` 刻意零依賴）。上游技能常用多行 `description: |`（本機 humanizer 即是）——vendor 前要嘛逐個展平、要嘛先升級解析器支援塊純量（小改動）。**建議升級解析器**。
2. **anthropics/skills 根目錄無授權檔**（GitHub API 確認 license: None，★18 萬）——逐技能檢查；office 系列在 repo 內各自帶 `LICENSE.txt`，複製時必須連授權檔一起帶、並在 README 署名。
3. **與官方去重**：桌面端自帶 office-docx/pptx/xlsx（`Resources/runtime/office-skills`）——這三個不要重複出貨。
4. **目錄規模紀律**：每個技能的 description 都會進入模型可見目錄、吃 context——基線建議 ≤8~10 個高信噪比技能，其餘走「依賴」或讓用戶自選。
5. 每技能 `name` 必須 kebab-case 且與目錄名一致；碰撞時 rank 600 自動讓位用戶版本（安全）。

#### 候選清單（口碑與授權已查證，2026-10-13）

| 候選 | 口碑 | 授權 | 建議路徑 |
|---|---|---|---|
| obra/superpowers 方法論 14 技能（planning/TDD/debugging 等） | ★298k；DSH 移植版 @wenaixi/dsh-superpower 7.7.2 | MIT | **Vendor 精選 5~6 個**（移植版是帶 react peer 的完整插件，依賴不划算） |
| mattpocock/skills 工程×生產力 25 技能 | ★288k；移植版 dsh-mattpocock-skills-deck 下載 6.2k、`engines.dsh: >=0.2.0-rc.2` 先例 | MIT | **依賴**（deck 是完整插件、無 peer；或 vendor 上游精選） |
| anthropics/skills 通用寫作/研究類（humanizer、research-and-citations 等；本機同源已裝 20 個） | 事實標準 | 逐技能（多數 MIT＋LICENSE.txt） | **Vendor 精選**（docx/xlsx/pptx 除外，官方已帶） |
| @dhicoc/dsh-reverse-skill 85 技能逆向包 | 下載 3.2k、★173 | MIT | 不入基線（受眾窄）；可作可選依賴 |
| dsh-plugin-guide（官方插件開發知識庫技能） | 下載 4.3k | Apache-2.0 | 可選依賴（對生態貢獻者有價值） |
| dsh-remotion（官方 Remotion 移植） | 下載 1.9k | MIT | 不入基線（node 門檻 `^22.19 \|\| >=24`） |

#### superpowers 展開（15 技能全表，上游 2026-10-10 仍活躍，SKILL.md 合計 3,929 行）

| 分組 | 技能 | 行數 | 用途（description 摘要） | 附帶資源 |
|---|---|---|---|---|
| 規劃 | brainstorming | 288 | 任何創造性工作前**必用**：探索意圖、需求與設計 | spec-reviewer 提示詞、視覺輔助 |
| 規劃 | writing-plans | 207 | 有規格/需求後、動碼前寫多步實施計畫 | — |
| 規劃 | executing-plans | 376 | 在當前 session 親自執行計畫（無 subagent 時） | scripts |
| 規劃 | subagent-driven-development | 579 | 用 subagent 分工執行計畫（實作/審查角色分離） | 4 個提示詞檔＋scripts |
| 品質 | test-driven-development | 333 | 任何功能/修復先寫測試再實作 | writing-good-tests |
| 品質 | systematic-debugging | 286 | 遇 bug/測試失敗，先根因分析再提修法 | 根因追蹤、find-polluter.sh 等 10 檔 |
| 品質 | verification-before-completion | 123 | 宣稱「完成/修好」前必須跑驗證命令並確認輸出 | — |
| 品質 | requesting-code-review | 98 | 完成任務/大功能/合併前請求審查 | code-reviewer.md |
| 品質 | receiving-code-review | 208 | 收到審查意見：技術求證而非表演性接受 | — |
| 工作流 | dispatching-parallel-agents | 170 | ≥2 個無依賴獨立任務時並行分派 | — |
| 工作流 | using-git-worktrees | 170 | 開 feature 前建立隔離工作區 | — |
| 工作流 | finishing-a-development-branch | 228 | 實作完成、測試全綠後決定整合方式 | — |
| 元 | using-superpowers | 71 | session 開場元技能：任何回應前先查技能（激進） | references |
| 元 | diagnosing-superpowers | 123 | superpowers session 出問題時的事後診斷 | prompts/templates |
| 元 | writing-skills | 684 | 創作/編輯/驗證技能本身的元方法論 | graphviz、說服原則等 4 檔 |

**GA 基線建議取 6**（通用價值最高、彼此觸發不衝突）：brainstorming、writing-plans、executing-plans、test-driven-development、systematic-debugging、verification-before-completion。
**✅ 已執行（2026-10-13）**：上述 6 技能已 vendored 進 `skills/`（上游 main @ `bb92a777`，逐字未改——上游 description 本就無前綴，「Superpower Skill:」為移植版自行添加），`skills/superpowers/` 存上游 LICENSE＋SHA，`skills/THIRD-PARTY.md` 記錄溯源；`lib/index.js` 解析器同步升級（引號剝除、`|`/`>` 塊純量、清單/空值容錯）並新增 `__test` 測試出口，Node 回歸全綠。版號 → `0.2.0-alpha.1`（未發佈）。
**不入基線**：三個元技能（using-superpowers 的「任何回應前必查技能」會與 ga-identity 簽署行為搶主導權；writing-skills 雖優秀但受眾是技能作者，可作可選項）；git-worktrees／finishing-branch／receiving-review 偏團隊 git 工作流；dispatching-parallel-agents 依賴 agent-teams 可用性；subagent-driven-development（579 行）對純瀏覽器用戶過重。
**Vendor 時改寫**：description 開頭的 "Superpower Skill:" 品牌前綴改為中性/GA 措辭（MIT 允許，README 署名 obra/superpowers 即可）。

#### MCP 路徑可攜化——方案已實驗定案

`cordis.patch.yml` 的 YAML 方言**官方支援 `!!js` 表達式**（`entryListSchema = JSON_SCHEMA.extend(JsExpr)`；cordis-plugin-loader 於 entry 激活時以 `with(ctx){eval(expr)}` 遞迴求值）。已用 `dsh --profile web --patch <file> --dump-config` 離線實驗證實解析與掛載。且 loader 上下文帶 **`baseUrl`**（patch 所屬套件目錄）——beta 前把 MCP row 改成：

```yaml
command: !!js "process.env.GA_NODE || process.execPath"
args:
  - !!js "baseUrl.replace(/\/+$/, '') + '/mcp/ga-status-server.mjs'"
```

待實測項：`baseUrl` 在 insert row 語境下指向本包目錄還是被插 entry 目錄；若不符，回退 `process.env.DSH_HOME` 組合路徑。此項從「研究方向」升級為「已定案的待實測項」。

---


## 4. 打包與發佈流程（研發完成後執行）

### 4.1 發佈前檢查清單

- [x] `LICENSE`（MIT）注入 repo 根目錄（2026-10-13 已完成；npm 自動收入 tarball，無需加 `files`）
- [ ] `mcp/` 絕對路徑 → `!!js` baseUrl 寫法（§3.5 已實驗定案：schema 支援、dump-config 掛載通過），乾淨機器啟動實測一次
- [x] 升級 `lib/index.js` frontmatter 解析器支援多行 `description`（§3.5 硬約束 1，vendor 前置）——2026-10-13 完成（引號剝除＋塊純量＋容錯，`__test` 回歸全綠）
- [x] 精選技能入包：每技能授權檔隨行＋README 署名表；與官方 office skills 去重（§3.5）——2026-10-13 完成（superpowers 6 技能）
- [x] package.json 加 `engines.dsh`（`"dsh": ">=0.2.0-rc.2"`；供市集顯示，core 不攔）
- [x] 確認 `files` 內容完整：`lib/ brand/ skills/ mcp/ cordis.patch.yml README.md`（LICENSE 由 npm 自動收入）
- [x] 確認零 install 期 scripts（`scripts` 僅含 `test`，非安裝期生命週期鉤子）
- [ ] 換上正式品牌素材（`lib/client.js` 的 PRODUCT_NAME/mark/wordmark/色票，見 README 對照表）
- [x] `pnpm pack` 乾檢：tarball 內容、`package.json` 的 `dsh.bundle.patch`/`dsh.client` 宣告無誤
- [x] **npm 佔名發佈**：`dsh-general-agentics@0.1.0-alpha.1` 已上架（dist-tag `alpha`；因是首發版本，`latest` 亦暫指向它，發佈正式版時自然移動）。該版攜帶本機絕對路徑的 MCP row（後已修復），已 deprecate
- [x] 乾淨 profile 實測四件事：tarball 安裝、Cmd+R 後品牌生效（瀏覽器實測：標題/favicon/manifest/slot/主色）、新 session 有 `ga-identity` 等 14 個技能與 `ga_bundle_info`（MCP stdio 實測）、解除安裝完全還原（deps/bundles/node_modules/組合/boot payload 全清）

### 4.2 CI/CD（GitHub Actions，tag 觸發）

1. `pnpm pack` → 檢查 tarball
2. `npm publish`（stable tag `latest`；預發版用 `beta`）
3. 同步上傳 `.tgz` 到 GitHub Release（tarball 備援通道的來源）
4. npm 啟用 provenance（加分項：可驗證建置來源）

### 4.3 分階段上路

| 階段 | 做什麼 | 通道 |
|---|---|---|
| Alpha（研發尾聲） | `npm publish --tag beta`；內部用 `dsh-general-agentics@beta` 實測 | GUI/B（指定版本） |
| Beta（小圈子） | GitHub Release tarball 給無 npm 帳號測試者；landing page 上線 | ＋tarball 直鏈 |
| GA | `latest` dist-tag；awesome-dsh-plugin PR；宣發 | 全通路（A/B/C/D＋備援） |

### 4.4 維運

- **更新**：市集一鍵更新／GUI／CLI；重大 DSH 版本發佈後跑 brand 回歸（slot 佔位、DOM 改寫、favicon）再放行 `latest`。
- **版本政策**：semver；0.x 直到品牌素材定稿；DSH 版本相容矩陣寫進 README（`engines.dsh` 對齊）。
- **回滾**：解除安裝即完全還原官方品牌（本 bundle 設計保證）；用戶端也可熱停用（`cordis.patch.yml` disabled row）。

---

## 5. 風險與開放問題

1. **npm 包名搶註**：名稱仍未註冊，任何人都可先發——建議本週內先發 alpha 佔名。
2. **上游依賴**：brand half 綁 DSH slot/DOM 約定；DSH 大改版可能需跟版（補償：profile 內存活、升級不覆蓋、解除安裝還原）。
3. **市集為第三方**：收錄時程與規則不受我們控制；主動線（A/B）不依賴它，風險可隔離。
4. **提示詞動線的政策前提**：用戶 session 若非 danger-full-access，`plugin_manager` 會彈核准——屬可接受的一次性摩擦，但對外文案要預告。
5. **`dsh://install` 未來若出現**：landing page 的「複製提示詞」區塊可換成真連結按鈕，架構不用改；可先向上游提 feature request。

---

## 附錄：證據出處

- spec 解析／registry 策略：`~/.dsh/runtime/node_modules/.pnpm/@deepseek-ai+dsh-plugin-manager@0.2.0-rc.2*/lib/types/install-spec.js`、`registry.js`
- 官方 Plugins 頁（Add plugin 對話框）：`@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js`
- CLI desktop profile 限制：`@deepseek-ai/dsh/lib/plugin-*.js`（`requireDesktopProfile`）
- peer 豁免制：`@deepseek-ai/dsh-app-boot/lib/index.js`（`readProfileCompatibility`）
- `dsh://open` 僅聚焦視窗：桌面 App `app.asar` 主進程（`setAsDefaultProtocolClient("dsh")` + `open-url` handler）
- 市集一鍵安裝／收錄流程：[dshmarket README](https://github.com/dsh-market/dsh-market)、[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com)（Get your plugin listed）、收錄 YAML 樣本（repo `data/plugins/`）
- npm 包名可用：registry.npmjs.org/dsh-general-agentics → 404（2026-10-13）
