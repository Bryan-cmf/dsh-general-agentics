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

16. **override row 必須放在 patch 檔頂層（`- insert:` 清單之外）。**
    巢狀在 insert 裡的 `- id:` row 不是覆蓋，是被**插入的新 entry**（同名死 row）；
    且 id 查找是「後者覆蓋」，之後任何 override 會默默打在死 row 上而非真目標。
    實測（DSH 0.2.0-rc.2）：頂層 `- id: web / config: …` 正確合併進 base row
    （config **整體替換**，其餘鍵要重述）；同一行巢狀進 insert 則 base 不變、
    多出一行。帶不帶 `name` 皆可（name 是斷言，不是開關）。
    另：dsh-mobile 的 mobile-access 實際監聽埠存於**機器級**
    `~/.dsh/mobile-access/setup.json`（config 的 listenPort/listenHost 只是種子），
    同機多 profile 各跑一個 gateway 必然撞埠（一個 EADDRINUSE 警告，App 仍可啟動）。

17. **自家策展 row 用獨立 id（`ga-` 前綴），不要沿用上游 id。**
    用戶若已直裝同一插件，其自身 bundle patch 會再插一行；**兩行同 id 會讓設定頁
    永遠寫不進 config**：`dsh-config-editor` 的驗證用 `find()`（取第一個同 id row，
    lib/index.js:122），而 config override 合併進**最後一個**同 id row，兩者永不相等
    → 拒寫並拋 `Configuration for "X" is overridden by a home patch or command-line
    overlay`（訊息誤導：實際上可能根本沒有 home patch / CLI overlay）。
    症狀：設定頁開得了但存不了，例如 Agency 專家永遠 0 enabled。
    **宣告式去重做不到**：loader 按樹序逐個建立 entry，row 求值時看不到「之後才插入」
    的重複（實測：我們的 row 求值時已有 189 個 entry，直裝那行還不存在）——
    所以 `!!js` 自我守衛不可靠；正解是獨立 id ＋ 要求用戶移除直裝（rule 12）。

18. **不要對 profile 直接下 `pnpm install`；兩個 profile 的 store 設定不同。**
    desktop 的 store 來自 `~/.npmrc` 的 `store-dir`（`~/.pnpm-store/v11/v10`），
    但 **web profile 自己用 `pnpm-workspace.yaml` 的 `storeDir` 設成 profile 內的
    `.pnpm-store/v10`** → 用同一個 pnpm 跑兩個 profile，其中一個必然
    store 不符（`ERR_PNPM_UNEXPECTED_STORE` 之類）。
    而且 desktop profile 由 Electron 管理，**必須先完全退出 App**。
    正規化依賴請走 DSH 工具（plugin_manager / `dsh plugin add|remove`），
    它會用正確的 pnpm 與 store；真要手動跑，一次只跑一個 profile、先退出 App，
    並把輸出存檔（`pnpm install 2>&1 | tee /tmp/pnpm.log`）以便分辨
    `ERR_PNPM_*`（真失敗）與 peer／build-script 警告（大量但無害）。
    這兩個 profile 的 `autoInstallPeers: false` 會讓 pnpm 列出每一個未滿足的
    peer，動輒數十行——那是警告牆，不是故障。

