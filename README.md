# Demo Amazon SQS cu LocalStack — coadă de comenzi cu reîncercări și DLQ

Prototip funcțional pentru referatul despre **Amazon Web Services**: serviciul ales este
**Amazon SQS** (Simple Queue Service), rulat local cu **LocalStack** (fără cont AWS, fără costuri).

Un *producer* trimite 5 comenzi în coada `comenzi`. Un *consumer* le citește cu long polling,
le procesează și le șterge **explicit** cu `DeleteMessage`. O comandă marcată intenționat ca
invalidă eșuează la procesare: mesajul nu este șters, reapare după *visibility timeout* și,
după 3 recepții, SQS îl mută automat în coada dead-letter `comenzi-dlq`.

---

## 1. Ce face proiectul

```
                        SendMessageBatch               ReceiveMessage + DeleteMessage
  +---------------+     (5 comenzi, 1 invalidă)   +-----------+    (doar dacă procesarea reușește)
  | producer.ts   | ---------------------------> |  comenzi   | ---------------------------> consumer.ts
  +---------------+                              +-----+-----+
                                                       |
                                                       |  procesarea eșuează de 3 ori
                                                       |  (RedrivePolicy: maxReceiveCount=3)
                                                       v
                                                 +-------------+        citește + șterge
                                                 | comenzi-dlq | <--------------------- dlq-reader.ts
                                                 +-------------+
```

Ce se demonstrează practic:

1. **Trimiterea** unui lot de mesaje cu `SendMessageBatch` (inclusiv un atribut custom `tip=comanda`).
2. **Primirea** mesajelor cu long polling (`WaitTimeSeconds=10`) și `MaxNumberOfMessages=5`.
3. **Visibility timeout**: după ce un mesaj este primit, el devine invizibil 5 secunde.
4. **Ștergerea explicită** cu `DeleteMessage` — SQS nu șterge mesajele automat.
5. **Reîncercările**: un mesaj neșters reapare și primește un `ApproximateReceiveCount` mai mare.
6. **Dead-letter queue**: după ce se depășește `maxReceiveCount`, mesajul este mutat automat
   în `comenzi-dlq`.

---

## 2. Cerințe

| Unealtă | De ce e nevoie | Verificare |
|---|---|---|
| **Docker** 24+ | rulează containerul LocalStack | `docker --version` |
| **Docker Compose** v2 | pornește serviciul din `docker-compose.yml` | `docker compose version` |
| **Node.js** 20+ | rulează codul TypeScript (prin `tsx`) | `node -v` |
| **Python** 3.8+ și **pip** | instalează `awscli-local` | `python3 --version` și `pip3 --version` (pe Windows: `python --version`) |
| **AWS CLI** v2 | `awslocal` este un wrapper peste el | `aws --version` (se instalează automat ca dependență a `awscli-local`) |
| **awscli-local** | `awslocal` = AWS CLI care vorbește cu LocalStack | `awslocal --version` |
| **jq** | folosit **doar** în `scripts/02-cli-demo.sh` | `jq --version` |

> **Windows:** scripturile `.sh` se rulează din **Git Bash** sau **WSL**. În PowerShell
> comenzile `bash scripts/...` nu funcționează fără un bash instalat.
>
> **jq este necesar doar** pentru `scripts/02-cli-demo.sh` (extrage `ReceiptHandle` din răspunsul
> JSON). Aplicația TypeScript (`npm run producer` / `consumer` / `dlq`) **nu** are nevoie de jq.

---

## 3. Instalare

```bash
# 1. clonează repository-ul
git clone https://github.com/<utilizator>/sqs-localstack-demo.git
cd sqs-localstack-demo

# 2. dependențele Node.js (AWS SDK v3, tsx, TypeScript)
npm install

# 3. AWS CLI + awslocal (awslocal depinde de awscli, deci îl instalează și pe el)
pip install awscli-local

# verificare
awslocal --version

# 4. (opțional) fișierul .env - necesar doar dacă folosești o imagine LocalStack cu token
cp .env.example .env
```

Verifică rapid că totul e instalat:

