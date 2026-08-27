# ADR-0116: CI 開跑前先收回前幾次跑漏掉的東西

## Status
Accepted

## Date
2026-08-27

## Context

推上去的兩個 commit 都沒有部署。回頭查才發現 **CI 從五個 commit 之前（`a40508f`）就每一次
全掛**，四個檢查 job 全部 failure、publish 與 deploy 全部 skipped，而且掛的原因跟那些
commit 改了什麼完全無關：

```
failed to create network ci-backend-checks-497_ci-network:
  all predefined address pools have been fully subnetted
```

主機沒有 `/etc/docker/daemon.json`，用 Docker 內建的位址池，大約 31 個 bridge network。
當時主機上有 30 個，其中 10 個是 Shard CI 漏掉的 —— 而且 runs 478/480/482/483 那四個底下
各還掛著一個**已經跑了 39 到 45 小時的 `postgres:16-alpine` 孤兒容器**，所以那四個 network
連 `docker network prune` 都清不掉。

`ci.yml` 的開頭註解早就記過同一件事：「runs 436 和 440 的孤兒 postgres 七天後還活著 ——
runner 自己被停掉時，一個被取消的 run 的 `if: always()` 清理不會執行」。當時的處置是加
concurrency group 減少重疊。**那降低了洩漏的頻率，沒有處理洩漏本身**，於是它累積到把位址池
用完為止。

這個失敗模式最難的地方在於它不指向自己：訊息講的是 subnet，沒有一個字提到 CI、容器或洩漏，
而且它發生在 checkout 之後、任何一個測試之前，所以每一份 job log 的結尾都只是
`Job failed`。要看到那一行，得去 grep log 的中段。

## Decision

**一個 `preflight` job，四個檢查 job 都 `needs` 它**，在任何人跟 Docker 要網路之前，
把前幾次跑留下的 `ci-*` 容器與 network 收回來。

三件事是刻意的：

- **它是一個 job，不是重複四次的 step。** 四個檢查 job 是平行起跑的，把掃除放進其中一個，
  等它跑到的時候另外三個早就已經要不到網路了。
- **所有動作都以時間為界（3 小時）。** 這些 job 以分鐘計，不以小時計，所以一次掃除不可能
  掃到還在跑的 run。runner 自己叫 `ci-builder-01`，名字也吃 `^ci-`，所以另外明確跳過。
- **network 逐個具名刪，不用 `docker network prune`。** 這台主機還跑著十幾個不相干的 stack，
  它們閒置的 network 不是這個 workflow 該回收的東西。

沒有改 Docker 的 `default-address-pools`。那是根治，但要重啟 docker daemon，等於重啟這台
主機上每一個容器 —— 為了一個有辦法在 workflow 內解決的問題，代價不成比例。

## Consequences

- 一次洩漏不再累積成下一次的失敗。位址池被吃完之前，`ci-*` 的殘骸最多活 3 小時。
- 每次 run 多一個 job 的啟動成本（不需要 checkout，約數十秒），四個檢查 job 因此改成序列在
  它後面起跑，而不是立刻平行。在一台 6 CPU 的共用主機上，這本來也不是壞事。
- 掃除只認 `ci-` 前綴。用別的前綴命名的 compose 專案漏掉的話，這個 job 看不到 —— 這是為了
  不去碰別人的東西付的代價，寫在這裡是為了下次有人問「為什麼它沒清到」。
- 這次的積壓是手動清掉的（停掉 4 個孤兒容器、移除 10 個 network，33 → 22）。這個 job 是為了
  不必再手動清一次。
