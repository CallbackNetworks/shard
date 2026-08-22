# ADR-0109: 「誰在呼叫」只有一個答案，而信任多深是部署知識

## Status

Accepted

## Date

2026-08-22

## Context

有兩個地方以呼叫者的位址當作節流的 key，而它們對「呼叫者是誰」的答案不一樣 ——
更糟的是，各自錯在對方做對的方向。

**`routers/auth.py` 無條件相信 `X-Forwarded-For`，並取最左邊那一筆：**

```python
forwarded = request.headers.get("x-forwarded-for", "")
if forwarded:
    return forwarded.split(",")[0].strip()
```

最左邊那一筆是**呼叫者自己寫的**。攻擊者每次請求換一個值，就每次都拿到一個全新的
失敗計數桶，`AUTH_MAX_ATTEMPTS=5` / `AUTH_LOCKOUT_SECONDS=300` 的鎖定**永遠不會觸發**。
這把鎖是裝上去的，但沒有鎖上任何東西。

**`services/rate_limiter.py` 完全不看 header，只讀 socket：**

```python
client_ip = request.client.host if request.client else "unknown"
```

正式環境的 backend 前面永遠有 frontend 容器的 nginx，所以 `request.client.host` 就是
nginx。**所有訪客塌縮成同一個 key**，60 次/分鐘變成對全體訪客加總的限制 —— 一個人
瀏覽分享頁就能把其他所有人擋在門外。

真正的問題在於：**這個 header 沒辦法整體地信任或整體地不信任**。它有多少筆可信，
取決於這個 process 前面實際上站了幾層 proxy，而那是**部署知識，程式碼推論不出來**。
兩份實作各自挑了一個極端當作預設，於是兩邊都錯。

## Decision

**新增 `services/client_ip.py`，兩個呼叫端都用它；信任深度由 `TRUSTED_PROXY_HOPS` 宣告。**

每一層 proxy 會把「它收到的來源位址」附加到 `X-Forwarded-For` 尾端，所以**最右邊的
`hops` 筆是操作者控制的基礎設施寫的**，左邊全部是呼叫者可以捏造的。從右邊數進來
`hops` 格，就自然跨過所有偽造內容 —— 呼叫者塞再多假資料，只會把自己的真實位址往右推，
不會改變我們要讀的那個索引。

```python
chain = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
index = len(chain) - hops
```

三個刻意的取捨：

- **預設 `0`，也就是誰都不信、直接用 socket peer。** 沒有宣告的部署是安全的，
  而不是「設定對了才安全」。
- **鏈長度小於宣告的 hops 時退回 socket peer。** 這代表 header 被剝掉或設定值錯了。
  退回 socket 會讓所有人共用一個桶 —— 節流**太嚴**；相信一條過短的鏈則會讓呼叫者
  自己決定答案 —— 節流**太鬆**。錯要往嚴的方向錯。
- **`TRUSTED_PROXY_HOPS` 解析失敗或為負數時視為 0**，不是視為「全部相信」。

CD pipeline 生成的 compose 一定有 nginx 站在 backend 前面，所以部署時的預設值是 `1`；
若前面還有 CDN 則由操作者設成 `2`。同樣依上面的原則：猜低只是變嚴，猜高才會開洞。

## Consequences

**正面**

- 登入鎖定真的會鎖了。這是這份 ADR 最主要的目的。
- 分享頁限流變成每個訪客各自計算，而不是全站共用一個 60/min。
- 「呼叫者是誰」以後只有一個實作。`tests/test_client_ip.py` 最後一個測試直接斷言
  兩個模組 import 的是同一個函式，所以再長出第三份答案會失敗。

**負面 / 代價**

- **多了一個必須正確設定的部署變數。** 這是無法迴避的 —— 這個數字本來就只有操作者
  知道，先前的兩份實作只是各自假裝它是常數。設錯的後果被刻意壓在「太嚴」那一側，
  但設成 `0`（或漏設）而前面確實有 proxy 時，分享頁限流仍會是全站共用的行為。
- 節流狀態仍然是 per-process 的記憶體字典，重啟即清空，也不跨 worker 共享。
  本 ADR 不處理這件事 —— 它修的是 key 算錯，不是儲存位置。
- `AUTH_PROXY_HEADER`（ADR-0030 的 forward-auth）仍然是獨立的信任決定，
  兩者都在說「前面有一層可信的 proxy」但用途不同，沒有合併：一個決定身分，
  一個決定位址。
