import axios from "axios";

const api = axios.create({
  baseURL: "/",
  timeout: 10000,
});

export async function getStatus() {
  const res = await api.get("/status");
  return res.data;
}

export async function getDevices() {
  const res = await api.get("/devices");
  return res.data;
}

export async function setConfig(cfg) {
  const res = await api.post("/config", cfg);
  return res.data;
}

export async function startStream() {
  await api.post("/stream/start");
}

export async function stopStream() {
  await api.post("/stream/stop");
}

// NEW
export async function peekPreview() {
  await api.post("/preview");
}