```bash
node -v          # v20.x sau mai nou
npm -v
docker --version
docker compose version
awslocal --version
jq --version     # doar pentru demo-ul CLI
```

---

## 4. Pornirea LocalStack

```bash
docker compose up -d
```

Prima rulare descarcă imaginea `localstack/localstack:4.14` (câteva sute de MB), deci poate dura.
Așteaptă ca serviciul să devină `healthy`:

```bash
docker compose ps
```

Ieșire așteptată (contează ca `STATUS` să conțină `healthy`):

```
NAME                  IMAGE                       COMMAND                  SERVICE      CREATED          STATUS                    PORTS
sqs-demo-localstack   localstack/localstack:4.14  "docker-entrypoint.sh"   localstack   21 seconds ago   Up 11 seconds (healthy)   0.0.0.0:4566->4566/tcp, [::]:4566->4566/tcp
```

Verificare directă a endpoint-ului de health:

```bash
curl http://localhost:4566/_localstack/health
```

Ieșire de forma (am scurtat lista de servicii):

```json
{
    "services": {
        "acm": "disabled",
        "sqs": "available",
        "s3": "disabled"
    },
    "edition": "community",
    "version": "4.14.0"
}
```

Important este ca `sqs` să **nu** fie `disabled` (LocalStack pornește serviciile „lazy”, așa că
poate apărea `available` înainte de prima comandă și `running` după aceea — ambele sunt OK).

Dacă vrei să vezi logurile LocalStack în timp real:

```bash
docker compose logs -f localstack
```

> `docker-compose.yml` setează `SQS_ENDPOINT_STRATEGY=path` și `LOCALSTACK_HOST=localhost:4566`,
> astfel încât LocalStack să returneze URL-uri simple, de tipul
> `http://localhost:4566/queue/us-east-1/000000000000/comenzi`, fără DNS special.

---

## 5. Crearea cozilor

```bash
npm run setup
```

ceea ce rulează `bash scripts/01-create-queues.sh`. Scriptul:

1. creează întâi `comenzi-dlq`;
2. citește ARN-ul ei (`get-queue-attributes --attribute-names QueueArn`);
3. creează `comenzi` cu `VisibilityTimeout=5` și `RedrivePolicy`
   (`deadLetterTargetArn` = ARN-ul DLQ, `maxReceiveCount=3`);
4. afișează atributele reale, ca dovadă.

Ieșire așteptată (prima rulare, prescurtată):

```
==> Pas 0: verific dacă LocalStack răspunde pe http://localhost:4566 ...
    OK, LocalStack răspunde (regiune: us-east-1).

==> Pas 1/3: coada dead-letter "comenzi-dlq"
    Coada "comenzi-dlq" a fost creată.
    URL: http://localhost:4566/queue/us-east-1/000000000000/comenzi-dlq
    ARN: arn:aws:sqs:us-east-1:000000000000:comenzi-dlq

==> Pas 2/3: coada principală "comenzi"
    Coada "comenzi" a fost creată (VisibilityTimeout=5, maxReceiveCount=3).

==> Pas 3/3: verificare
    Atributele cozii "comenzi":
{
    "Attributes": {
        "VisibilityTimeout": "5",
        "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:comenzi-dlq\",\"maxReceiveCount\":\"3\"}"
    }
}
```

Scriptul este **idempotent**: dacă rulezi `npm run setup` de două ori, nu pică; a doua oară scrie
`Coada "comenzi" există deja, o refolosesc.` Dacă vrei cozile recreate de la zero (de exemplu după
ce ai modificat atributele):

```bash
npm run cleanup
npm run setup
```

---

## 6. Utilizare

### (a) Cu linia de comandă (AWS CLI prin `awslocal`)

> Rulează demo-ul CLI cu **consumer-ul oprit** (`npm run consumer`), altfel consumer-ul poate
> „fura” mesajul imediat ce a fost trimis.

```bash
bash scripts/02-cli-demo.sh
```

Scriptul execută, pe rând, operațiile cerute de referat:

