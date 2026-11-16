// src/consumer.ts
// CONSUMER: citește comenzi din coada "comenzi" cu long polling.
// - dacă procesarea reușește  -> DeleteMessage (ștergere explicită!)
// - dacă procesarea eșuează   -> NU ștergem mesajul; SQS îl face vizibil din nou
//                                după visibility timeout și, după 3 recepții,
//                                îl mută automat în "comenzi-dlq".

import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type Message,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import { COADA_COMENZI, COADA_DLQ, creeazaClientSqs, obtineUrlCoada } from "./config";
import type { Comanda } from "./types";

// Trebuie să fie aceeași valoare ca VisibilityTimeout din scripts/01-create-queues.sh.
const VISIBILITY_TIMEOUT_SECUNDE = 5;

// Long polling: o cerere poate aștepta până la 10 secunde un mesaj nou.
const WAIT_TIME_SECONDS = 10;
const MAX_NUMAR_MESAJE = 5;

// Cât "durează" procesarea unei comenzi valide (simulare).
const DURATA_PROCESARE_MS = 500;

/** Pauză simplă, ca să simulăm timpul de procesare. */
function asteapta(milisecunde: number): Promise<void> {
  return new Promise((rezolva) => setTimeout(rezolva, milisecunde));
}

/** Ora curentă, doar pentru ca logurile să fie ușor de urmărit. */
function ora(): string {
  return new Date().toISOString().slice(11, 19); // HH:MM:SS
}

// ---------------------------------------------------------------------------
// Oprire grațioasă: la Ctrl+C nu întrerupem un mesaj la jumătate.
// Setăm un steag, terminăm lotul curent, apoi ieșim din buclă.
// ---------------------------------------------------------------------------
let oprireCeruta = false;

function cereOprire(semnnal: string): void {
  if (oprireCeruta) {
    return;
  }
  oprireCeruta = true;
  console.log(`\n[${semnnal}] Oprire cerută: termin lotul curent, apoi mă opresc...`);
}

process.on("SIGINT", () => cereOprire("SIGINT"));
process.on("SIGTERM", () => cereOprire("SIGTERM"));

// ---------------------------------------------------------------------------

/** Procesează un singur mesaj SQS. Nu aruncă erori mai departe. */
async function proceseazaMesaj(
  client: SQSClient,
  coadaUrl: string,
  mesaj: Message
): Promise<void> {
  // Câte reîncercări au fost: 1 prima dată, 2 a doua oară etc.
  const numarReceptii = mesaj.Attributes?.ApproximateReceiveCount ?? "?";
  const corp = mesaj.Body ?? "";

  try {
    // Corpul mesajului este JSON-ul scris de producer (tipul Comanda).
    const comanda = JSON.parse(corp) as Comanda;

    console.log(
      `  -> ${comanda.id} | client: ${comanda.client} | total: ${comanda.total.toFixed(2)} lei | recepția ${numarReceptii}`
    );

    // Comanda marcată invalidă: simulăm o eroare de business.
    if (!comanda.valida) {
      throw new Error(`Comanda ${comanda.id} este marcată invalidă (valida=false).`);
    }

    // Simulăm procesarea reală (validare, plată, email etc.).
    await asteapta(DURATA_PROCESARE_MS);

    if (!mesaj.ReceiptHandle) {
      throw new Error("Mesajul nu are ReceiptHandle, deci nu poate fi șters.");
    }

    // ȘTERGEREA EXPLICITĂ: fără acest pas, mesajul ar reveni în coadă.
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: coadaUrl,
        ReceiptHandle: mesaj.ReceiptHandle,
      })
    );

    console.log("     ✔ procesată cu succes și ștearsă din coadă.");
  } catch (eroare) {
    const mesajEroare = eroare instanceof Error ? eroare.message : String(eroare);
    console.log(`     ✘ EȘEC: ${mesajEroare}`);
    console.log(`     Mesajul NU este șters. Devine din nou vizibil după ${VISIBILITY_TIMEOUT_SECUNDE}s.`);
    console.log(
      `     Când se depășește limita de 3 recepții, SQS îl mută automat în "${COADA_DLQ}".`
    );
  }
}

async function main(): Promise<void> {
  const client = creeazaClientSqs();

  try {
    const coadaUrl = await obtineUrlCoada(client, COADA_COMENZI);
    console.log(`Consumer pornit pentru coada "${COADA_COMENZI}".`);
    console.log(`Coadă: ${coadaUrl}`);
    console.log("Aștept comenzi cu long polling (10s). Oprire: Ctrl+C.\n");

    while (!oprireCeruta) {
      const raspuns = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: coadaUrl,
          WaitTimeSeconds: WAIT_TIME_SECONDS,
          MaxNumberOfMessages: MAX_NUMAR_MESAJE,
          // Atribut de sistem: de câte ori a fost primit mesajul (pentru loguri).
          MessageSystemAttributeNames: ["ApproximateReceiveCount"],
          // Atributele custom puse de producer (ex. tip=comanda).
          MessageAttributeNames: ["All"],
        })
      );

      const mesaje = raspuns.Messages ?? [];

      if (mesaje.length === 0) {
        // Dacă ni s-a cerut oprirea, nu mai adăugăm zgomot în loguri.
        if (!oprireCeruta) {
          console.log(`[${ora()}] Nicio comandă nouă în coadă.`);
        }
        continue;
      }

      console.log(`\n[${ora()}] Am primit ${mesaje.length} mesaj(e):`);

      // Procesăm lotul pe rând. O eroare la un mesaj nu oprește restul lotului.
      for (const mesaj of mesaje) {
        await proceseazaMesaj(client, coadaUrl, mesaj);
      }
    }

    console.log("\nConsumer oprit curat. La revedere!");
  } finally {
    client.destroy();
  }
}

main().catch((eroare: unknown) => {
  console.error("\nConsumer a eșuat:");
  console.error(eroare instanceof Error ? eroare.message : eroare);
  process.exitCode = 1;
});