19. **把 `link:` 開發安裝升級為正式安裝（含 desktop profile 的完整流程）。**
    症狀：bundle 說好隨附的插件「看不到」。原因不是插件壞了，而是
    **pnpm 不會安裝 `link:` 依賴的依賴** —— 該 profile 只有使用者另行直裝的
    那幾個插件可用（desktop 實測：13 個精選插件中 12 個是直裝，缺的
    `dsh-sentinel` 就永遠不會出現）。
    遷移步驟（desktop profile 專用，因為 `dsh plugin` 會拒絕它：
    `profile "desktop" is managed exclusively by the Electron application`）：
    1. 完全退出 App，備份 `package.json` 與 `pnpm-lock.yaml`；
    2. 把 bundle 的 spec 從 `link:…` 改成 `file:/絕對路徑/<pkg>.tgz`
       （或 registry 版本），**tarball 要放在 repo 之外**的穩定路徑，
       否則清 `*.tgz` 會讓日後的 install 失敗；
    3. `cd ~/.dsh/profiles/<p> && /opt/homebrew/bin/pnpm install`
       —— desktop 的 store 來自 `~/.npmrc`，與 `.modules.yaml` 記錄相符；
    4. 再把 12 個直裝從 `dependencies` 與 `dsh.profile.bundles` **一起**移除
       （只移除依賴不夠：bundles 條目會讓插件自己的 patch 層再插一次 row），
       再跑一次 pnpm install；插件仍以 bundle 的傳遞依賴身分留在
       node_modules，所以模組照樣解析得到；
    5. **檢查 profile 自己的 `cordis.patch.yml`**：指向舊 row id 的覆蓋行會
       變成死行（實測 desktop 有 4 條），其中使用者的個人設定
       （agency-agents 的 `enabled` 專家清單與 `enabledTeams`）會靜默失效。
       把這些覆蓋行改指向 `ga-` 前綴的新 id，並**移除 `name:` 欄位**，
       否則覆蓋行會用舊模組名把 row 的 `name` 一起蓋掉。
    6. 無法用 CLI dump desktop profile 的組合（同樣被拒），改用等價複本驗證：
       另建一個 profile 目錄，複製 `package.json` 與 `cordis.patch.yml`，
       `node_modules` 用符號連結指向原 profile，再 `--dump-config`／啟動。
    驗證要點：13/13 可解析、每個插件恰好一行 row、啟動 0 失敗、
    `dsh-sentinel/client.js` 出現在 boot payload、面板端點回報「未提供: 0」。

20. **插件更新機制（實測，pnpm 10.33.2）——bundle 升版不會移動插件。**
    | 動作 | 插件版本 |
    |---|---|
    | 全新安裝（`^x`） | 取範圍內最新 ✅ |
    | 只升 bundle 版本、範圍不變 | **不動**（lock 已滿足） |
    | 把 `~x.y.z` 放寬成 `^x.y.z` | **仍不動**（lock 已滿足新範圍） |
    | **提高 floor**（讓已鎖定版不再滿足，如 `^3.27.1`） | **重解、跟著動** ✅ |
    | profile 內 `pnpm update` | 全部升到範圍內最新 ✅ |
    所以「一鍵更新 bundle 會連帶更新插件」**只有在該次發佈提高了對應 floor 時成立**。
    另外 `^0.x.y` 依 semver **不含 minor**（`^0.68.1` = `>=0.68.1 <0.69.0`），
    而 0.x 的 minor 正是上游還可能破壞的地方 → 0.x 插件的更新必須人工提 floor
    並逐一驗證。用 `npm run check-upstream` 看清差距再決定。
    驗證方法很重要：**不可以把新版直裝到已有本 bundle 的 profile**——那會造成
    同一插件兩行 row、重複註冊，症狀看起來像「新版不相容」
    （實測：`modsearch` 報 provider id 已註冊、`typert-loader` 爆棧、
    11 個 entry 餓死）。正確做法是把 floor 寫成一個**測試 bundle**、
    在乾淨 profile 安裝一次（每個插件只有一行）再啟動驗證。

21. **上游改了附帶 entry 的模組名：dsh-mobile 0.6.x。**
    dsh-mobile 的 question-fixes 子套件，0.5.x 用模組名 `dsh-mobile-question-fixes`，
    0.6.x 改成相對**它自己** patch 檔的路徑 `./packages/question-fixes/lib/index.mjs`。
    我們的 patch 錨定在自己的套件目錄，所以兩種版本都適用的寫法是
    `./../dsh-mobile/packages/question-fixes/lib/index.mjs`
    （hoisted 佈局下 `dsh-mobile` 與本套件是 node_modules 的兄弟；0.5.5 與 0.6.10 皆有此檔）。
    不這樣寫的症狀：`dsh-ui-fixes (dsh-mobile-question-fixes): failed to import`。

