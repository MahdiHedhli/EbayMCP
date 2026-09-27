import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import worker, { type WorkerEnv } from "../src/worker.js";

const token = "synthetic-local-test-token-at-least-32-characters";
const env = { MCP_BEARER_TOKEN: token, DB: {} } as WorkerEnv;

describe("Worker MCP route", () => {
  it("fails closed before any MCP or D1 work", async () => {
    const unauthorized = await worker.fetch(new Request("https://example.invalid/mcp"), env);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect((await worker.fetch(new Request("https://example.invalid/other"), env)).status).toBe(404);
    expect((await worker.fetch(new Request("https://example.invalid/mcp", {
      headers: { Authorization: `Bearer ${token}`, Origin: "https://evil.invalid" },
    }), env)).status).toBe(403);
  });

  it("initializes a Streamable HTTP MCP session on /mcp", async () => {
    const response = await worker.fetch(new Request("https://example.invalid/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "synthetic-test-client", version: "0.1.0" },
        },
      }),
    }), env);
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(body).toContain("ebay-manager");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
