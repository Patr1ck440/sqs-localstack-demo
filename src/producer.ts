// src/producer.ts
// PRODUCER: trimite 5 comenzi în coada "comenzi" folosind SendMessageBatch.
// Exact una dintre ele are valida=false și va eșua intenționat la procesare.

import { SendMessageBatchCommand, type SendMessageBatchRequestEntry } from "@aws-sdk/client-sqs";
import { COADA_COMENZI, creeazaClientSqs, obtineUrlCoada } from "./config";
import type { Comanda } from "./types";

// Comenzile de trimis. A treia este invalidă intenționat (valida: false),
// ca să demonstrăm reîncercările și trecerea automată în DLQ.
const COMENZI: Comanda[] = [
  { id: "CMD-001", client: "Ana Popescu", total: 149.9, valida: true },
  { id: "CMD-002", client: "Mihai Iordache", total: 320.0, valida: true },
  { id: "CMD-003", client: "Ion Ionescu", total: 25.0, valida: false }, // <- invalidă
  { id: "CMD-004", client: "Elena Dumitru", total: 89.99, valida: true },
  { id: "CMD-005", client: "Radu Marinescu", total: 512.5, valida: true },
];

async function main(): Promise<void> {
  const client = creeazaClientSqs();

  try {
    const coadaUrl = await obtineUrlCoada(client, COADA_COMENZI);
    console.log(`Producer: trimit ${COMENZI.length} comenzi în coada "${COADA_COMENZI}".`);
    console.log(`Coadă: ${coadaUrl}\n`);

    // Map de la Id-ul din batch (ex. "comanda-1") la comanda propriu-zisă,
    // ca să putem afișa ce comandă corespunde fiecărui MessageId primit.
    const comandaDupaIdBatch = new Map<string, Comanda>();

    // SendMessageBatch permite maximum 10 mesaje într-o singură cerere.
    const entries: SendMessageBatchRequestEntry[] = COMENZI.map((comanda, index) => {
      const idBatch = `comanda-${index + 1}`;
      comandaDupaIdBatch.set(idBatch, comanda);

      return {
        Id: idBatch,
        // Corpul mesajului este JSON (ca text), exact tipul Comanda.
        MessageBody: JSON.stringify(comanda),
        // Atribut custom, util la filtrare / demonstrație (apare în receive-message).
        MessageAttributes: {
          tip: { DataType: "String", StringValue: "comanda" },
        },
      };
    });

    const raspuns = await client.send(
      new SendMessageBatchCommand({
        QueueUrl: coadaUrl,
        Entries: entries,
      })
    );

    // Mesajele trimise cu succes.
    for (const rezultat of raspuns.Successful ?? []) {
      const comanda = comandaDupaIdBatch.get(rezultat.Id ?? "");
      const descriere = comanda
        ? `${comanda.id} (${comanda.client}, ${comanda.total.toFixed(2)} lei)`
        : rezultat.Id;
      console.log(`  ✔ ${descriere}`);
      console.log(`    MessageId: ${rezultat.MessageId}`);
    }

    // Eșecuri parțiale: SendMessageBatch NU aruncă excepție dacă doar o parte
    // dintre mesaje au eșuat. De aceea trebuie să verificăm explicit `Failed`.
    const esecuri = raspuns.Failed ?? [];
    for (const esec of esecuri) {
      console.error(`  ✘ EȘEC la ${esec.Id}: ${esec.Code} - ${esec.Message}`);
    }

    console.log(
      `\nRezultat: ${(raspuns.Successful ?? []).length} trimise, ${esecuri.length} eșuate.`
    );
    console.log('Comanda CMD-003 are valida=false și va ajunge în coada "comenzi-dlq".');

    if (esecuri.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    // Închidem conexiunile HTTP ale SDK-ului, ca procesul să se termine imediat.
    client.destroy();
  }
}

main().catch((eroare: unknown) => {
  console.error("\nProducer a eșuat:");
  console.error(eroare instanceof Error ? eroare.message : eroare);
  process.exitCode = 1;
});