22. **DSH 0.2.1 的安裝閘門（會讓整包安裝被拒）。**
    0.2.1 起 `dsh plugin add` 會先驗證每個插件的相容性：**有 `engines.dsh` 就只看它，
    否則檢查它對 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 peer 範圍**，
    並用 `semver.satisfies(runtime, range, {includePrerelease:true})` 判斷。
    **只要一個插件不合格，整個安裝被拒絕並回滾**（錯誤訊息會列出不合格的
    requirements 與 `allow-version` 的用法）。
    實測（0.2.1-rc.2）：`@michengai/dsh-agency-agents` 所有版本都不被接受
    （peer 只列 0.1.x），`dsh-web-search-pro` 只有 0.1.2 可過（降級）→ 兩者移出精選清單。
    這類問題**不能只靠啟動驗證發現**——安裝階段就失敗了，所以要用
    `npm run check-dsh-compat`（照閘門規則掃所有版本）在發佈前確認，
    並讓 `engines.dsh` 只寫 `>=`（寫上限會擋掉 rc 版）。

23. **desktop profile 必須用「App 自己的 pnpm」安裝，不能用 CLI/homebrew 的 pnpm。**
    機器上有兩套 pnpm、兩個 store：
    | 來源 | 版本 | store |
    |---|---|---|
    | CLI / homebrew | pnpm 10.33.2 | `~/.pnpm-store/v11/v10`（來自 `~/.npmrc` 的 `store-dir`） |
    | 桌面 App 內建 | **pnpm 11.28.5** | **`~/Library/pnpm/store/v11`**（App 的預設值，不讀那個 npmrc） |
    若用 CLI 的 pnpm 對 desktop profile 做 `install`，node_modules 會 link 到 v10 store，
    之後 **App 內的 plugin manager 任何安裝／更新都會失敗**：
    `.plugin-manager/logs/operation-*/pnpm.log` 出現
    `ERR_PNPM_UNEXPECTED_STORE`（"currently linked from … pnpm now wants to use …"），
    而 UI 上的「更新」看起來**完全沒有反應**。
    正確做法（App 退出後）：
    ```
    cd ~/.dsh/profiles/desktop
    APP_PNPM="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
    CI=true node "$APP_PNPM" install --no-frozen-lockfile --config.confirmModulesPurge=false
    ```
    注意兩個坑：`CI=true` 會預設 `--frozen-lockfile`（改過 spec 就必須加 `--no-frozen-lockfile`），
    而 store 變更會觸發「清空 node_modules」，非 TTY 下需要 `--config.confirmModulesPurge=false`。
    驗收：`.modules.yaml` 的 `storeDir` 應為 `~/Library/pnpm/store/v11`、
    `packageManager` 為 `pnpm@11.28.5`，且 `CI=true node "$APP_PNPM" install --frozen-lockfile` 應為 no-op。

24. **會執行動作的寫入路由必須自己驗證來源。**
    DSH 的 web server 上掛的路由會被 dsh-mobile（LAN／隧道）代理；我們最初只做 GET/POST
    分流，任何能打到該 URL 的人都能觸發安裝。現在 POST 要求 same-origin 與一次性 token
    （GET 下發、POST 以 `x-ga-csrf` 回送）；沒有 CORS 標頭，跨站頁面讀不到 token。
    驗證方式：無 token／錯 token／`Sec-Fetch-Site: cross-site`／外站 `Origin` 都必須 403
    且 profile 不被改動；合法請求才 200。

25. **不要對 `document.body` 掛「每次變動都掃全文件」的 observer。**
    原本的致敬行改寫在每個 mutation 都用 TreeWalker 掃整份文件；串流回覆時每個 token
    都會觸發。改成：① MutationObserver 只處理**本次變動的子樹**（`addedNodes`／
    `characterData` 的 target）② 反應以 `requestAnimationFrame` 合併，每 frame 最多一次。
    實測 200 次同步 DOM 變動 → 1 次 flush（原本 200 次）。把計數器掛在
    `window.__DSH_GA_DIAG__` 讓這個聲明可被複驗。