| Pas | Comandă | Ce demonstrează |
|---|---|---|
| 1 | `awslocal sqs list-queues` | cozile există |
| 2 | `awslocal sqs send-message ...` | **inserare** mesaj (JSON + atribut `tip=comanda`) |
| 3 | `awslocal sqs receive-message --attribute-names All` | **citire** + mesajul devine invizibil 5s |
| 4 | `awslocal sqs delete-message --receipt-handle ...` | **consumare + ștergere explicită** |
| 5 | `awslocal sqs get-queue-attributes ... ApproximateNumberOfMessages` | câte mesaje au rămas |
| 6 | `awslocal sqs purge-queue` | **golirea** cozii |

Comenzile, pe scurt (echivalentul a ce rulează scriptul):

```bash
# URL-ul cozii, folosit de toate comenzile următoare
QUEUE_URL=$(awslocal sqs get-queue-url --queue-name comenzi --query QueueUrl --output text)

# 1) listare
awslocal sqs list-queues

# 2) inserare
awslocal sqs send-message \
  --queue-url "$QUEUE_URL" \
  --message-body '{"id":"CLI-001","client":"Maria Pop","total":99.5,"valida":true}' \
  --message-attributes '{"tip":{"DataType":"String","StringValue":"comanda"}}'

# 3) citire (răspunsul conține ReceiptHandle)
awslocal sqs receive-message \
  --queue-url "$QUEUE_URL" \
  --attribute-names All \
  --message-attribute-names All \
  --max-number-of-messages 1 \
  --wait-time-seconds 2

# 4) ștergere (ReceiptHandle extras cu jq)
awslocal sqs delete-message --queue-url "$QUEUE_URL" --receipt-handle "$RECEIPT_HANDLE"

# 5) câte mesaje au rămas
awslocal sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --query 'Attributes' --output json

# 6) golire
awslocal sqs purge-queue --queue-url "$QUEUE_URL"
```

Exemplu real de ieșire la pasul 3 (am scurtat `ReceiptHandle`):

```
{
    "Messages": [
        {
            "MessageId": "b67f686f-5246-452f-8312-69c4e93cd17c",
            "ReceiptHandle": "YzBkZDhmYTYtMWM5Zi00ZjA1LThlYTIt...",
            "MD5OfBody": "35305655392b46a721080d04cec3f3b5",
            "Body": "{\"id\":\"CLI-001\",\"client\":\"Maria Pop\",\"total\":99.5,\"valida\":true}",
            "Attributes": {
                "SenderId": "000000000000",
                "SentTimestamp": "1794812953223",
                "ApproximateReceiveCount": "1",
                "ApproximateFirstReceiveTimestamp": "1794812953467"
            },
            "MD5OfMessageAttributes": "8f0eee0e0a8e564afc98655cf8375e79",
            "MessageAttributes": {
                "tip": {
                    "StringValue": "comanda",
                    "DataType": "String"
                }
            }
        }
    ]
}
```

Exemplu de ieșire la pasul 5 (după ștergere, deci 0 mesaje):

```
{
    "ApproximateNumberOfMessages": "0",
    "ApproximateNumberOfMessagesNotVisible": "0"
}
```

> **Atenție:** `purge-queue` șterge **toate** mesajele din coadă, inclusiv cele trimise de
> `npm run producer`. AWS permite o singură golire la 60 de secunde
> (primești eroarea `PurgeQueueInProgress` dacă insiști mai repede).

### (b) Cu aplicația TypeScript (scenariul complet, cu DLQ)

Deschide **două terminale** în folderul proiectului.

**Terminalul 1 — consumer-ul** (îl lăsăm să ruleze):

```bash
npm run consumer
```

**Terminalul 2 — producer-ul**:

```bash
npm run producer
```

Ieșirea producer-ului:

