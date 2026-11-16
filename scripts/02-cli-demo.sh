#!/usr/bin/env bash
# scripts/02-cli-demo.sh
# Demonstrația cu AWS CLI (awslocal) a operațiilor cerute de referat:
#   1. listare cozi
#   2. inserare mesaj            (send-message)
#   3. citire mesaj              (receive-message)
#   4. consumare + ștergere      (delete-message cu ReceiptHandle)
#   5. număr de mesaje rămase    (get-queue-attributes)
#   6. golirea cozii             (purge-queue)
#
# Rulare: bash scripts/02-cli-demo.sh
#
# Necesită: LocalStack pornit + cozile create (npm run setup) + jq.
# jq este folosit doar ca să extragem ReceiptHandle din răspunsul JSON.

set -euo pipefail

QUEUE_NAME="comenzi"

# ---------------------------------------------------------------------------
# Verificări inițiale
# ---------------------------------------------------------------------------
if ! command -v jq >/dev/null 2>&1; then
  echo "EROARE: acest script are nevoie de utilitarul jq (pentru a extrage ReceiptHandle)."
  echo "  Ubuntu / WSL : sudo apt install jq"
  echo "  macOS        : brew install jq"
  echo "  Windows      : winget install jqlang.jq   (sau choco install jq)"
  echo ""
  echo "Alternativă fără jq: folosește --query, de exemplu:"
  echo "  awslocal sqs receive-message --queue-url \"\$URL\" --query 'Messages[0].ReceiptHandle' --output text"
  exit 1
fi

QUEUE_URL=$(awslocal sqs get-queue-url --queue-name "$QUEUE_NAME" --query 'QueueUrl' --output text)
echo "Coada folosită: $QUEUE_NAME ($QUEUE_URL)"
echo ""

# ---------------------------------------------------------------------------
# 1. Listare cozi
# ---------------------------------------------------------------------------
echo "=========================================================="
echo "1) LISTARE COZI  ->  awslocal sqs list-queues"
echo "=========================================================="
awslocal sqs list-queues
echo ""

# ---------------------------------------------------------------------------
# 2. Inserare mesaj
# ---------------------------------------------------------------------------
echo "=========================================================="
echo "2) INSERARE  ->  awslocal sqs send-message"
echo "   (mesajul este JSON; adăugăm și atributul custom tip=comanda)"
echo "=========================================================="
awslocal sqs send-message \
  --queue-url "$QUEUE_URL" \
  --message-body '{"id":"CLI-001","client":"Maria Pop","total":99.5,"valida":true}' \
  --message-attributes '{"tip":{"DataType":"String","StringValue":"comanda"}}'
echo ""

# ---------------------------------------------------------------------------
# 3. Citire mesaj (long polling scurt, cu atribute)
# ---------------------------------------------------------------------------
echo "=========================================================="
echo "3) CITIRE  ->  awslocal sqs receive-message --attribute-names All"
echo "   Mesajul devine invizibil pentru ceilalți consumatori"
echo "   timp de VisibilityTimeout secunde (aici: 5)."
echo "=========================================================="
RASPUNS=$(awslocal sqs receive-message \
  --queue-url "$QUEUE_URL" \
  --attribute-names All \
  --message-attribute-names All \
  --max-number-of-messages 1 \
  --wait-time-seconds 2 \
  --output json)

echo "$RASPUNS"

RECEIPT_HANDLE=$(echo "$RASPUNS" | jq -r '.Messages[0].ReceiptHandle // empty')
if [ -z "$RECEIPT_HANDLE" ]; then
  echo ""
  echo "Nu am primit niciun mesaj din coadă. Rulează din nou scriptul."
  exit 1
fi
echo ""

# ---------------------------------------------------------------------------
# 4. Consumare + ștergere explicită
# ---------------------------------------------------------------------------
echo "=========================================================="
echo "4) CONSUMARE + ȘTERGERE  ->  awslocal sqs delete-message"
echo "   ReceiptHandle extras din răspunsul de mai sus:"
echo "   $RECEIPT_HANDLE"
echo "   Fără delete-message, mesajul ar reveni în coadă după"
echo "   visibility timeout!"
echo "=========================================================="
awslocal sqs delete-message \
  --queue-url "$QUEUE_URL" \
  --receipt-handle "$RECEIPT_HANDLE"
echo "Mesaj șters."
echo ""

# ---------------------------------------------------------------------------
# 5. Numărul de mesaje rămase
# ---------------------------------------------------------------------------
echo "=========================================================="
echo "5) MESAJE RĂMASE  ->  awslocal sqs get-queue-attributes"
echo "   ApproximateNumberOfMessages = vizibile"
echo "   ApproximateNumberOfMessagesNotVisible = în procesare"
echo "=========================================================="
awslocal sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --query 'Attributes' \
  --output json
echo ""

# ---------------------------------------------------------------------------
# 6. Golirea cozii
# ---------------------------------------------------------------------------
echo "=========================================================="
echo "6) GOLIRE COADĂ  ->  awslocal sqs purge-queue"
echo "   ATENȚIE: șterge TOATE mesajele din coadă (inclusiv cele puse"
echo "   de npm run producer). SQS permite o golire la 60 de secunde."
echo "=========================================================="
awslocal sqs purge-queue --queue-url "$QUEUE_URL"
echo "Coada a fost golită."
echo ""

echo "=========================================================="
echo "Verificare finală (după golire):"
echo "=========================================================="
awslocal sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes' \
  --output json

echo ""
echo "Demo CLI terminat."
