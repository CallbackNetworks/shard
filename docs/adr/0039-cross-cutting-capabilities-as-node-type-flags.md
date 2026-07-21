# ADR-0039: 跨切能力作為節點型別旗標 —— 解除內建 identity 的特權

## Status
Accepted

## Date
2026-07-20

## Context

後端已完成 node/edge 全面遷移([ADR-0032](0032-unified-node-edge-graph-model.md) / [ADR-0033](0033-graph-foundation-final-shape.md)):每個一等實體都是 `Node`,type 詞彙資料化在 `node_types` 註冊表,且使用者可自訂 container 型([ADR-0034](0034-user-defined-containers-and-compat-project-fields.md))與 task-like 型([ADR-0035](0035-user-defined-task-like-types.md))。前端也圖原生化([ADR-0037](0037-graph-native-frontend.md)):任何 node 有 `/n/:id`,container 有 `/c/:id`,自訂型有 `/t/:typeKey` 入口。

ADR-0033 立下的核心原則是 **「角色是資料欄位,不是類別繼承(composition over inheritance);型別在執行期由使用者定義」**。`is_container` / `is_task_like` 就是這個範式的體現:能力用 flag 表達,而不是把 `n.type == "project"` 寫死。

**但三個跨切能力沒跟上這個範式,仍停在「內建型別特權」的舊世界:**

1. **公開分享門面**(share token + PIN + 到期 + 瀏覽計數)只屬於 `identity` 與 `project`。endpoint 是 `/{identity_id}/rotate-share-token`、`/set-pin`;分享頁路由只有 `/share/:token`(identity)與 `/share/p/:token`(project)兩種硬編碼 scope。
2. **iCal 訂閱**只有三種寫死的 scope:global(personal)、identity、project(`bulk.py`)。
3. **身份級聚合分析**(`IdentityChartsView`)只認 identity。

矛盾在於:**存儲層其實早已通用化。** `share_token` / `share_pin_hash` / `share_expires_at` 都存在 `Node.data` JSON(`services/graph/identities.py`),不是 identity 的專屬資料庫列——任何 node 在資料層都能掛這些欄位。私有化發生在**服務層(endpoint 綁 identity_id、token 查找限定 type)與 UI 層(能力只露在 `/identities` 頁)**,不是資料層。

**觸發場景:** 使用者若建立一個 `topic`(話題)node type,想要它也能對外分享、也能生成 iCal feed、也能看聚合——目前做不到,得回後端加一種新 scope、加 endpoint、加前端頁面。`topic` 與 `identity` 在能力上不對稱,而兩者在資料模型上明明是同構的 node。這既是使用者體驗的不準確,也是對 ADR-0033 哲學的背離:graph migration 把「實體」與「關係」資料化了,卻漏了把「跨切服務」資料化。

力場:使用者偏好克制的設計(復用既有機制優於新增);分享 token 的安全模型(HMAC 簽章、PIN、到期,見 [ADR-0025](0025-project-share-expiry-and-audit.md)、[ADR-0030](0030-app-auth-hardening-and-forward-auth.md))已驗證且不宜動搖;既有 `/share/:token`、`/share/p/:token`、三種 iCal 路徑是**對外契約**,已被使用者訂閱,不可破壞。

## Decision

**跨切能力也要資料驅動,與 `is_container` 同範式。** identity 不再是「擁有分享/訂閱特權的特殊型別」,而是「內建型別裡恰好把這些能力旗標設為 true 的一個預設實例」。

1. **`NodeType` 新增 capability 旗標** —— 與 `is_container` / `is_task_like` 並列:
   - `is_shareable`:可生成公開分享門面(token / PIN / 到期 / 瀏覽計數)。
   - `is_subscribable`:可生成 iCal feed(涵蓋其 `contains` 子樹)。
   - **聚合分析不新增旗標**,複用 `is_container` —— 「任何容器都可聚合它包含的任務」,identity 的聚合只是 container 聚合的一個實例。
   - Seed:`identity` 與 `project` 都設 `is_shareable=is_subscribable=true`(維持現有行為),`identity` 額外保有 `is_container` 語義(已存在)。

