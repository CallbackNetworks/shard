# ADR-0110: 重播防護不能由寄件方決定要不要開

## Status

Accepted

## Date

2026-08-24

## Context

ADR-0060 讓簽章成為必要:沒有 secret 就不接受寫入。簽章那一層是對的。
但它上面的重播防護是裝飾:

```python
ts_str = h.get("x-webhook-timestamp", "")
if not ts_str:
    return True          # 沒有 header 就跳過檢查
...
except (ValueError, TypeError):
    return True          # 格式錯誤也跳過檢查
```

**攻擊者控制檢查跑不跑。** 攔截到一個簽好章的請求之後,把 timestamp header 拿掉
(或塞一個 `x`)重送,就繞過了。而 `/webhook/callback/{token}` 是無認證端點且會驅動
任務狀態 —— 重播一個 `{"status": "done"}` 就能把任務標成完成。

直覺的修法是「讓 timestamp 變成必要」。**這個修法會炸掉所有真實整合。**
GitHub、GitLab、Jenkins、Drone、Bitbucket 沒有一家送 `X-Webhook-Timestamp`;
那是我們自己定的 header。要求它等於拒絕每一個實際在用的 CI provider。

第二個直覺是加一個 `WEBHOOK_REQUIRE_TIMESTAMP` 開關讓操作者自己開。但這正是
ADR-0060 修掉的那個形狀 —— 一把需要人主動打開的鎖,就是一把沒有人打開的鎖。

## Decision

**用簽章本身去重,因為簽章是 body 綁定的。**

重播的定義就是「一模一樣的 bytes 再送一次」。而 HMAC 簽章涵蓋 body,所以
**重播必然帶著一模一樣的簽章**。把它存下來、在時間窗內比對,就得到一個
**寄件方完全不需要配合**的重播防護 —— GitHub 照樣不用送 timestamp。

`webhook_events` 增加 `signature_digest`(簽章的 SHA-256)。存 digest 不存簽章本身:
簽章是從 secret 推導出來的,而投遞紀錄已經被證實是憑證外洩的路徑一次(ADR-0085)。

四個邊界條件是這個設計成立的關鍵,各自都有測試:

1. **GitLab 的 plain token 不參與去重。** 它不隨 body 變化,每次請求都一樣 ——
   拿它去重會讓第一次之後的每個 callback 都被拒。`_verify_signature` 因此回傳
   `(accepted, replay_key)`,只有 body 綁定的方案才給 key。
2. **失敗的投遞不留紀錄。** event row 跟其他工作在同一個 transaction 裡提交,
   所以處理失敗時沒有 row —— provider 的重試照樣會被接受。這是 CI 的正常行為,
   不能當成重播。
3. **時間窗有界**(`MAX_TIMESTAMP_AGE_SECONDS`,5 分鐘)。provider 過一小時後
   合法地重送同一個 payload 不該被永久拒絕;而且查詢只掃索引的窄範圍。
   五分鐘內的兩個相同簽章 body,跟重播無法區分,當成同一件事是比較安全的讀法。
4. **既有的 row 是 NULL,永遠不匹配。** 缺席不能看起來像重複。

順帶修掉 timestamp 檢查本身:**格式錯誤現在會拒絕,不是跳過**。
沒有任何合法寄件方會送 `X-Webhook-Timestamp: x`,而讓它通過等於把檢查交給呼叫者決定。
header 缺席仍然放行 —— 那是真實 provider 的常態,理由見上。

## Consequences

**正面**

- 重播防護對每一個簽 body 的 provider 都生效(GitHub、以及我們自己的 generic HMAC),
  不需要寄件方做任何改動,也不需要操作者打開任何開關。
- 回應 409 而不是 401:重複投遞跟簽章錯誤是不同的事,呼叫者分得出來。
- 多一個索引查詢的成本,落在 `(task_id, signature_digest, created_at)` 上。

**負面 / 代價**

- **GitLab 的 plain-token 整合沒有重播防護。** 它的認證方式本身就沒有 body 綁定,
  沒有東西可以去重。這不是本 ADR 造成的,但本 ADR 也沒有解決它 ——
  要解決得換成 GitLab 也支援的 HMAC 模式,那是使用者的設定選擇。
- **五分鐘內合法的重複 payload 會被當成重播拒絕。** 例如同一個 job 在極短時間內
  推兩次完全相同的狀態。實務上罕見,而且兩者確實無法區分;選擇拒絕是刻意的。
- `signature_digest` 是可為 NULL 的欄位,所以「這筆有沒有受重播保護」需要看它是不是
  NULL 才知道 —— 不是一個能從 schema 一眼看出來的性質。
