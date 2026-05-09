#!/usr/bin/env node
// hubNote MCP server entrypoint.
//
// stdio 트랜스포트를 사용해 Claude Desktop / Cursor / Codex 등의
// MCP 클라이언트에 연결됩니다. 환경 변수에서 API key 와 hubNote URL
// 을 읽어 백엔드와 통신합니다.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { HubNoteClient } from "./client.js";
import { registerTools } from "./tools.js";

const apiKey = process.env.HUBNOTE_API_KEY;
const baseUrl = process.env.HUBNOTE_URL ?? "https://notion.discof.com";

if (!apiKey) {
  // stderr 로 출력 — stdout 은 MCP 프로토콜 전용. console.error 만 사용.
  console.error(
    "HUBNOTE_API_KEY environment variable is required.\n" +
      "Get a key from your hubNote account settings → API 키 tab.\n" +
      "See https://notion.discof.com/help/mcp-integration",
  );
  process.exit(1);
}

let client: HubNoteClient;
try {
  client = new HubNoteClient({ apiKey, baseUrl });
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const server = new Server(
  {
    name: "hubnote",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

registerTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);

// Graceful shutdown — Claude Desktop 이 SIGTERM 보내면 깨끗이 종료.
process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});
