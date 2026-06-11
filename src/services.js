import { Capacitor, CapacitorHttp } from "@capacitor/core";

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
const TOKEN_KEY = "cp_token";
const USER_KEY = "cp_user";
const SNAPSHOT_KEY = "snapshot";
const DB_NAME = "cash-point-offline";
const QUEUE_STORE = "queue";
const CACHE_STORE = "cache";
const isNative = Capacitor.isNativePlatform();

export async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  let response;
  let data;

  try {
    if (isNative) {
      let requestData = options.body;
      if (typeof requestData === "string" && requestData) {
        try {
          requestData = JSON.parse(requestData);
        } catch {
          // Keep non-JSON request bodies unchanged.
        }
      }
      const nativeResponse = await CapacitorHttp.request({
        url: `${API_URL}${path}`,
        method: options.method || "GET",
        headers,
        data: requestData,
        connectTimeout: 20000,
        readTimeout: 30000,
      });
      response = {
        ok: nativeResponse.status >= 200 && nativeResponse.status < 300,
        status: nativeResponse.status,
      };
      data = nativeResponse.data;
    } else {
      response = await fetch(`${API_URL}${path}`, { ...options, headers });
      try {
        data = await response.json();
      } catch {
        data = {};
      }
    }
  } catch (error) {
    console.error("Network error:", error);
    throw new Error(`Impossible de contacter le serveur (${new URL(API_URL).host})`, { cause: error });
  }

  if (!response.ok) {
    throw new Error(data?.message || `Erreur API (${response.status})`);
  }
  return data !== null && typeof data === "object" ? data : {};
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

export function saveStoredUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

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

export async function queueOperation(op) {
  return queueRequest({
    type: "operation",
    payload: op.payload,
    createdAt: op.createdAt || new Date().toISOString(),
  });
}

export async function queueRequest(request) {
  const db = await openDB();
  const ownerId = getStoredUser()?.id;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).add({ ...request, ownerId });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getQueuedOperations() {
  const queue = await getQueuedRequests();
  return queue.filter((item) => item.type === "operation");
}

export async function getQueuedRequests() {
  const db = await openDB();
  const ownerId = getStoredUser()?.id;
  const requests = await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return requests
    .filter((item) => item.ownerId === ownerId)
    .sort((a, b) => (a.id || 0) - (b.id || 0));
}

export async function clearQueuedOperations() {
  const db = await openDB();
  const ownerId = getStoredUser()?.id;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    const store = tx.objectStore(QUEUE_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      (req.result || [])
        .filter((item) => item.type === "operation" && item.ownerId === ownerId)
        .forEach((item) => store.delete(item.id));
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

export async function cacheSet(key, value) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readwrite");
    tx.objectStore(CACHE_STORE).put({ key, value, updatedAt: new Date().toISOString() });
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

export async function saveSnapshot(snapshot) {
  const userId = getStoredUser()?.id;
  await cacheSet(userId ? `${SNAPSHOT_KEY}:${userId}` : SNAPSHOT_KEY, snapshot);
}

export async function getSnapshot() {
  const userId = getStoredUser()?.id;
  if (userId) {
    const userSnapshot = await cacheGet(`${SNAPSHOT_KEY}:${userId}`);
    if (userSnapshot) return userSnapshot;
  }
  return cacheGet(SNAPSHOT_KEY);
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
