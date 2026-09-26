// Stable client-generated id for offline creates. The SAME id must survive
// every retry of a create so the backend can deduplicate by
// (boat_id, client_local_id). Never regenerate it for an existing operation.
// No extra dependency: timestamp + random suffix (ULID/UUID-shaped enough).

function randomSuffix(len: number): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// e.g. "loc-1790453497243-8f3ka0zq"
export function newLocalId(): string {
  return `loc-${Date.now()}-${randomSuffix(8)}`;
}

// Local queue row id.
export function newQueueId(): string {
  return `q-${Date.now()}-${randomSuffix(10)}`;
}
