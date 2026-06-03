// =====================
// API base URL
// =====================
// Local dev: http://localhost:5000/api
// Production (Vercel): VITE_API_URL avy amin'ny env
const DEFAULT_API_URL = import.meta.env.DEV
  ? "http://localhost:5000/api"
  : "https://upbeat-learning-production-be16.up.railway.app/api";

function normalizeApiUrl(value) {
  const raw = String(value || DEFAULT_API_URL).trim().replace(/\/+$/, "");
  if (!raw) return DEFAULT_API_URL;

  const withProtocol = raw.startsWith("//")
    ? `https:${raw}`
    : /^[a-z][a-z\d+\-.]*:\/\//i.test(raw)
      ? raw
      : raw.startsWith("localhost") || raw.startsWith("127.0.0.1")
        ? `http://${raw}`
        : `https://${raw}`;

  const url = new URL(withProtocol);
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/api";
  } else if (!url.pathname.replace(/\/+$/, "").endsWith("/api")) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/api`;
  }

  return url.toString().replace(/\/$/, "");
}

const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL);

// =====================
// API helper
// =====================
export async function api(path, options = {}) {
  const token = localStorage.getItem("cp_token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  let response;
  let data;

  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch (err) {
    console.error("❌ Network error:", err);
    throw new Error("Impossible de contacter le serveur");
  }

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  // Debug log (utile pour Vercel)
  console.log("📡 API response:", response.status, data);

  if (!response.ok) {
    throw new Error(data.message || `Erreur API (${response.status})`);
  }

  // Fallback si data vide
  if (data === null || typeof data !== "object") {
    return {};
  }

  return data;
}

// =====================
// IndexedDB (Offline)
// =====================
const DB_NAME = "cash-point-offline";
const QUEUE_STORE = "queue";
const CACHE_STORE = "cache";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

// =====================
// Queue helpers
// =====================
export async function queueOperation(op) {
  return queueRequest({
    type: "operation",
    payload: op.payload,
    createdAt: op.createdAt || new Date().toISOString(),
  });
}

export async function queueRequest(request) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).add(request);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getQueuedOperations() {
  const queue = await getQueuedRequests();
  return queue.filter((x) => x.type === "operation");
}

export async function getQueuedRequests() {
  const db = await openDB();
  const ops = await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return ops.sort((a, b) => (a.id || 0) - (b.id || 0));
}

export async function clearQueuedOperations() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    const store = tx.objectStore(QUEUE_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      (req.result || [])
        .filter((x) => x.type === "operation")
        .forEach((x) => store.delete(x.id));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function removeQueuedRequest(id) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// =====================
// Cache helpers
// =====================
export async function cacheSet(key, value) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readwrite");
    tx.objectStore(CACHE_STORE).put({
      key,
      value,
      updatedAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function cacheGet(key) {
  const db = await openDB();
  const row = await new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readonly");
    const req = tx.objectStore(CACHE_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return row?.value || null;
}

export async function clearAllQueue() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
