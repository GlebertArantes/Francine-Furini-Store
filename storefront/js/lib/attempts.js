// Guarda somente IDs, canal e quantidades; nunca cliente, endereço ou pagamento.
export function attemptStore(storage, key) {
  return {
    read() { const raw=storage.getItem(key); if (!raw) return null; const v=JSON.parse(raw); if (!v?.id) throw new Error("attempt_storage_invalid"); return v; },
    write(value) { const raw=JSON.stringify(value); storage.setItem(key,raw); if(storage.getItem(key)!==raw) throw new Error("attempt_storage_unavailable"); },
    clear() { storage.removeItem(key); if(storage.getItem(key)) throw new Error("attempt_storage_unavailable"); },
  };
}
export async function attemptLock(name, fn) {
  if (!globalThis.navigator?.locks?.request) throw new Error("attempt_lock_unavailable");
  return navigator.locks.request(name, fn);
}
