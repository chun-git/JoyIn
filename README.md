# JoyIn

JoyIn 是給 LINE 群組使用的活動報名系統。群組成員在群組輸入 `/list`，Bot 只回覆一則活動卡片；新增、報名、代報、取消、候補與主揪管理都在 LIFF 網頁完成，避免群組被操作訊息洗版。

## 功能

- LINE Bot：群組 `/list` 回覆最近 5 筆尚未結束的活動 Flex Carousel
- LIFF 網頁：活動列表、建立、詳情、報名、代報、候補、取消
- 主揪可編輯、關閉報名、軟刪除、轉移主揪
- 候補依建立時間排序；正式名額釋出後第一順位自動轉正，並保留代報資訊
- Cloudflare Cron 每天清除已過期活動及其報名／候補資料

## 專案結構

```text
joyin/
├── web/                 React + Vite + TypeScript LIFF 前端
├── worker/              Cloudflare Worker + Hono API
├── shared/              前後端共用型別
├── migrations/         Cloudflare D1 schema
├── wrangler.toml         Worker、D1、Cron、Assets 部署設定
└── README.md
```

## 系統架構

```text
LINE 群組 /list
    -> LINE Platform
    -> Worker /webhook/line（驗證簽章）
    -> D1 讀取活動
    -> Flex Carousel（點擊開啟 LIFF）

LIFF 網頁
    -> Worker /api/*（驗證 LIFF ID Token）
    -> D1 events / registrations
```

## 環境需求

- Node.js 20+
- npm
- Cloudflare 帳號
- LINE Official Account / Messaging API Channel
- LINE LIFF（建議設為群組可開啟，scope 包含 `openid`、`profile`）

## 本機開發

```bash
git clone git@github.com:chun-git/JoyIn.git
cd JoyIn
npm install
cp .dev.vars.example .dev.vars
cp web/.env.example web/.env.local
```

先填本機開發值。`.dev.vars` 與 `web/.env.local` 不可提交。

```bash
npm run db:migrate:local
npm test
npm run dev
```

- 前端：http://127.0.0.1:5173
- Worker / API：http://127.0.0.1:8787
- 本機可把 `ALLOW_TEST_AUTH=true`、`VITE_DEV_AUTH=true`，用測試身分操作 UI 與 API

本機測試身分範例：

```bash
curl http://127.0.0.1:8787/api/events \
  -H 'Authorization: Bearer test:U-lee:Lee' \
  -H 'X-Line-Group-Id: G-dev'
```

## 測試

```bash
npm test
npm run test:worker
npm run test:web
```

涵蓋：

- LINE Webhook HMAC 簽章驗證
- 活動 CRUD 與權限
- 本人報名／代報與防重複
- 候補排序與取消後自動轉正
- 過期活動 Cron 清理
- 前端活動卡片與狀態文案

## 資料庫

D1 資料表：

- `events`
- `registrations`
- `webhook_events`（Webhook 去重）
- `organizer_transfers`（主揪轉移紀錄）

活動狀態：

- `OPEN`：開放報名
- `CLOSED`：關閉報名
- `DELETED`：軟刪除

報名類型：

- `SELF`：本人報名
- `PROXY`：代報（顯示為 `Amy（Lee 代報）`）

同一活動同一 LINE 使用者不可重複本人報名；同一活動同一代報者不可重複代報相同姓名。

## LINE 設定

1. 建立 Messaging API Channel，取得 Channel ID、Channel Secret、Channel Access Token
2. Webhook URL 設為 `https://joyin.joyin.workers.dev/webhook/line`
3. 開啟 Webhook，關閉聊天室自動回應（避免干擾 `/list`）
4. 將 Bot 加入目標 LINE 群組
5. 建立 LIFF App
   - Endpoint URL：`https://joyin-web.pages.dev`
   - Scope：`openid`、`profile`
   - 允許在群組聊天室開啟
6. Flex 卡片會開啟 `LIFF_URL`（通常是 `https://liff.line.me/<LIFF_ID>`）

## Cloudflare 部署

### 1. 建立 D1

```bash
npx wrangler login
npx wrangler d1 create joyin
```

把回傳的 `database_id` 填進 `wrangler.toml` 的 `database_id`。

```bash
npm run db:migrate:remote
```

### 2. 設定 Secrets