```
Producer: trimit 5 comenzi în coada "comenzi".
Coadă: http://localhost:4566/queue/us-east-1/000000000000/comenzi

  ✔ CMD-001 (Ana Popescu, 149.90 lei)
    MessageId: 21adf5be-f0d9-4b91-b7a3-aab15d37f5cb
  ✔ CMD-002 (Mihai Iordache, 320.00 lei)
    MessageId: 42f2384c-e5aa-43b1-84ac-2b5ca9e38274
  ✔ CMD-003 (Ion Ionescu, 25.00 lei)
    MessageId: 747734c2-699a-443a-8746-64f08406c4ae
  ✔ CMD-004 (Elena Dumitru, 89.99 lei)
    MessageId: fce3a174-3084-4d01-9cc7-639e01bb3e9f
  ✔ CMD-005 (Radu Marinescu, 512.50 lei)
    MessageId: 1dbab959-e850-4fc9-bcb5-94cf8e075a90

Rezultat: 5 trimise, 0 eșuate.
Comanda CMD-003 are valida=false și va ajunge în coada "comenzi-dlq".
```

Ieșirea consumer-ului (recepțiile 1–3 ale comenzii invalide):

```
Consumer pornit pentru coada "comenzi".
Coadă: http://localhost:4566/queue/us-east-1/000000000000/comenzi
Aștept comenzi cu long polling (10s). Oprire: Ctrl+C.


[07:11:19] Am primit 5 mesaj(e):
  -> CMD-001 | client: Ana Popescu | total: 149.90 lei | recepția 1
     ✔ procesată cu succes și ștearsă din coadă.
  -> CMD-002 | client: Mihai Iordache | total: 320.00 lei | recepția 1
     ✔ procesată cu succes și ștearsă din coadă.
  -> CMD-003 | client: Ion Ionescu | total: 25.00 lei | recepția 1
     ✘ EȘEC: Comanda CMD-003 este marcată invalidă (valida=false).
     Mesajul NU este șters. Devine din nou vizibil după 5s.
     Când se depășește limita de 3 recepții, SQS îl mută automat în "comenzi-dlq".
  -> CMD-004 | client: Elena Dumitru | total: 89.99 lei | recepția 1
     ✔ procesată cu succes și ștearsă din coadă.
  -> CMD-005 | client: Radu Marinescu | total: 512.50 lei | recepția 1
     ✔ procesată cu succes și ștearsă din coadă.

[07:11:25] Am primit 1 mesaj(e):
  -> CMD-003 | client: Ion Ionescu | total: 25.00 lei | recepția 2
     ✘ EȘEC: Comanda CMD-003 este marcată invalidă (valida=false).
     Mesajul NU este șters. Devine din nou vizibil după 5s.
     Când se depășește limita de 3 recepții, SQS îl mută automat în "comenzi-dlq".

[07:11:31] Am primit 1 mesaj(e):
  -> CMD-003 | client: Ion Ionescu | total: 25.00 lei | recepția 3
     ✘ EȘEC: Comanda CMD-003 este marcată invalidă (valida=false).
     Mesajul NU este șters. Devine din nou vizibil după 5s.
     Când se depășește limita de 3 recepții, SQS îl mută automat în "comenzi-dlq".

[07:11:37] Nicio comandă nouă în coadă.
```

Oprirea consumer-ului se face cu **Ctrl+C** și este grațioasă: termină lotul curent, apoi scrie

```
[SIGINT] Oprire cerută: termin lotul curent, apoi mă opresc...

Consumer oprit curat. La revedere!
```

După ce comanda invalidă ajunge în DLQ, citește-o din al doilea terminal:

```bash
npm run dlq
```

Ieșire așteptată:

```
Citesc mesajele din coada dead-letter "comenzi-dlq"...

--- Mesaj #1 din DLQ ---
  Recepții în coada principală: 4
  Conținut brut: {"id":"CMD-003","client":"Ion Ionescu","total":25,"valida":false}
  Comandă: CMD-003, client Ion Ionescu, total 25.00 lei, valida=false
  ✔ șters din DLQ.

Total: 1 mesaj(e) citite și șterse din DLQ.
```

> Valoarea de la „Recepții” poate fi **3 sau 4**, în funcție de implementare: LocalStack 4.14
> incrementează contorul și în momentul mutării în DLQ (de aceea apare 4), în timp ce AWS-ul real
> raportează de obicei 3. Important este că mesajul a fost livrat de 3 ori consumatorului și apoi
> a fost mutat automat.

