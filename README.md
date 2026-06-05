# AllSaveModBot Render

Готовый вариант бота для Render без Cloudflare KV.

## Файлы

- `server.js` — основной код
- `package.json` — зависимости
- `data/db.json` — база создаётся автоматически

## Render настройки

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

Environment Variables:

```text
BOT_TOKEN=токен бота
OWNER_ID=5305261101
SECRET_TOKEN=my_secret_123
VIEWER_KEY=my_secret_123
```

## Webhook

После деплоя Render даст ссылку, например:

```text
https://allsavemodbot.onrender.com
```

В PowerShell:

```powershell
$BOT_TOKEN="твой_токен"
$URL="https://allsavemodbot.onrender.com/webhook"
$SECRET="my_secret_123"
$ALLOWED='["message","edited_message","business_connection","business_message","edited_business_message","deleted_business_messages"]'

curl.exe -X POST "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" --data-urlencode "url=$URL" --data-urlencode "secret_token=$SECRET" --data-urlencode "allowed_updates=$ALLOWED"
```

Проверка:

```powershell
$BOT_TOKEN="твой_токен"
Invoke-RestMethod "https://api.telegram.org/bot$BOT_TOKEN/getWebhookInfo"
```

## Открыть список чатов

```text
https://allsavemodbot.onrender.com/?key=my_secret_123
```

## Важно про хранение

На бесплатном Render файловая система может сбрасываться при redeploy/restart. Для постоянного хранения подключи Render Disk или позже перенеси на Postgres/VPS.
