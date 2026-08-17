# ADR-0097: provider 選的是協定,vendor 是 base_url 決定的

## Status

Accepted

## Date

2026-08-17

## Context

ADR-0096 把 `provider`/`model`/`api_key` 搬進資料庫,可以在 Settings 頁不重啟就換。換完之後馬上冒出下一個問題:`provider` 只認 `claude`/`openai`/`stub` 三個字,使用者想接的是 Cloudflare AI Gateway、opencode go 這類服務——這些不是官方 Anthropic/OpenAI 端點,但幾乎都是講同一套 OpenAI 相容的 `/v1/chat/completions` 協定,只是換一個 base URL(這正是 LangChain、LiteLLM 這類工具接第三方 gateway 的標準做法)。把每一個這樣的服務都變成一個新的 `provider` 選項,長出來的會是一長串其實只在呼叫哪個網址上不同的重複實作。

另一個獨立冒出來的問題:`model` 是一個自由文字欄位,存的時候完全不檢查。打錯字照樣 `200`,只有下一次真的傳訊息給助理、實際打那個 provider 的 API 時才會發現——而且錯誤只會顯示在聊天視窗裡,不會回頭告訴你 Settings 頁那個值是錯的。

## Decision

**`provider` 選的是協定形狀,不是廠商。** 目前程式碼認得兩種 SDK 形狀——Anthropic Messages API(`ClaudeProvider`)和 OpenAI Chat Completions API(`OpenAIProvider`)——`provider` 三選一的範圍不變。新增 `base_url` 欄位,兩個 provider class 的建構子都吃這個參數,直接轉給對應 SDK 的 client(兩套官方 SDK 本來就支援自訂 `base_url`,這是它們原生設計用來接反向代理/相容端點的路徑)。任何講 OpenAI 協定的服務——Cloudflare AI Gateway、opencode go、自架的相容 gateway——都是 `provider="openai"` 加上它自己的 `base_url`,不必為每一個服務多寫一個 provider class。`base_url` 和 `provider`/`model`/`api_key` 共用同一條「資料庫覆寫值 `or` 環境變數預設值」規則,`""` 一樣代表清掉覆寫、退回環境變數(新增 `LLM_BASE_URL`)。它不是憑證——`api_key` 讀出來是遮住的布林,`base_url` 就是純網址,直接照原樣讀寫(ADR-0063 那條規則管的是密鑰,不是端點)。

**model 名稱在存檔時盡力驗證一次,驗證不到不擋存檔。** `update()` 只要這次寫入裡有 `model`,就會拿當下生效的 provider/api_key/base_url 去打該 provider 自己的 `/models` 列表,比對名稱在不在裡面,回傳 `model_check: {checked, ok, detail}`。這個判斷刻意不是 422:模型清單是**外部世界的事實**,不是請求本身的自我矛盾——同一個判準 ADR-0055 用過一次(觸發事件的條件問了觸發事件永遠不會提供的東西才是 422,世界可能改變的事實只是警告)。三個會讓 `checked` 變成 `False`(不是「這個名字錯了」,是「沒辦法確認」)的情況都合理存在,且不能是硬性拒絕的理由:

- `anthropic`/`openai` 這兩個 Python 套件**預設沒裝**(ADR-0096 就寫了,是 opt-in 依賴,要用才加進 `requirements.txt`)——這台機器上這是最常見的狀況。
- 有些相容 gateway 根本沒實作 `/models`。
- 單純網路問題、金鑰打錯導致 401,都不代表 model 名字本身錯。

`_verify_model()` 因此包一層寬鬆的 `except Exception`——這是刻意選的寬鬆度,任何失敗都退化成「無法確認」,不會讓存檔跟著失敗。前端在 Model 欄位下面顯示這個結果:綠色打勾(`ok: true`)、琥珀色警告帶著 provider 回的錯誤文字(`ok: false`)、或者安靜的灰字說明(`checked: false` 且有 `detail`,例如套件沒裝);`checked: false` 且 `detail` 是 `null`(還沒填 api_key,或選了 stub)就什麼都不顯示——這不是一個值得使用者操心的狀態。

## Consequences

正面:接 Cloudflare AI Gateway、opencode go 或任何其他 OpenAI 相容端點,現在是填兩個欄位(provider 選 openai、base_url 填網址),不需要改程式碼。打錯的 model 名稱,如果 SDK 有裝、provider 有實作 `/models`,存檔當下就會被指出來,不用等到真的傳訊息才發現。

負面與代價:`provider` 依然只有兩種協定形狀——真的出現第三種協定(不是 Anthropic 也不是 OpenAI 的形狀)還是要寫一個新的 provider class,`base_url` 解決的是「同協定、不同廠商」,不是「任意協定」。這次驗證的網路呼叫發生在 `PUT /settings/llm` 這個請求的同步路徑裡,一次存檔可能因此多等一個外部 API 的來回;因為只在 `model` 出現在這次寫入時才觸發,平常改 provider/base_url 不會多這一次呼叫。`model_check` 不會被記住——它是這次回應才有的資訊,不是效狀態的一部分,GET 讀不到上次驗證的結果。