Dacă rulezi `npm run dlq` a doua oară, DLQ este deja goală (mesajul a fost șters):

```
Citesc mesajele din coada dead-letter "comenzi-dlq"...

DLQ este goală: nicio comandă nu a eșuat (sau ai rulat deja dlq-reader).
```

---

## 7. Scenariul DLQ pas cu pas

Comanda `CMD-003` are `valida: false`. Ce se întâmplă cu ea:

| Moment | Ce face SQS | Ce vezi |
|---|---|---|
| `T+0s` | livrează lotul de 5 mesaje | `CMD-003 ... recepția 1` → EȘEC, **fără** `DeleteMessage` |
| `T+0s … T+5s` | mesajul e invizibil (`VisibilityTimeout=5`) | consumer-ul primește „Nicio comandă nouă” |
| `T+5s` | mesajul redevine vizibil | `CMD-003 ... recepția 2` → EȘEC din nou |
| `T+10s` | redevine vizibil | `CMD-003 ... recepția 3` → EȘEC din nou |
| `T+15s` | contorul ar deveni 4, adică peste `maxReceiveCount=3`, deci mesajul **nu mai este livrat** | mesajul dispare din `comenzi` |
| `T+15s` | mesajul este mutat în `comenzi-dlq` | `npm run dlq` îl arată (cu `Recepții: 4` în LocalStack) |

De ce este important:

- SQS **nu** șterge mesajele când le predă consumatorului. Dacă procesarea eșuează și aplicația
  nu apelează `DeleteMessage`, mesajul revine — acesta este mecanismul de reîncercare.
- `VisibilityTimeout` decide **cât timp** mesajul rămâne invizibil (aici 5 secunde, ca demo-ul să
  fie rapid; în producție se folosesc valori de 30s – câteva minute).
- `RedrivePolicy` cu `maxReceiveCount=3` mută automat mesajul „otrăvit” într-o coadă separată,
  ca să nu blocheze la infinit coada principală.

Poți verifica oricând starea cozilor din CLI:

```bash
awslocal sqs get-queue-attributes \
  --queue-url "$(awslocal sqs get-queue-url --queue-name comenzi --query QueueUrl --output text)" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --query 'Attributes' --output json
```

---

## 8. Oprire și curățare

```bash
# 1. oprește consumer-ul: Ctrl+C în terminalul lui

# 2. șterge cozile din LocalStack (tolerant la cozi inexistente)
npm run cleanup

# 3. oprește containerul LocalStack
docker compose down
```

`npm run cleanup` rulează `bash scripts/99-cleanup.sh` și șterge `comenzi`, apoi `comenzi-dlq`;
dacă rulezi scriptul a doua oară, doar raportează că nu mai există nimic de șters.

LocalStack ține datele în memorie, deci `docker compose down` închide totul curat. Folderul
`volume/` (creat de `docker-compose.yml`) poate fi șters oricând: `rm -rf volume/`.

---

## 9. Depanare

### Portul 4566 este ocupat

Simptom: `docker compose up` se plânge de `bind: address already in use`.

```bash
# Linux / macOS / WSL
lsof -i :4566

# Windows (PowerShell)
netstat -ano | findstr :4566
```

Oprește procesul care ține portul sau oprește un alt LocalStack care rulează deja:
`docker ps`, apoi `docker stop <nume-container>`.

### Docker nu este pornit

Simptom: `Cannot connect to the Docker daemon` sau
`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`.

Pornește Docker Desktop (Windows/macOS) sau daemonul Docker (Linux) și verifică cu `docker ps`.

### Coada nu există

Simptom: `Coada "comenzi" nu există în LocalStack. Rulează mai întâi "npm run setup"...`

Rulează:

```bash
npm run setup
```

Dacă LocalStack a fost repornit și datele s-au pierdut, cozile trebuie recreate (același `npm run setup`).

### `awslocal: command not found`

```bash
pip install awscli-local
# dacă e instalat dar nu e găsit, verifică unde ajung scripturile Python:
python3 -m site --user-base
```

