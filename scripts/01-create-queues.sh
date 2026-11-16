#!/usr/bin/env bash
# scripts/01-create-queues.sh
# Creează cozile SQS pentru demo, în LocalStack:
#   1. "comenzi-dlq" - coada dead-letter (trebuie să existe prima, ca să-i știm ARN-ul)
#   2. "comenzi"     - coada principală, cu VisibilityTimeout=5 și RedrivePolicy spre DLQ
#
# Rulare: npm run setup   (sau: bash scripts/01-create-queues.sh)
# Scriptul este idempotent: dacă o coadă există deja, o refolosește.

set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-us-east-1}"
DLQ_NAME="comenzi-dlq"
QUEUE_NAME="comenzi"

# awslocal este un wrapper peste AWS CLI care trimite comenzile către
# http://localhost:4566 (LocalStack) în loc de AWS real.

# Verifică dacă o coadă există deja. Returnează 0 (succes) dacă există, 1 dacă nu.
exista_coada() {
  awslocal sqs get-queue-url --queue-name "$1" >/dev/null 2>&1
}

echo "==> Pas 0: verific dacă LocalStack răspunde pe http://localhost:4566 ..."
if ! awslocal sqs list-queues >/dev/null 2>&1; then
  echo ""
  echo "EROARE: nu pot comunica cu LocalStack."
  echo "  - este pornit?           docker compose up -d"
  echo "  - vezi starea:           docker compose ps"
  echo "  - vezi logurile:         docker compose logs -f localstack"
  echo "  - este instalat awslocal? pip install awscli-local"
  exit 1
fi
echo "    OK, LocalStack răspunde (regiune: ${REGION})."
echo ""

# ---------------------------------------------------------------------------
# Pas 1: coada dead-letter
# ---------------------------------------------------------------------------
echo "==> Pas 1/3: coada dead-letter \"${DLQ_NAME}\""
if exista_coada "$DLQ_NAME"; then
  echo "    Coada \"${DLQ_NAME}\" există deja, o refolosesc."
else
  awslocal sqs create-queue --queue-name "$DLQ_NAME" >/dev/null
  echo "    Coada \"${DLQ_NAME}\" a fost creată."
fi

DLQ_URL=$(awslocal sqs get-queue-url --queue-name "$DLQ_NAME" --query 'QueueUrl' --output text)
DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

echo "    URL: $DLQ_URL"
echo "    ARN: $DLQ_ARN"
echo ""

# ---------------------------------------------------------------------------
# Pas 2: coada principală, cu RedrivePolicy (legătura către DLQ)
# ---------------------------------------------------------------------------
echo "==> Pas 2/3: coada principală \"${QUEUE_NAME}\""
if exista_coada "$QUEUE_NAME"; then
  echo "    Coada \"${QUEUE_NAME}\" există deja, o refolosesc."
  echo "    Dacă vrei cozile recreate de la zero: bash scripts/99-cleanup.sh, apoi din nou acest script."
else
  # ATENȚIE la ghilimele: `--attributes` primește un JSON în care:
  #   - VisibilityTimeout este un string ("5")
  #   - RedrivePolicy este, la rândul lui, un STRING care conține un JSON.
  # De aceea ghilimelele din interiorul politicii trebuie escapate o dată
  # pentru JSON (\") și încă o dată pentru bash (\\\").
  ATRIBUTE="{\"VisibilityTimeout\":\"5\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}"

  awslocal sqs create-queue \
    --queue-name "$QUEUE_NAME" \
    --attributes "$ATRIBUTE" >/dev/null
  echo "    Coada \"${QUEUE_NAME}\" a fost creată (VisibilityTimeout=5, maxReceiveCount=3)."
fi
echo ""

# ---------------------------------------------------------------------------
# Pas 3: verificare (afișăm atributele reale din LocalStack)
# ---------------------------------------------------------------------------
echo "==> Pas 3/3: verificare"
QUEUE_URL=$(awslocal sqs get-queue-url --queue-name "$QUEUE_NAME" --query 'QueueUrl' --output text)

echo "    Atributele cozii \"${QUEUE_NAME}\":"
awslocal sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names VisibilityTimeout RedrivePolicy \
  --output json

echo ""
echo "    Mesaje în coadă acum:"
awslocal sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --query 'Attributes' \
  --output json

echo ""
echo "Gata. Cozi existente:"
awslocal sqs list-queues
echo ""
echo "Următorii pași:"
echo "  npm run producer   # trimite 5 comenzi (una invalidă)"
echo "  npm run consumer   # le procesează (Ctrl+C pentru oprire)"
echo "  npm run dlq        # citește ce a ajuns în DLQ"
