# ADR-0103: openai 變成真的依賴，而且 get_provider 不能讓請求整個炸掉

## Status

Accepted

## Date

2026-08-18

## Context

使用者在 prod 上把 provider 設成 openai、base_url 填 opencode.ai 的 zen gateway、model 填 `deepseek-v4-flash`,存檔沒問題,一送訊息就失敗。查下去是兩件事疊在一起:

第一,`openai` 這個 Python 套件從 ADR-0096 開始就是刻意不裝的——當時的理由是它只服務 `provider="openai"` 這一種選擇,裝與不裝該由部署者決定。這個假設在那個時間點是對的:選 provider 的唯一方式是改環境變數再重新部署,做這件事的人自然也會記得把套件加進 `requirements.txt`。ADR-0096/0097 把這個選擇搬進 Settings 頁的下拉選單之後,這個假設就不成立了——UI 上完全沒有任何提示告訴你「選這個之前要先確認套件有沒有裝」,而 `openai` 協定又是 Cloudflare AI Gateway、opencode 這類第三方閘道最常見的介面(ADR-0097 整篇的重點就是鼓勵大家透過 `base_url` 接這些服務)。

第二,而且更根本:`get_provider(db)` 在 `routers/assistant.py` 和 `routers/share.py` 兩邊都是在 SSE 迴圈的 `try/except` **之前**呼叫的:
```python
provider = get_provider(db)      # 這裡丟出的例外，兩邊都接不到

async def event_stream():
    try:
        async for event in provider.chat(...):   # 只有這裡面的錯誤會變成優雅的 SSE error
            ...
    except Exception as exc:
        yield {"type": "error", ...}
```
`ClaudeProvider`/`OpenAIProvider` 的建構子在套件沒裝時丟 `RuntimeError`,這個例外在兩個路由裡都沒有任何東西接,直接變成一個沒人處理的 500——不是 Settings 頁存檔會看到的那種「無法驗證這個 model」的溫和提示,是送訊息當下整個請求垮掉。這個結構在 ADR-0096 之前就存在,只是在那之前唯一能把 provider 設成一個套件不存在的值的人,是手動改環境變數的部署者——現在變成任何打開 Settings 頁的人都碰得到。

## Decision

**`openai` 從 `requirements.txt` 拿掉「opt-in」的身分,變成真的依賴。** `anthropic` 保持原狀不裝——原因同上,openai 協定涵蓋的第三方閘道遠多於 Anthropic 協定,而且這次修完 `get_provider` 之後,就算 anthropic 沒裝也只是優雅地報錯,不再是壞掉的狀態。

**`get_provider(db)` 保證不丟例外。** 把 `ClaudeProvider`/`OpenAIProvider` 的建構包進 `try/except RuntimeError`,接到的話回傳一個帶著真正原因的 `StubProvider`——`StubProvider` 加了一個 `message` 參數,「沒設定」和「套件沒裝」share 同一個機制,只是文字不一樣。這樣兩個路由**完全不用改**:它們本來就有處理 `StubProvider` 這種「回報設定問題而不是回答」的 SSE error 路徑,只是原本沒機會走到,因為例外根本沒進得了那段 `try`。修正的位置只有一個函式,不是兩個路由各修一次。

## Consequences

正面:opencode.ai/zen、Cloudflare AI Gateway 這類 openai 協定端點現在真的能用了,不用先手動裝套件。任何一種「provider 設定了但底層套件缺失」的狀況,不管是 openai 還是 anthropic,現在都是同一種優雅失敗,不會讓整個請求 500。

負面與代價:image 變大了一些(`openai` SDK 本身的體積),這是刻意接受的——比起「選單上一個選項選了會讓伺服器吐 500」,這個代價微不足道。`anthropic` 依然是 opt-in,選 `provider="claude"` 沒裝的話一樣會遇到同樣的訊息,只是現在那個訊息是優雅的、不是一次當機——這是刻意留著的不對稱,不是漏掉的另一半。
