# ADR-0151: 入門導覽不能擋住它底下的 app

## Status
Accepted

## Date
2026-09-04

## Context

ADR-0148 做了首次造訪的導覽。它的「看過了」是一個**伺服器端偏好**，理由很好：同一個帳號換一台機器不該再被走一次流程。

整合測試每次都跑在一個剛建起來的 prod stack 上，資料庫是空的。**所以每一次 CI 都是「首次造訪」**：導覽在 `/` 打開，它的 scrim 蓋在整頁上，於是每一個 `locator.click()` 都超時：

```
<div class="_scrim_1x03t_14"></div> from
<div role="dialog" aria-modal="true" aria-label="Guided tour"> subtree
intercepts pointer events
```

從 run 486（`78ef953`，導覽上線那一個 commit）起，`Integration smoke test (prod)` 連續紅了三次：**4 failed / 16 passed**，四個都是同一個原因（project-detail 一個、notifications 兩個、mobile sidebar 一個）。沒有人動過那四個測試，它們測的東西也都還在，只是點不到。

值得記下來的不是修法，是**這個缺陷的形狀**：導覽本身完全正常，unit test 全綠，它宣稱要做的事都做到了。壞掉的是「它底下那個 app 還能不能用」——而那件事沒有任何一層在測。E2E 本來是唯一會發現的地方，結果它就是被打倒的那一層。

## Decision

`e2e/global-setup.ts` 在任何 spec 跑之前，用 API 把 `tour-state` 偏好設成 `seen`。

選這個而不是在每個 `beforeEach` 裡點「Skip」：

- 那**就是**回訪使用者的真實狀態，不是一個為了測試而存在的旁路。
- 整套測試一個 request，而不是每個測試一次互動。
- 它自己不會因為 overlay 的進場動畫而 flaky——用點擊去關掉一個會擋住點擊的東西，是把同一個競態搬進修法裡。

**明確放棄的覆蓋範圍：首次造訪。** 一個斷言導覽會打開的 spec，必須翻動同一個全域偏好，而 Playwright 是**檔案層級平行**執行的，所以它會跟其他每一個檔案搶——正好製造出它想預防的那個失敗。導覽自己的邏輯有 unit test（`src/components/tour/__tests__`）；沒有被任何一層覆蓋的是「overlay 不會癱瘓它底下的 app」，也就是真正發生的那個缺陷。

## Consequences

- 整合測試回到綠燈：本機用 CI 的環境重跑（隔離的 `COMPOSE_PROJECT_NAME`、prod images、無 `API_KEY`）得到 **20 passed / 1 skipped**，形狀與 CI 一致。
- **真正的修法沒有做，而且要說清楚**：導覽仍然是一個全頁的點擊黑洞。要讓「首次造訪」重新可測，導覽得先不是這種東西——scrim 只圍住被聚光的元素、或者根本不攔截 pointer events。在那之前，這裡設一個偏好只是讓其他 20 個測試能跑，不是解決了問題。
- 一個新的 E2E spec 若要斷言任何首次造訪的行為，會在這個 global setup 底下靜默地測到錯的狀態。這是這份決策要付的租金。
