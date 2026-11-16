// src/types.ts
// Tipurile partajate de producer și consumer.
// Mesajul din SQS este text; noi îl scriem ca JSON pentru tipul de mai jos.

/**
 * O comandă (order) trimisă prin coada SQS.
 *
 * - id:     identificatorul comenzii, ex. "CMD-003"
 * - client: numele clientului
 * - total:  suma de plată (în lei)
 * - valida: dacă este false, consumer-ul o tratează intenționat ca eșec,
 *           ca să demonstrăm reîncercările SQS și mutarea în DLQ.
 */
export type Comanda = {
  id: string;
  client: string;
  total: number;
  valida: boolean;
};
