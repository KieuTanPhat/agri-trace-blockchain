import { mockBatches, mockDashboard, mockSendSensorReading, mockSubmitCommand } from "./mock-api.mjs";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api";
const USE_MOCK_API = process.env.NEXT_PUBLIC_MOCK_API !== "false";
export async function getDashboard() {
    if (USE_MOCK_API)
        return mockDashboard();
    return request("/dashboard");
}
export async function getBatches() {
    if (USE_MOCK_API)
        return mockBatches;
    return request("/batches");
}
export async function getBatchById(batchId) {
    if (USE_MOCK_API) {
        return mockBatches.find((batch) => batch.batchId === batchId) ?? mockBatches[0];
    }
    return request(`/batches/${batchId}`);
}
export async function getPublicTrace(batchId) {
    if (USE_MOCK_API) {
        return mockBatches.find((batch) => batch.batchId === batchId || batch.batchCode === batchId) ?? null;
    }
    return request(`/public/trace/${batchId}`);
}
export async function submitCommand(batchId, command) {
    if (USE_MOCK_API)
        return mockSubmitCommand(batchId, command);
    return request(`/batches/${batchId}/commands/${command}`, { method: "POST" });
}
export async function sendSensorReading(payload) {
    if (USE_MOCK_API)
        return mockSendSensorReading(payload);
    return request("/iot/readings", {
        method: "POST",
        body: JSON.stringify(payload)
    });
}
async function request(path, init) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: {
            "content-type": "application/json",
            ...(init?.headers ?? {})
        },
        ...init
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({
            status: response.status,
            code: "HTTP_ERROR",
            message: response.statusText
        }));
        throw error;
    }
    return response.json();
}
