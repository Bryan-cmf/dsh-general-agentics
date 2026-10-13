# 維運規則庫（Ops Lessons）

本檔案沉澱 General Agentics bundle 開發與部署過程中驗證過的規則。
規則編號是穩定引用（`cordis.patch.yml` 與 `lib/index.js` 的註解按編號引用，如 rule 5），
新增規則只追加、不改號。完整的事故記錄與復盤由維護者私下保存，不入庫。

---

## 安裝與啟動安全

1. **tarball 安裝前必須驗證 repo 存在且可審計**；查無此倉 = 不裝。文章 URL 不是信任憑證。
   npm 上也存在搶名包（裸名與正主 repo 歸屬不一致），安裝前先核對 repo 歸屬。
2. **`failed to import` 警告重複出現（≥2 次）= 插件已壞**，立即移除或降級，
   絕不帶著它請用戶重啟。
3. **row 級變更（restart-required）交給用戶前，先離線驗證組合**：
   用一個拋棄式 profile 跑 `dsh --profile <name> --dump-config` 數 row。
4. 讀崩潰日誌只看 `[errors]` / `Failed plugins` 段；
   「Plugins waiting for services」清單是單點失敗的連鎖噪音，不是多個問題。
5. **一個必需插件啟動失敗 = 全 App 無法啟動**（不是降級運行）→
   插件安裝是高風險操作，安裝後必須驗證啟動。

## 環境

6. 插件管理器報 pnpm store 錯誤（`ERR_PNPM_UNEXPECTED_STORE`）時，多半是 host
   解析到了另一套 pnpm（例如從帶 nvm 的 shell 啟動）。對策：以平常方式
   （Dock/Finder）重啟 App 讓環境自癒；不要亂改全域 pnpm config，
   host 內建的 pnpm 可能連 rc 檔都不讀。
7. 手動修 profile 依賴的路徑：改 profile 的 `package.json`
   （dependencies + bundles）→ 用正統 pnpm install → 再觸發一次組合重套。

## 插件本地修補

8. 需要系統授權（TCC）的插件：狀態查詢走 daemon 的 `permissions status`；
   批准後仍 pending 就重啟 daemon。
9. 給 `node_modules` 內的插件檔案打本地補丁後，bundle 開關重套**不足以**重載模組
   ——需完整重啟 App 才能驗證；補丁應回報上游，升級會覆蓋。
10. 驗證 computer-use 類閉環時選可驗證的安全目標（計算器顯示屏、瀏覽器標題），
    絕不用戶文檔。

## Bundle 策展（規則 11-15 為實測結論，DSH 0.2.0-rc.2）

11. **候選插件不得帶任何 `@deepseek-ai/*` 核心包的硬 `dependencies`。**
    peer 可以（profile 是 `autoInstallPeers: false`，共享層
    `~/.dsh/profiles/node_modules` 會滿足它們，pnpm 只印警告）；
    硬依賴不行——profile 是 `nodeLinker: hoisted`，舊核心包會被提升到
    profile 根，runtime 版本檢查直接拒絕並停用對應 row，整棵服務樹癱瘓。
    檢查一行就夠：
    `node -e "console.log(Object.entries(require('<pkg>/package.json').dependencies).filter(([k])=>k.startsWith('@deepseek-ai/')))"`。
12. **`insert` 不 dedupe。** `applyEntryPatches`（dsh-app-boot lib/index.js:86-88）
    無條件 `data.push(...insert)`，`buildMap()` 對重複 id 只是靜默覆蓋 →
    同一個插件會出現**兩行活的 row**，無任何警告。用戶若已直裝某個精選插件，
    必須先移除直裝，否則該插件雙重激活。
    （`dsh-better-sidebar` 自帶防護：它的 row 用 `disabled: !!js` 偵測同名 entry
    並自我停用——值得當作上游典範。）
13. **驗證 bundle 一定要用「從官方模板建的乾淨 profile ＋ `npm pack` 出的 tarball」**，
    不能用 `link:` 開發安裝或既有 profile：
    `dsh --profile <name> --from-default-profile web --dump-config` 建 profile →
    `dsh plugin --profile <name> add <abs>.tgz` → `--dump-config` 數 row →
    `dsh --profile <name> --port <free> --no-open` 真的啟動。
    注意：從模板建的 profile 自帶 app，啟動時**不要再傳 `web`**
    （會報 `too many arguments`）；自動建立的空 profile 才需要傳。
    另：`file:` 安裝在**版號不變**時可能被 pnpm 視為 up-to-date 而不重新解包
    ——內容變了就要升版號或先 remove 再 add。
14. **`!!js` 求值上下文（實測）**：`baseUrl` 是 **profile 目錄**的 file: URL
    （不是本包目錄）；`process.execPath` 是 host 自己的 node（可攜）；
    `process.cwd()` 不可靠（CLI 從哪跑就是哪）。`--dump-config` **不求值**
    `!!js`，只原樣回印——只有真的激活才能驗證表達式。可攜路徑寫法：
    `command: !!js "process.execPath"`，
    `args: [!!js "decodeURIComponent(new URL('node_modules/<pkg>/<file>', baseUrl).pathname)"]`
    （Windows 上 `URL.pathname` 會給 `/C:/…`，屆時需換 win32-aware 寫法）。
    另：`cordis:include` 的 `config.path` 指向 entry list 而非 patch list，
    且 config 內表達式不求值——**不能用 include 去載入別的包的 patch 檔**。
15. **`failOnStartupError` 預設是 `false`**（dsh-mcp-client lib/index.js:788）；
    寫 `true` 會讓連不上的 server 從 `apply()` 拋錯（:832）→ Loader entry 失敗 →
    可能整個 App 起不來（rule 5）。狀態回報類 server 一律不寫這行。
