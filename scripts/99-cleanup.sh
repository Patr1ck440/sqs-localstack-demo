#!/usr/bin/env bash
# scripts/99-cleanup.sh
# Șterge cozile create de demo, ca să lași LocalStack curat.
# Este tolerant: dacă o coadă nu există (sau LocalStack e oprit), doar ne spune.
#
# Rulare: npm run cleanup   (sau: bash scripts/99-cleanup.sh)

set -euo pipefail

DLQ_NAME="comenzi-dlq"
QUEUE_NAME="comenzi"

# Șterge o coadă după nume, fără să pice dacă lipsește.
sterge_coada() {
  local nume="$1"
  local url

  # get-queue-url eșuează dacă coada nu există -> intrăm pe ramura else.
  if url=$(awslocal sqs get-queue-url --queue-name "$nume" --query 'QueueUrl' --output text 2>/dev/null); then
    awslocal sqs delete-queue --queue-url "$url"
    echo "  ✔ coada \"$nume\" a fost ștearsă."
  else
    echo "  - coada \"$nume\" nu există (nimic de șters)."
  fi
}

echo "==> Șterg cozile demo din LocalStack..."

# Ștergem întâi coada principală (cea care referă DLQ), apoi DLQ.
sterge_coada "$QUEUE_NAME"
sterge_coada "$DLQ_NAME"

echo ""
echo "Cozile rămase:"
# --query + --output text ne dă o listă simplă (sau nimic, dacă nu există cozi).
COZI_RAMASE=$(awslocal sqs list-queues --query 'QueueUrls' --output text 2>/dev/null || true)
if [ -z "$COZI_RAMASE" ] || [ "$COZI_RAMASE" = "None" ]; then
  echo "  (nicio coadă)"
else
  echo "$COZI_RAMASE"
fi

echo ""
echo "Curățare terminată. Pentru a opri LocalStack: docker compose down"
