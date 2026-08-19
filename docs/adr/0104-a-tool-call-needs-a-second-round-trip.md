# ADR-0104: 工具叫完了，還要再打一次才輪得到文字回答

## Status

Accepted

## Date

2026-08-19

## Context

使用者在 prod 上把 provider 換成真的 openai 協定端點(opencode.ai 的 zen gateway、`deepseek-v4-flash`)之後回報:「發出問題沒有回應」。ADR-0103 已經修過一次「套件沒裝會整個 500」，這次部署確認成功、設定也確認正確存進去了，但問題還在——而且是不同的症狀:不是錯誤，是徹底的沉默。

用使用者親自給的臨時 API key,直接照 `OpenAIProvider.chat()` 的邏輯打真正的 gateway 重現,帶上內建 assistant 真正會送出去的 37 個工具 schema、問一句「今天有什麼任務」等級的問題。回應是:

```
finish_reason: tool_calls
content total chars: 0
```

模型正確選了要呼叫某個工具(例如 `list_tasks`),但 `routers/assistant.py` 的 `event_stream()` 從一開始就只呼叫一次 `provider.chat(...)`——工具的呼叫請求一出現,對這個 provider 而言這一輪的回應就結束了(不管是 OpenAI 的 `finish_reason: "tool_calls"` 還是 Claude 的 `stop_reason: "tool_use"`,都代表「模型在等工具的結果，這一輪沒有更多文字了」，這是兩邊協定的共同行為,不是某個 gateway 特有的怪癖)。程式碼執行完 `dispatch_tool`、把 `tool_result` 用 SSE 送給前端之後,直接進 `done`——從來沒有把工具的結果餵回去、再打一次 API 讓模型讀了結果之後說點什麼。只要使用者的問題會讓模型判斷需要呼叫任何一個工具(而 assistant 每次都帶著全部 37 個工具的 schema,判斷會呼叫工具的機率並不低),使用者看到的就是:工具真的執行了、資料庫真的被讀了甚至寫了,但畫面上什麼都沒有。

這個結構性缺口從 assistant 這支功能第一次寫出來就存在,跟這次 ADR-0096~0103 那一串 LLM 設定的改動完全無關——只是先前唯一被拿來驗證這個迴圈的,是 `tests/test_assistant_router.py` 裡那個手寫的假 provider,它在同一輪裡同時吐出 `tool_call` 又吐出 `text`,這種行為真正的 API 不會發生,所以測試一路綠燈,卻從沒測到「工具叫完之後真的要再問模型一次」這件事。公開分享頁的問答助理(`routers/share.py`)不受影響——它送出去的 `tools` 永遠是空陣列,模型沒有工具可選,只能直接回文字。

## Decision

**`event_stream()` 從打一次 `provider.chat()` 改成一個有上限的多輪迴圈。** 每一輪:把這一輪的事件都跑完(文字照樣即時用 SSE 送出去、工具照樣立刻執行並把 `tool_result` 送出去);如果這一輪裡出現過任何 `tool_call`,就把「呼叫了什麼工具」、「工具回傳了什麼」接成兩則訊息、追加進這次對話的訊息陣列,再開下一輪;如果這一輪完全沒有 `tool_call`,代表模型已經給出最終答案，迴圈結束。上限訂在 `MAX_TOOL_ROUNDS = 8`——防的是模型(或哪個工具本身)卡在一直呼叫工具、從不收尾的情況；真的撞到上限,不是靜靜地用最後一次 `tool_result` 交差,而是明確送出一個 error 事件說「叫了太多次工具」。

工具結果餵回去的形式選了最省事的一種:直接接成 `{"role": "assistant", "content": "[Calling tool X]"}` + `{"role": "user", "content": "[Result of X]: ..."}` 這種純文字的一問一答，不是 OpenAI/Claude 原生的 `tool_result` content block。理由是 `messages` 這個介面本來就是 provider 抽象層唯一認得的形狀(純 `role`/`content`),而且 conversation 重新載入時，資料庫裡存的 `role="tool"` 訊息也是被拉平成 `"user"` 角色的文字——用同一種「工具結果就是一段文字」的慣例，而不是另外教兩個 provider 各自的原生工具結果格式，改動只留在路由層一個函式裡。

token 用量從「單次呼叫的 usage」改成「跨輪加總」——每一輪都是一次完整的 API 呼叫，各自有自己的 input/output tokens，使用者一次提問底下真正花掉的量是所有輪次的總和，不是只算最後一輪。

## Consequences

正面:任何一個會讓模型選擇呼叫工具的問題，現在都會完整跑完「呼叫工具 → 讀結果 → 給出文字回答」的流程，不再是叫了工具就沉默。已經用使用者提供的真實 gateway + 真實 key 端到端驗證過:同一句提問，修復前是空白，修復後是完整跑了 `get_summary`→`analyze_workload`→多次 `list_tasks`、最後給出一段有條理的摘要文字。

負面與代價:一次提問現在可能對應到最多 8 次真正的 API 呼叫，多輪串行的延遲跟 token 用量都會比原本高——但原本的「原本」是使用者根本拿不到答案，這個代價不是新增的成本，是原本就該花、只是沒花到的成本。工具結果用純文字接回去，模型收到的不是它原生協定期待的那種結構化區塊，理論上準確度會比原生格式略差一點，但這是「有結構但簡單」跟「無限期新增一種 provider 特有格式」之間刻意選的那一邊。`MAX_TOOL_ROUNDS` 撞到上限時使用者一樣拿不到答案，只是現在至少會看到一則明確的錯誤，而不是無聲的沉默——這個邊界情況被保留、沒有進一步處理，因為它代表的是模型或工具本身壞掉，不是這次要修的「正常情況下也沉默」。