不要把金鑰寫進 Git。正式環境使用：

```bash
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ID
npx wrangler secret put LIFF_ID
npx wrangler secret put LIFF_URL
```

`wrangler.toml` 的 `[vars] ALLOW_TEST_AUTH` 正式環境必須是 `"false"`。

### 3. 部署 Worker API

API Worker 網域：`https://joyin.joyin.workers.dev`

```bash
npx wrangler deploy
```

Cron Trigger 已寫在 `wrangler.toml`：`0 16 * * *`（UTC 16:00，台灣時間每天 00:00）會刪除已過期活動與相關報名／候補。

### 4. Cloudflare Pages（LIFF 前端）

正式前端網域：`https://joyin-web.pages.dev`

建置時注入：

- `VITE_API_BASE_URL=https://joyin.joyin.workers.dev`
- `VITE_LIFF_ID`（既有 LIFF ID）
- `VITE_DEV_AUTH=false`

```bash
VITE_DEV_AUTH=false \
VITE_API_BASE_URL=https://joyin.joyin.workers.dev \
VITE_LIFF_ID=<your-liff-id> \
npm run build:web

npx wrangler pages deploy web/dist --project-name joyin-web
```

SPA fallback 使用 `web/public/_redirects`：`/* /index.html 200`。

Worker CORS 會回傳請求的 `Origin`，正式 Pages 網域 `https://joyin-web.pages.dev` 可呼叫 `/api`。

## 環境變數

### Worker / `.dev.vars`

| 名稱 | 說明 |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API Channel Access Token |
| `LINE_CHANNEL_SECRET` | 用於驗證 `X-Line-Signature` |
| `LINE_CHANNEL_ID` | 用於驗證 LIFF ID Token |
| `LIFF_ID` | LIFF ID |
| `LIFF_URL` | 卡片開啟的 LIFF URL |
| `ALLOW_TEST_AUTH` | 僅本機測試。正式環境必須 `false` |

### 前端 / `web/.env.example`

| 名稱 | 說明 |
| --- | --- |
| `VITE_LIFF_ID` | LIFF ID |
| `VITE_API_BASE_URL` | 同網域可留空；Pages 分離部署時填 Worker origin |
| `VITE_DEV_AUTH` | 本機無 LIFF 時的開發模式 |
| `VITE_DEV_USER_ID` | 開發用 LINE User ID |
| `VITE_DEV_DISPLAY_NAME` | 開發用顯示名稱 |
| `VITE_DEV_GROUP_ID` | 開發用群組 ID |

以下資料**不可**提交到 GitHub：

- LINE Channel Access Token / Secret
- Cloudflare API Token
- `.dev.vars`、`.env.local` 與任何正式環境密鑰

## API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康檢查 |
| `GET` | `/api/config` | 公開 LIFF ID／LIFF URL（不含密鑰） |
| `GET` | `/api/events` | 尚未結束的活動列表 |
| `GET` | `/api/events/:eventId` | 活動詳情、名單與檢視者權限 |
| `POST` | `/api/events` | 建立活動（建立者成為主揪） |
| `PATCH` | `/api/events/:eventId` | 主揪編輯 |
| `POST` | `/api/events/:eventId/join` | 本人報名／候補 |
| `POST` | `/api/events/:eventId/proxy-join` | 代報 |
| `DELETE` | `/api/registrations/:registrationId` | 取消報名 |
| `POST` | `/api/events/:eventId/close` | 關閉報名 |
| `DELETE` | `/api/events/:eventId` | 軟刪除 |
| `POST` | `/api/events/:eventId/transfer-organizer` | 轉移主揪 |
| `POST` | `/webhook/line` | LINE Webhook |

除 Webhook 與 health 外，API 需：

```text
Authorization: Bearer <LIFF ID Token>
X-Line-Group-Id: <Group ID>
```

## 權限摘要

- 任何群組成員可建立活動、查看名單、本人報名、代報
- 建立者自動成為主揪
- 使用者可取消自己的本人報名與自己代報的資料
- 不可取消其他人建立的報名
- 主揪可取消任何人、編輯、關閉、刪除、轉移主揪
- 已有正式報名時，人數上限不可低於目前正式人數
- 修改時間或地點時，前端會先確認，後端也要求 `confirmTimeLocationChange`

## 授權

私有專案，僅供 JoyIn 使用。
