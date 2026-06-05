$BOT_TOKEN="PASTE_YOUR_BOT_TOKEN_HERE"
$URL="https://YOUR-RENDER-SERVICE.onrender.com/webhook"
$SECRET="my_secret_123"
$ALLOWED='["message","edited_message","business_connection","business_message","edited_business_message","deleted_business_messages"]'

curl.exe -X POST "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" --data-urlencode "url=$URL" --data-urlencode "secret_token=$SECRET" --data-urlencode "allowed_updates=$ALLOWED"

Invoke-RestMethod "https://api.telegram.org/bot$BOT_TOKEN/getWebhookInfo"
