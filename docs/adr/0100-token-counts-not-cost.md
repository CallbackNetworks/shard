# ADR-0100: 記錄 token 用量,不記錄花費

## Status

Accepted

## Date

2026-08-18

## Context

助理每問一句都是真的在打 Claude/OpenAI 的 API,但整個系統對這件事完全沒有記錄——查過之後發現不是刻意的取捨,是兩個提供者的 SDK 呼叫方式各自有一個小缺口:

- **Claude**:`ClaudeProvider.chat()` 早就呼叫了 `stream.get_final_message()`,那個回傳值本來就帶 `.usage.input_tokens`/`.output_tokens`,程式碼只是從來沒有讀它。
- **OpenAI**:串流呼叫沒有帶 `stream_options={"include_usage": True}`,所以 usage 資料根本不會出現在任何一個 chunk 裡——不是被丟掉,是從來沒有被要求送。而且原本的迴圈在 `finish_reason` 出現時就 `break`,就算之後加了這個參數,usage 那個額外的 chunk(`choices` 是空的,排在 `finish_reason` 那個 chunk 之後)也會被跳過。

`AssistantMessage`/`ShareChatLog` 都沒有存放用量的欄位;整個 repo 也沒有任何一張定價表——`services/rate_limiter.py` 的註解提過一句「LLM 呼叫要花錢」,僅止於此。

## Decision

**只記 token 數,不換算成錢。** 這台服務沒有,也不打算維護一份 $/token 對照表——不同 provider、不同型號的價格會變,硬換算出來的數字只會在某次調價後悄悄失真,而使用者不會知道。`services/llm_settings.py` 新增 `usage_summary(db, days=30)`,把 `AssistantMessage`(owner 自己的對話)跟 `ShareChatLog`(公開助理的問答,ADR-0098)兩張表的 `input_tokens`/`output_tokens` 加總——兩邊燒的是同一組設定好的 provider,分開看意義不大。缺這欄位的舊資料列(或 `StubProvider` 從來不回 usage)一律當 0 累加,不是錯誤。

`LLMProvider.chat()` 的事件協定加一種 `{"type": "usage", "input_tokens": n, "output_tokens": n}`,在 `"done"` 之前送出、不保證每次都送(`StubProvider` 永遠不送)。兩個串流迴圈(`routers/assistant.py`、`routers/share.py`)接住這個事件存到當次的訊息/紀錄列上——**這個事件不會轉發到前端的 SSE**,純粹是後端記帳,不是對話的一部分。`AssistantMessage`/`ShareChatLog` 新增 `input_tokens`/`output_tokens`(nullable Integer):`null` 代表「沒回報」,不是「這次免費」——兩者混在一起會讓沒接到 usage 的舊資料被誤讀成真的沒有花費。

前端只在 Settings 頁的助理卡片加一行唯讀文字(近 30 天輸入/輸出 token 數),不開新頁面、不畫圖表、不拆到每一則對話——這台工具是個人規模,細到那個程度之前不必先蓋。

## Consequences

正面:知道助理這個月大概燒了多少 token,不用去 provider 的後台自己查。修 OpenAI 那個迴圈的 `break` 同時也是一個真的存在的小缺陷:就算以後想加別的 usage 相關資訊,原本的寫法本來就拿不到那個 chunk。

負面與代價:數字是 token 數,不是錢——想知道實際花費還是要自己乘上目前的定價,而且价格之後可能會不一樣。彙總只到「全站近 30 天」這個粒度,想知道某一次特定對話花了多少 token,現在的實作看不到(`AssistantMessage`/`ShareChatLog` 的欄位其實有記,只是沒有介面秀出來)。
