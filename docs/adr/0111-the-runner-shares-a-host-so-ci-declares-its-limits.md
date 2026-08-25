# ADR-0111: Runner 跟別人共用主機，所以 CI 要自己宣告上限

## Status

Accepted

## Date

2026-08-24

## Context

`ci-builder-01` 跟開發 session、正式站的 `shard-backend`、以及大約二十個不相關的容器
(headscale、cloudflared、hermes、surrealdb…)共用同一台機器:**6 核 / 7.8 GiB RAM**。
量測時 swap 已經用掉 2.1 GiB,`/proc/vmstat` 顯示 **`oom_kill 17`**、
`pgmajfault` 五千六百萬次。

Run #412 的 frontend job 以 "JavaScript heap out of memory" 失敗,連帶 Publish 與 Deploy 被
skip,dashboard 那個功能明明合併乾淨卻沒上線。前一份調查(commit `06ba75a`)已經正確地
排除了「測試套件漏記憶體」:用**每個檔案一個全新 process**(前一個檔案的狀態完全不帶過去)
仍然撞同一面牆,而且撞的位置在不同 run 之間會漂移。結論是主機爭用,那個結論是對的。

後續量測補上了一個關鍵數字:**這個套件根本不大**。

| 情境 | 峰值 |
|---|---|
| 單一測試檔 | 222 MB |
| 25 個檔案 / 171 個測試,同一個 process,ceiling 1024 | 264 MB |
| 同上,ceiling 4096 | 258 MB |
| 後端全套 1774 個測試 | 597 MB |

兩件事同時成立:heap ceiling 調 1024 或 4096 **量不出差別**(V8 沒有往天花板長,
工作集就是小);而一個只要 260 MB 的 process 仍然被 OOM 殺掉。
**問題不在任何單一容器要多少,在於全部加起來超過主機能給的。**

而 act_runner 是透過 Docker socket 開**兄弟容器**,不是子容器 —— job 容器因此不受
`ci-builder-01` 那 4 GiB 限制,`HostConfig.Memory` 實際是 `0`,也就是整台主機。
在這種狀態下超量的請求不會失敗,而是**核心依 score 挑一個受害者**,而它挑中的
不必然是肇事者:可能是 `shard-backend`、`headscale`,或使用者自己的編輯 session。

同一次盤點還找到 run 436 與 440 的 postgres 容器**分別已經跑了 7 天和 6 天**。
`Cleanup` 有 `if: always()`,但 runner 本身被停掉時整個 step 不會執行 —— 所以重疊的 run
不只是同時消耗資源,還會漏掉資源不還。

## Decision

**四件事,都是「宣告」而不是「調校」。**

**1. 每個 CI service 宣告記憶體上限**(`docker-compose.ci.yml`,共用 anchor 2g;
`e2e` 單獨 3g,因為它驅動真的 Chromium)。`memswap_limit` 設成跟 `mem_limit` 相同,
不給 swap 餘裕 —— 會 thrash 的正是 swap。

上限**不是照需求量身訂做的**。2g 對量到的 597 MB 有 3.4 倍餘裕,正常工作永遠碰不到。
它是一個**帽子**:失控的那個容器在這裡被具名地殺掉,而不是讓核心去主機上另外挑一個。
這條的價值超出 CI 本身 —— 它保護的是同一台機器上其他不相關的東西。

**2. 同一個 ref 一次只跑一個 run**(`concurrency`)。436/440 那兩個孤兒證明了重疊確實發生。
但 `cancel-in-progress` 在 main 上是 **false**:已經開始替換正式容器的 run 不能被砍在
`up -d` 和健康檢查之間。其他 ref 才取消。

**3. 部署失敗會滾回上一版 image**(`if: failure()`)。在此之前,`up -d` 之後的每一個檢查
失敗都代表正式環境**當下就是掛的**,而 job 只是 `exit 1` 然後讓它一直掛到有人發現。
image 有 sha tag,上一版還在同一台主機上。上一版是**從執行中的容器讀出來的**,不是推算的,
所以即使前一次部署本身半途失敗,也會滾回真正在服務的那個。

**4. Migration 前對 `./data` 做快照**,保留最近 5 份。

## Consequences

**正面**

- 超量的容器在 Docker 這一層被具名終止,核心不再挑選受害者。正式站與其他服務不再
  因為 CI 忙碌而有被殺的風險。
- 重疊的 run 不再堆疊,也不再漏容器。
- 部署失敗不再等於「正式環境掛著直到有人發現」。

**負面 / 代價**

- **滾回 image 不會滾回 schema。** 這是刻意的:還原資料庫不是能無人值守做的事。
  如果新 revision 讓舊程式讀不了,滾回會成功但服務仍然壞 —— 所以那條路徑會明確印出
  快照位置並且**仍然以失敗結束**,不假裝已經復原。第 4 條存在就是為了這個情況。
- **上限是猜的,只是猜得有餘裕。** 真正需要超過 2g 的工作(未來某個更重的測試)
  會撞到帽子而不是變慢。撞到時訊息是明確的 OOMKilled,比隨機受害好判讀,但仍然要有人改。
- **`concurrency` 讓 main 上連續的 push 排隊而不是平行。** 這正是目的,但也代表
  第二次 push 的回饋會晚一個完整 pipeline 的時間。
- 每次部署的快照佔磁碟。保留 5 份是在「夠回頭」與「小主機塞不下」之間選的。