Pe Windows, adaugă în `PATH` folderul `Scripts` al Python-ului (de exemplu
`C:\Users\<user>\AppData\Local\Programs\Python\Python312\Scripts`).

### `awslocal` se conectează la AWS real, nu la LocalStack

`awslocal` setează automat endpoint-ul `http://localhost:4566`. Dacă folosești `aws` în loc de
`awslocal`, trebuie să adaugi `--endpoint-url http://localhost:4566` la fiecare comandă.

### `PurgeQueueInProgress`

SQS permite o singură golire la 60 de secunde. Așteaptă și rulează din nou.

### Healthcheck-ul apare ca `unhealthy`

LocalStack poate porni mai greu la prima rulare. Verifică manual:

```bash
curl http://localhost:4566/_localstack/health
```

Dacă `curl` răspunde de pe calculator, dar `docker compose ps` arată `unhealthy`, imaginea nu are
utilitarul `curl` în container. Poți elimina secțiunea `healthcheck` din `docker-compose.yml` —
nu afectează demo-ul (LocalStack funcționează oricum).

### Dacă imaginea 4.14 nu se descarcă sau cere token

Imaginea **`localstack/localstack:4.14`** este fixată intenționat: este ultima versiune cunoscută
care **nu** cere `LOCALSTACK_AUTH_TOKEN`. Din martie 2026, `localstack/localstack:latest` cere un
token de autentificare și, fără el, containerul se oprește cu un mesaj de eroare.

Dacă ai nevoie de o imagine mai nouă (sau tag-ul `4.14` nu mai există în registry):

1. îți faci un cont **gratuit** pe <https://app.localstack.cloud>;
2. mergi la secțiunea **Auth Token** din dashboard și copiază tokenul (începe cu `ls-...`);
3. creezi fișierul `.env` în rădăcina proiectului:

   ```bash
   cp .env.example .env
   ```

4. completezi în `.env`:

   ```
   LOCALSTACK_AUTH_TOKEN=ls-xxxxxxxxxxxxxxxxxxxxxxxx
   ```

5. schimbi imaginea în `docker-compose.yml`:

   ```yaml
   image: localstack/localstack:latest
   ```

   (linia `LOCALSTACK_AUTH_TOKEN=${LOCALSTACK_AUTH_TOKEN:-}` există deja în `docker-compose.yml`
   și citește automat valoarea din `.env`);

6. repornești: `docker compose up -d`.

**Fișierul `.env` nu se comite niciodată** — este deja trecut în `.gitignore`, iar în repository
există doar `.env.example` (fără valoare).

---

## 10. Structura proiectului

```
sqs-localstack-demo/
├── README.md                     # acest fișier
├── .gitignore                    # node_modules, .env, volume/, loguri
├── .env.example                  # șablon pentru LOCALSTACK_AUTH_TOKEN (fără valoare)
├── docker-compose.yml            # LocalStack 4.14, SERVICES=sqs, port 4566, healthcheck
├── package.json                  # scripturile npm + dependențele
├── tsconfig.json                 # TypeScript strict, ESM, target ES2022
├── scripts/
│   ├── 01-create-queues.sh       # creează comenzi-dlq, apoi comenzi cu RedrivePolicy
│   ├── 02-cli-demo.sh            # demo AWS CLI: listare/inserare/citire/ștergere/golire
│   └── 99-cleanup.sh             # șterge ambele cozi (tolerant la lipsa lor)
└── src/
    ├── config.ts                 # endpoint, regiune, credențiale, nume cozi, GetQueueUrl
    ├── types.ts                  # tipul Comanda
    ├── producer.ts               # trimite 5 comenzi (SendMessageBatch)
    ├── consumer.ts               # long polling, procesare, DeleteMessage, oprire grațioasă
    └── dlq-reader.ts             # citește + șterge mesajele din comenzi-dlq
```

Documentație utilă:

- Amazon SQS — visibility timeout: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html>
- Amazon SQS — dead-letter queues: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html>
- AWS SDK for JavaScript v3 — SQS: <https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sqs/>
- LocalStack — SQS: <https://docs.localstack.cloud/user-guide/aws/sqs/>