2. **存儲零遷移** —— share 欄位已在 `Node.data`,任何 node 天然可掛。不新增資料庫列,不搬資料。

3. **服務層去特權化** —— 分享與訂閱按 **capability 旗標**而非 **type** gating:
   - token 查找從「限定 `type == identity/project`」改為「限定該 node 的型別 `is_shareable`(或 `is_subscribable`)」。
   - 新增通用路由 `/share/n/:token`(任何 shareable node)與 `/ical/node/:token.ics`(任何 subscribable node 的 `contains` 子樹)。
   - **舊路由 `/share/:token`、`/share/p/:token`、三條 `/ical/*` 全部保留**,內部委派給通用實作,對外契約不變。
   - 分享操作 endpoint 從 `/{identity_id}/...` 泛化為 `/nodes/{id}/share/...`(rotate-token / set-pin / clear-pin / set-expiry);identity router 的對應 endpoint 保留為薄封裝。

4. **前端能力下沉** —— 分享 / iCal 區塊從 `/identities` 頁移到通用節點視圖:`NodePage`(`/n/:id`)與 `ContainerView`(`/c/:id`)依該節點型別的 `is_shareable` / `is_subscribable` 旗標**動態顯示**分享門面與 iCal 訂閱區塊。`IdentityChartsView` 泛化為「任何 container 的聚合視圖」。`/identities` 頁演進為「所有 shareable 門面」的跨型別聚合入口(identity + topic + 任何 shareable 混列),不再是 identity 獨佔。

**明確不做:**
- **不改分享 token 的簽章與安全模型** —— 只更換查找維度(type → capability),HMAC / PIN / 到期 / 稽核邏輯原封不動。
- **不把聚合分析做成獨立旗標** —— 複用 `is_container`,避免旗標增生。
- **不在本 ADR 移除或重寫 `/identities` 頁** —— 先讓能力通用化;頁面從獨佔演進為聚合入口是連帶結果,但不強制在同一批完成。
- **不新增資料庫列** —— 堅持用 `Node.data`,保持「自訂型別零 schema 改動」的性質。

## Consequences

**正面:**
- 使用者自訂型別(如 `topic`)可勾選 `is_shareable` / `is_subscribable` 即獲得對外門面與 iCal,與內建 `identity` 完全對稱 —— 補上 ADR-0033 哲學在跨切服務上的最後一塊缺口。
- identity 去特權化後,「內建 vs 自訂」不再有能力落差,心智模型一致:node 的能力由旗標決定,不由是否內建決定。
- 存儲零遷移、對外契約(舊分享/iCal 路由)零破壞,風險集中在服務層路由與前端條件渲染,可分步驗證。
- 前端分享/iCal UI 只寫一次(掛在通用節點視圖),新增 shareable 型別零前端改動,呼應 ADR-0037 的 registry 驅動渲染。

**負面 / 代價:**
- 服務層需引入「capability 解析」層:給定一個 token 或 node id,查其型別旗標決定可否分享/訂閱;需確保未勾選旗標的節點被正確拒絕(安全邊界)。
- 舊路由委派給通用實作,需回歸測試三條 iCal 路徑與兩條分享路徑,確保外部訂閱者無感。
- `IdentityChartsView` 泛化為 container 聚合有回歸風險(它在 Dashboard 也被複用),需以「identity 走舊聚合、其他 container 走泛化聚合」隔離驗證。
- capability 旗標增加(is_shareable / is_subscribable),`graph_types` 管理頁與 seed 邏輯需同步;需在 `NodeTypeCreate/Update` schema 與前端型別編輯 UI 露出。
- 若未來能力再增(如「可 webhook 通知的型別」),需警惕旗標無限增生;本 ADR 只引入兩個有明確既有需求的旗標,不預先抽象。
