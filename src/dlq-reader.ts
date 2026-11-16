// src/dlq-reader.ts
// DLQ READER: citește mesajele ajunse în coada "comenzi-dlq", le afișează
// (conținut + de câte ori au fost primite) și apoi le șterge din DLQ.

import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type Message,
} from "@aws-sdk/client-sqs";
import { COADA_DLQ, creeazaClientSqs, obtineUrlCoada } from "./config";
import type { Comanda } from "./types";

const MAX_NUMAR_MESAJE = 10; // limita maxima permisa de SQS
const WAIT_TIME_SECONDS = 2;

async function main(): Promise<void> {
  const client = creeazaClientSqs();

  try {
    const coadaUrl = await obtineUrlCoada(client, COADA_DLQ);
    console.log(`Citesc mesajele din coada dead-letter "${COADA_DLQ}"...\n`);

    let total = 0;

    // Citim în buclă până când coada rămâne goală.
    while (true) {
      const raspuns = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: coadaUrl,
          MaxNumberOfMessages: MAX_NUMAR_MESAJE,
          WaitTimeSeconds: WAIT_TIME_SECONDS,
          MessageSystemAttributeNames: ["ApproximateReceiveCount"],
          MessageAttributeNames: ["All"],
        })
      );

      const mesaje: Message[] = raspuns.Messages ?? [];

      if (mesaje.length === 0) {
        break;
      }

      for (const mesaj of mesaje) {
        total += 1;
        const numarReceptii = mesaj.Attributes?.ApproximateReceiveCount ?? "?";
        const corp = mesaj.Body ?? "";

        console.log(`--- Mesaj #${total} din DLQ ---`);
        console.log(`  Recepții în coada principală: ${numarReceptii}`);
        console.log(`  Conținut brut: ${corp}`);

        // Încercăm să-l citim frumos ca pe o comandă (dacă e JSON valid).
        try {
          const comanda = JSON.parse(corp) as Comanda;
          console.log(
            `  Comandă: ${comanda.id}, client ${comanda.client}, total ${comanda.total.toFixed(2)} lei, valida=${comanda.valida}`
          );
        } catch {
          console.log("  (conținutul nu este JSON valid - îl afișăm doar brut)");
        }

        // Ștergem mesajul din DLQ după ce l-am inspectat.
        // Dacă nu l-am șterge, ar rămâne acolo și ar apărea din nou la rularea următoare.
        if (mesaj.ReceiptHandle) {
          await client.send(
            new DeleteMessageCommand({
              QueueUrl: coadaUrl,
              ReceiptHandle: mesaj.ReceiptHandle,
            })
          );
          console.log("  ✔ șters din DLQ.\n");
        }
      }
    }

    if (total === 0) {
      console.log("DLQ este goală: nicio comandă nu a eșuat (sau ai rulat deja dlq-reader).");
    } else {
      console.log(`Total: ${total} mesaj(e) citite și șterse din DLQ.`);
    }
  } finally {
    client.destroy();
  }
}

main().catch((eroare: unknown) => {
  console.error("\nCitirea DLQ a eșuat:");
  console.error(eroare instanceof Error ? eroare.message : eroare);
  process.exitCode = 1;
});
