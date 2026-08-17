# ADR-0094: 每個節點都說得出自己住在哪

## Status

Accepted

## Date

2026-08-17

## Context

使用者的原話是「前端界面很難看出 item 之間的關係」。把 production 整張圖拉下來（`GET /api/v1/graph/map`，89 nodes / 102 edges）之後，問題不在資料：

- 層級實際上有五層：`organization(3) → identity(3) → project(38) → task → subtask`
- 邊幾乎全是 `contains`（100 條），`depends_on` 只有 **1** 條、`owns` 1 條
- **16 個節點有兩個父節點** —— 子任務同時掛在專案和母任務底下、專案同時屬於兩個 identity

資料一直都在。畫面沒有一個地方畫它：

1. **沒有任何祖先資訊。** 專案頁不說這個專案屬於誰，identity 唯一到得了畫面的形式是一個顏色（`ProjectDetail.jsx` 和 `ProjectCard.jsx` 都只取 `identities?.[0]?.color`）。38 張專案卡因此是一面平牆。更糟的是 `identities` 是從 `owns` 算出來的，而 production 的歸屬幾乎都寫成 `contains` —— 那個 fallback 在真實資料上**幾乎不會觸發**。
2. **看板／時間軸／行事曆直接把子任務濾掉**（`parent_id == null`）。`n8n` 專案的十件事全部掛在一個母任務底下：看板上只有一張卡，其中六件已完成的工作在畫面上不存在。切到表格又整份攤平成十一列，看不出誰是誰的子項 —— **同一份清單在兩個分頁是兩種意思，兩邊都沒有畫出關係。**
3. **關係只在 `/n/{id}` 和 `/structure` 看得到**，而那是另外的目的地。`nodeHref` 還會把 project 導去 `/projects/{id}`，那頁一條 edge 都不顯示。
4. `depends_on` 只有一條，不是沒有依賴，是要展開單列面板才建得起來。**沒有畫面呈現的關係就不會被建立。**

## Decision

**祖先是伺服器算的，一個 endpoint，兩道門。** `services/ancestry.py` 沿 `contains` 往上走出 `trails`（root 在前、直接父節點在後，父節點有幾個就有幾條 trail），`owns` 的來源另外放進 `owners`。**兩個軸永遠不合併（ADR-0078）**：把 owner 接在 trail 尾巴上，它就會讀起來像多一層 containment，而那正是這兩個關係存在的目的要避免的事。

**這個 endpoint 是批次的**：`GET /graph/ancestry?ids=a,b,c`。呼叫端本來就是清單 —— 首頁要問它即將畫出的每一張卡。一個節點一個請求會讓首頁的問題變成 38 個請求，而那就是一個頁面最後乾脆不問的原因。內部 `/api` 與 `/api/v1`（`read` scope，專案範圍的 key 看不到自己專案之外的祖先名字）共用同一個 service，MCP 有 `get_ancestry`。

**子任務不再消失。** 看板、時間軸、行事曆都畫子任務；`utils/taskTree.js` 是唯一一份「誰在誰底下」的答案，親子關係在**可見集合內**解析（和 ADR-0069 的容器森林同一條規則）：被篩掉的母任務不會把子任務一起帶走，子任務升級成頂層。光是顯示還不夠 —— 沒有歸屬的卡片會讀成十件無關的事，所以卡片、表格列、被搜尋拆出來的 IssueRow 都會說出自己隸屬於誰。

**首頁按「誰的」分組。** `utils/projectGroups.js` 決定分組鍵：最近的 `contains` 父節點；沒有父節點時才退回 `owns` 的 identity。**一張卡只會出現在一個標題底下** —— 否則首頁的數字會和專案清單的數字對不上，而這正是 ADR-0068 在防的東西。只有一組時不畫標題。

篩選列的計數改成跟著**當前檢視實際畫出的那一組**：Issues 分頁把子任務收在母任務底下，其他分頁一列一個，同一組數字會讓篩選列寫 6、旁邊的看板放 10 張卡。

## Consequences

**好的：**

- 專案頁、容器頁、節點頁都有同一條祖先列（`AncestryTrail`），一份實作。多重父節點就畫多條，這是產品從 ADR-0032 起就允許、卻從沒畫過的形狀。
- 首頁第一次說得出「這是誰的專案」。identity 不再只是一個顏色。
- 一個 agent 可以問「這個節點住在哪」了；在此之前它只能自己爬 `/nodes/{id}/edges` 反推。
- 看板欄位的計數會變大（子任務現在算進去）。這是刻意的：ADR-0068 把**尺寸**釘在頂層任務，清單一向有自己的政策（v1 `summary` 也一直把子任務列為可做的工作）。

**代價：**

- 首頁多一個請求。批次、`staleTime: 60000`，換掉的是「一張卡一個請求」的替代方案。
- 祖先走訪有上限（`MAX_TRAILS=8`、`MAX_DEPTH=16`、一次最多 200 個 id）。超過時 `truncated` 為真，客戶端不會把半條 trail 當成完整的一條。
- 篩選列的數字會隨分頁改變。它描述的是眼前那份清單 —— 一個永遠對得上畫面的數字，比一個在某些分頁對不上的固定數字好。

**這次沒有動、但被這次調查照出來的事：** production 裡 `identity → project` 的 `contains` 邊，用今天的規則**建不出來** —— identity 宣告了 `shareable`/`subscribable` 卻沒有 `container` 角色，`_accepts_endpoints` 會擋掉（ADR-0078）。那些邊比規則早存在。Focus 一直在讀它們（`reachable_project_ids` 同時走 `contains` 和 `owns`），所以功能沒壞，但「使用者實際的歸屬結構是一種現在建不出來的邊」是一個真實的不一致。要嘛 identity 該拿到 `container` 角色，要嘛那些邊該搬成 `owns` —— 兩個都是資料層的決定，不該夾在一個讓關係看得見的改動裡。
