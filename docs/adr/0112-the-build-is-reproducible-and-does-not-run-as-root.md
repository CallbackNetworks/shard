# ADR-0112: 建置要可重現，而且不以 root 執行

## Status

Accepted

## Date

2026-08-25

## Context

`backend/requirements.txt` 把 15 個直接相依**全部精確釘版** —— 這件事做得比多數專案好。
但它對那 15 個套件**自己拉進來的東西**一個字都沒說，而 `uv pip install -r requirements.txt`
每次 build 都會重新解析它們。

三個後果：

- **同一個 commit 的兩次 build 可能裝到不同的程式碼。** FastAPI 一個套件就會帶進
  starlette、pydantic、pydantic-core、anyio、typing-extensions，沒有一個是釘住的。
- **`pip-audit` 稽核的集合，可能不是正式 image 實際裝的那一組。** CI 那次 build 和
  publish 那次 build 之間，上游發過一個版本就足夠。
- 出事時無法回頭確認「當時到底裝了什麼」。

同時，`ghcr.io/astral-sh/uv:latest` 是整個建置裡**唯一的浮動 tag**，而它正好落在
「安裝你所有相依」的那一層 —— 最值得可重現的地方。

另外，四個 Dockerfile 沒有任何 `USER` 指令，uvicorn 以 root 執行。這台主機同時跑著
CI runner、開發 session 和約二十個不相關的容器（ADR-0111），一個以 root 執行且掛著
host 目錄的容器，出錯時的破壞半徑不必要地大。

## Decision

**三件事一起做，因為它們是同一個問題的三個面向：build 出來的東西是什麼、以及它以什麼身分執行。**

**1. 加入 `requirements.lock`。** 由 `uv pip compile --generate-hashes` 產生，
1580 行、每個套件帶 hash。兩個 Dockerfile 都改成 `uv pip install -r requirements.lock`。
`requirements.txt` 仍然是**人編輯的那一份**（意圖），`.lock` 是**機器產生的那一份**（事實），
改前者之後必須重新產生後者。

**2. `uv` 以 digest 釘死**，同時保留 `:0.12.6` 版本標籤 ——
標籤是給人讀的，digest 才是真正生效的約束。

**3. 兩個 backend image 都 `USER app`（uid 1000）。**

uid 選 1000 不是隨便挑的：dev image 會 bind-mount 整個 checkout，並寫入 `./data`
與 `./uploads`。**容器內的使用者跟 host 檔案擁有者不一致時，Dockerfile 裡的 `chown`
會被 bind mount 蓋掉**，症狀是請求執行到一半才 `PermissionError`，不是啟動時就失敗。

## Consequences

**正面**

- 同一個 commit 的 build 現在裝的是同一組程式碼，而且 `pip-audit` 稽核的就是會出貨的那一組。
- 建置過程沒有任何浮動 tag。
- 容器不再以 root 執行，在一台共用主機上這件事有實際意義。

**負面 / 代價**

- **多一個必須跟著更新的檔案。** 改 `requirements.txt` 而忘記重新產生 `.lock`，
  新套件不會被裝進去 —— 而且不會有錯誤訊息，只有 import 失敗。`CLAUDE.md` 的
  「Dependency changes」寫了指令，但沒有守衛檢查兩者同步。
- **既有的 root-owned 產物會擋路。** 這不是理論：切換後第一次跑 `ruff` 就因為
  `/app/.ruff_cache` 是舊 root 容器建的而失敗，附件寫入也一樣。本機清一次即可
  （指令在 `CLAUDE.md`）。
- **部署有同樣的風險，而且更隱蔽。** `$DEPLOY_DIR/data` 是歷次 root 部署留下的。
  健康檢查**只讀不寫**，所以第一次非 root 部署會亮綠燈，然後在第一次寫入時才壞。
  deploy job 因此每次都跑一個 `chown 1000:1000`——冪等，而且便宜到不值得省。
- uid 1000 是寫死的預設。host 使用者不是 1000 的話要用 `--build-arg APP_UID=` 覆寫，
  這在 compose 裡沒有接出來。
