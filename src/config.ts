// src/config.ts
// Aici stă TOATĂ configurarea comună: endpoint-ul LocalStack, regiunea,
// credențialele fictive și numele cozilor. Restul fișierelor importă de aici,
// ca să nu repetăm valori prin cod.

import { GetQueueUrlCommand, SQSClient } from "@aws-sdk/client-sqs";

/** Adresa API-ului AWS simulat de LocalStack (portul din docker-compose.yml). */
export const ENDPOINT_LOCALSTACK = "http://localhost:4566";

/** Regiunea AWS. LocalStack o acceptă pe oricare, dar SDK-ul cere una. */
export const REGIUNE = "us-east-1";

/** Numele cozii principale, în care producer-ul pune comenzile. */
export const COADA_COMENZI = "comenzi";

/** Numele cozii dead-letter, în care ajung comenzile procesate cu eroare. */
export const COADA_DLQ = "comenzi-dlq";

/**
 * Creează un client SQS configurat pentru LocalStack (nu pentru AWS real).
 * Diferența față de un client normal: `endpoint` arată spre localhost:4566
 * și credențialele sunt niște valori fictive ("test"/"test"), pentru că
 * LocalStack nu face autentificare reală.
 */
export function creeazaClientSqs(): SQSClient {
  return new SQSClient({
    endpoint: ENDPOINT_LOCALSTACK,
    region: REGIUNE,
    credentials: {
      accessKeyId: "test",
      secretAccessKey: "test",
    },
  });
}

/**
 * Rezolvă URL-ul unei cozi pornind de la numele ei (apel GetQueueUrl).
 *
 * De ce e nevoie: majoritatea operațiilor SQS cer `QueueUrl`, nu numele cozii.
 * Dacă coada nu există, LocalStack răspunde cu eroarea "QueueDoesNotExist";
 * noi o transformăm într-un mesaj în română care spune exact ce trebuie rulat.
 */
export async function obtineUrlCoada(client: SQSClient, numeCoada: string): Promise<string> {
  let raspuns;
  try {
    raspuns = await client.send(new GetQueueUrlCommand({ QueueName: numeCoada }));
  } catch (eroare) {
    if (esteCoadaInexistenta(eroare)) {
      throw new Error(
        `Coada "${numeCoada}" nu există în LocalStack.\n` +
          `Rulează mai întâi "npm run setup" (adică scripts/01-create-queues.sh).`
      );
    }
    if (esteLocalStackOprit(eroare)) {
      throw new Error(
        `Nu mă pot conecta la LocalStack pe ${ENDPOINT_LOCALSTACK}.\n` +
          `Verifică dacă e pornit: "docker compose up -d" și apoi "docker compose ps".`
      );
    }
    // Orice altă eroare o lăsăm mai departe, ca să nu ascundem problema reală.
    throw eroare;
  }

  if (!raspuns.QueueUrl) {
    throw new Error(`LocalStack nu a returnat URL-ul cozii "${numeCoada}".`);
  }
  return raspuns.QueueUrl;
}

/** True dacă eroarea înseamnă "coada nu există" (AWS sau LocalStack). */
function esteCoadaInexistenta(eroare: unknown): boolean {
  const e = eroare as { name?: string; message?: string } | undefined;
  const nume = e?.name ?? "";
  const mesaj = e?.message ?? "";
  return (
    nume === "QueueDoesNotExist" ||
    nume === "AWS.SimpleQueueService.NonExistentQueue" ||
    mesaj.includes("NonExistentQueue")
  );
}

/** True dacă eroarea înseamnă "nu am cu cine vorbi" (LocalStack oprit). */
function esteLocalStackOprit(eroare: unknown): boolean {
  const e = eroare as { name?: string; code?: string; message?: string } | undefined;
  const text = `${e?.name ?? ""} ${e?.code ?? ""} ${e?.message ?? ""}`;
  return (
    text.includes("ECONNREFUSED") ||
    text.includes("ENOTFOUND") ||
    text.includes("EndpointError")
  );
}