26. **YAML 的 `!!js` 值不能以 `!` 開頭。**
    `disabled: !!js !expr` 會被 YAML 解析成「第二個 tag」，整個 overlay 解析失敗，
    plugin manager 直接**拒絕整個安裝**（而且 dump-config 不會評估運算式，肉眼難察）。
    寫成 `expr === false` 或整段加引號。防線：測試會把每個單行 `!!js` 值當 JS 解析，
    `prepublish-check` 用 runtime 的 js-yaml（註冊 DSH 的 `!!js` tag）實際解析 overlay；
    故意弄壞時必須以非 0 結束。

27. **面板一次要打 14 個 registry 查詢時：先畫快照、再補矩陣，並加 TTL 快取。**
    實測：快照 0.060s、矩陣首次 0.337s、第二次 0.002s（60 秒 TTL）。
    未知狀態要顯示「查詢中」而不是誤報「最新」。

28. **沒 inject 的服務：存取就會拋，而且會讓整個 client half 掛掉。**
    我們在 `apply()` 直接讀 `ctx.locale` 想接 App 的語言，結果 entry 啟動失敗、
    UI 顯示「Failed to load plugins — dsh-general-agentics: failed」。cordis 只保證
    inject 清單內的服務；其他屬性存取可能拋。規則：任何非 inject 的服務讀取都要包
    try/catch，且 client half 的任何初始化都不得讓 apply 拋出。驗證方式：每次改
    client 後用乾淨 profile 開一次頁面，確認沒有 `did not activate`。

29. **list slot 用 `id` + `order` 註冊，不是 `priority`。**
    我們的側欄 footer 狀態列一開始用 `priority: -1` 註冊進
    `sidebar.footer.action`，結果**完全不會渲染**（也沒有錯誤）。對照同一個 slot 的
    其他插件：`{ name, id, order, inject }`。single slot 才用 priority（且實測只接受負值）。
    驗證方式：加一個 `data-*` 屬性並在瀏覽器查 DOM，不要只看程式碼。

30. **observer 驅動的 title 改寫必須冪等。**
    我們在 head 的 MutationObserver 裡改寫 `document.title`，其中一個分支無論如何都賦值；
    title 變動 → observer → 再賦值 → 無限迴圈。實際症狀：瀏覽器 22 個進程、800% CPU、
    頁面永遠載不完。規則：每一次 `document.title = …` 之前都要比較目前值；並用探針
    把這個約束固定下來（P15）。

31. **pnpm 11 的 `minimumReleaseAge` 會擋下「剛發佈」的版本。**
    桌面更新時，`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 把剛發佈 30 分鐘的
    alpha.27 判為不可信（預設 24h）。本機由自己發佈、確定可信時，用
    `--config.minimumReleaseAge=0` 只放寬該次安裝；不要關掉全域策略。

32. **pnpm 只把「直接依賴」連結到根 `node_modules`。**
    App 的安裝器把 bundle 的傳遞依賴（如 `dsh-comments`）放成根層的實體目錄；
    `pnpm update` 只更新 `.pnpm` 與鎖檔，根層目錄不會跟著換。更新這類插件後要
    確認根層版本，必要時從 `.pnpm/<pkg>@<ver>/node_modules/<pkg>` 複製回去。
    真正的長久修法是提高 bundle 的 floor（本 repo `dependencies.dsh-comments`
    已改 `^0.5.7`），讓下一次 bundle 安裝把它一起帶上。

33. **跨外掛覆蓋樣式時，`!important` 不是可選項。**
    面板要收窄外掛的控制項時，我們的 `<style>` 比外掛自己的樣式表**早**載入：
    - promptimizer 的 caret 被行內 `display:flex` 壓過（規則在但無效）
    - agency-agents 的 Experts chip 被它自己的 `font-size:13px` 壓過（維持 83px）
    兩者都要 `!important` 才生效。驗證方式：在瀏覽器讀 `getComputedStyle`，
    不要只看「規則有寫進去」。
