// MCP 도구 정의 + 등록. 14개 도구를 한 파일에 모음 (분량 적정,
// 외부 import 한 군데에서 처리).
//
// 각 도구는 hubNote REST API 의 한 endpoint 를 wrap. 응답은 LLM 친화적
// JSON 형태로 정규화 (BlockNote JSON 은 마크다운으로 변환). 4xx/5xx 는
// HubNoteError 로 정규화되어 friendly text 로 LLM 에 전달.

import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { HubNoteClient, HubNoteError } from "./client.js";
import { HELP_CONTENT } from "./help-content.js";
import { blocksToMarkdown, markdownToBlocks } from "./markdown.js";
import type {
  DataRow,
  Page,
  PageContent,
  SearchHit,
  User,
  Workspace,
} from "./types.js";

// ──────────────────────────────────────────────────────────────────
// Tool catalog (advertised to MCP clients via ListTools)
// ──────────────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: "list_workspaces",
    description:
      "List all hubNote workspaces the authenticated user belongs to. Returns id / name / type (personal | team) for each — use the id with other tools.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_pages",
    description:
      "List the page tree of a workspace (DFS-flattened). Each entry has id / title / type (blocknote | html_view | database) / parent_id / visibility / archived.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: {
          type: "string",
          description: "Workspace UUID (from list_workspaces).",
        },
      },
      required: ["workspace_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_page",
    description:
      "Fetch one page's metadata + body. The body is returned as Markdown (converted from BlockNote JSON). HTML View pages are not supported via MCP.",
    inputSchema: {
      type: "object",
      properties: { page_id: { type: "string" } },
      required: ["page_id"],
      additionalProperties: false,
    },
  },
  {
    name: "search_pages",
    description:
      "Full-text search pages the user has access to (PGroonga, Korean-aware). Returns ranked hits with title and snippet.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        workspace_id: {
          type: "string",
          description: "Optional — limit to one workspace.",
        },
        limit: { type: "number", default: 10, minimum: 1, maximum: 50 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "create_page",
    description:
      "Create a new BlockNote page in a workspace. Optional parent_id makes it a sub-page. Optional content_markdown seeds the body (converted to BlockNote blocks).",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        title: { type: "string" },
        parent_id: {
          type: "string",
          description: "Optional parent page UUID for sub-page.",
        },
        content_markdown: {
          type: "string",
          description: "Optional initial body in Markdown.",
        },
        visibility: {
          type: "string",
          enum: ["shared", "private"],
          description: "Default 'shared' for team workspaces.",
        },
      },
      required: ["workspace_id", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "update_page",
    description:
      "Update a page's title and/or body. Body uses the snapshot endpoint (Yjs-compatible — mention notifications are NOT triggered for body-only edits via this tool).",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
        title: { type: "string" },
        content_markdown: {
          type: "string",
          description: "Replaces the entire body when provided.",
        },
      },
      required: ["page_id"],
      additionalProperties: false,
    },
  },
  {
    name: "archive_page",
    description:
      "Move a page to the archive (soft delete — recoverable from the '보관함' UI in hubNote).",
    inputSchema: {
      type: "object",
      properties: { page_id: { type: "string" } },
      required: ["page_id"],
      additionalProperties: false,
    },
  },
  {
    name: "set_page_visibility",
    description:
      "Toggle a page between 'shared' (workspace members) and 'private' (creator only).",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
        visibility: { type: "string", enum: ["shared", "private"] },
      },
      required: ["page_id", "visibility"],
      additionalProperties: false,
    },
  },
  {
    name: "list_data_rows",
    description:
      "List workspace-scoped data rows. Each row is a free-form JSON object — fields vary per workspace. Use the Schema panel in hubNote (or sample one row) to learn the field shape.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        limit: { type: "number", default: 50, minimum: 1, maximum: 500 },
      },
      required: ["workspace_id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_data_row",
    description:
      "Create a new workspace data row. `fields` is a free-form JSON object — match the existing schema by sampling a row first.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        fields: {
          type: "object",
          description: "Free-form key-value object.",
          additionalProperties: true,
        },
      },
      required: ["workspace_id", "fields"],
      additionalProperties: false,
    },
  },
  {
    name: "update_data_row",
    description:
      "Patch fields of a workspace data row. Only the keys in `fields` are modified; other keys are preserved.",
    inputSchema: {
      type: "object",
      properties: {
        row_id: { type: "string" },
        fields: {
          type: "object",
          description: "Partial fields to merge into the row.",
          additionalProperties: true,
        },
      },
      required: ["row_id", "fields"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_data_row",
    description:
      "Delete a workspace data row. IMMEDIATE — there is no archive / undo. Use with care.",
    inputSchema: {
      type: "object",
      properties: { row_id: { type: "string" } },
      required: ["row_id"],
      additionalProperties: false,
    },
    annotations: {
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  {
    name: "search_help",
    description:
      "Search hubNote's official help docs (13 articles) for usage info. Useful when unsure how a hubNote feature works (workspaces / pages / database / HTML View / permissions etc).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", default: 5, minimum: 1, maximum: 13 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "current_user",
    description:
      "Return the authenticated hubNote user's id / username / display_name / email / is_admin.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

interface ToolResponse {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function ok(data: unknown): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function err(error: unknown): ToolResponse {
  if (error instanceof HubNoteError) {
    return {
      content: [
        {
          type: "text",
          text: `Error (${error.code}): ${error.message}`,
        },
      ],
      isError: true,
    };
  }
  const msg = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${msg}` }],
    isError: true,
  };
}

function pageOut(page: Page): Record<string, unknown> {
  return {
    id: page.id,
    workspace_id: page.workspace_id,
    parent_id: page.parent_id,
    title: page.title,
    type: page.type,
    visibility: page.visibility,
    archived: page.archived_at !== null,
    created_at: page.created_at,
    updated_at: page.updated_at,
  };
}

// ──────────────────────────────────────────────────────────────────
// Tool implementations
// ──────────────────────────────────────────────────────────────────

async function listWorkspaces(client: HubNoteClient): Promise<ToolResponse> {
  const rows = await client.request<Workspace[]>("/workspaces");
  return ok(
    rows.map((w) => ({
      id: w.id,
      name: w.name,
      type: w.type,
    })),
  );
}

async function listPages(
  client: HubNoteClient,
  args: { workspace_id: string },
): Promise<ToolResponse> {
  const pages = await client.request<Page[]>(
    `/workspaces/${args.workspace_id}/pages/tree`,
  );
  return ok(pages.map(pageOut));
}

async function getPage(
  client: HubNoteClient,
  args: { page_id: string },
): Promise<ToolResponse> {
  const page = await client.request<Page>(`/pages/${args.page_id}`);

  if (page.type === "html_view") {
    throw new HubNoteError(
      "HTML View pages cannot be read via MCP. Open the page in hubNote directly.",
      "validation",
      400,
    );
  }

  let content_markdown = "";
  if (page.type === "blocknote") {
    const content = await client.request<PageContent>(
      `/pages/${page.id}/content`,
    );
    content_markdown = blocksToMarkdown(content.blocks);
  }

  return ok({
    ...pageOut(page),
    content_markdown,
  });
}

async function searchPagesTool(
  client: HubNoteClient,
  args: { query: string; workspace_id?: string; limit?: number },
): Promise<ToolResponse> {
  const query: Record<string, string | number> = { q: args.query };
  if (args.workspace_id) query.workspace_id = args.workspace_id;
  if (args.limit) query.limit = args.limit;
  const result = await client.request<{ items: SearchHit[]; total: number }>(
    "/search",
    { query },
  );
  return ok({
    total: result.total,
    items: result.items,
  });
}

async function createPage(
  client: HubNoteClient,
  args: {
    workspace_id: string;
    title: string;
    parent_id?: string;
    content_markdown?: string;
    visibility?: "shared" | "private";
  },
): Promise<ToolResponse> {
  const body: Record<string, unknown> = { title: args.title };
  if (args.parent_id) body.parent_id = args.parent_id;
  if (args.visibility) body.visibility = args.visibility;

  const page = await client.request<Page>(
    `/workspaces/${args.workspace_id}/pages`,
    { method: "POST", body },
  );

  if (args.content_markdown) {
    const blocks = markdownToBlocks(args.content_markdown);
    // 새 페이지의 본문은 version 0 부터. seed 된 후 사용자가 hubNote 에서
    // 열면 Yjs 가 그 시점부터 동기화 시작.
    await client.request(`/pages/${page.id}/content`, {
      method: "PUT",
      body: { blocks, version: 0 },
    });
  }

  return ok({
    id: page.id,
    title: page.title,
    parent_id: page.parent_id,
    workspace_id: page.workspace_id,
  });
}

async function updatePage(
  client: HubNoteClient,
  args: {
    page_id: string;
    title?: string;
    content_markdown?: string;
  },
): Promise<ToolResponse> {
  if (args.title !== undefined) {
    await client.request(`/pages/${args.page_id}`, {
      method: "PATCH",
      body: { title: args.title },
    });
  }
  if (args.content_markdown !== undefined) {
    const blocks = markdownToBlocks(args.content_markdown);
    // snapshot endpoint — Yjs 활성 페이지 호환, version 안 봄, mention diff X
    await client.request(`/pages/${args.page_id}/content/snapshot`, {
      method: "PUT",
      body: { blocks },
    });
  }
  return ok({ ok: true });
}

async function archivePage(
  client: HubNoteClient,
  args: { page_id: string },
): Promise<ToolResponse> {
  await client.request(`/pages/${args.page_id}`, { method: "DELETE" });
  return ok({
    ok: true,
    note: "Page moved to archive (soft delete). Recoverable from '보관함' in hubNote.",
  });
}

async function setPageVisibility(
  client: HubNoteClient,
  args: { page_id: string; visibility: "shared" | "private" },
): Promise<ToolResponse> {
  await client.request(`/pages/${args.page_id}`, {
    method: "PATCH",
    body: { visibility: args.visibility },
  });
  return ok({ ok: true });
}

async function listDataRows(
  client: HubNoteClient,
  args: { workspace_id: string; limit?: number },
): Promise<ToolResponse> {
  const query: Record<string, string | number> = {};
  if (args.limit) query.limit = args.limit;
  const rows = await client.request<DataRow[]>(
    `/workspaces/${args.workspace_id}/data-rows`,
    { query },
  );
  return ok(rows);
}

async function createDataRow(
  client: HubNoteClient,
  args: { workspace_id: string; fields: Record<string, unknown> },
): Promise<ToolResponse> {
  const row = await client.request<DataRow>(
    `/workspaces/${args.workspace_id}/data-rows`,
    { method: "POST", body: { fields: args.fields } },
  );
  return ok({ id: row.id });
}

async function updateDataRow(
  client: HubNoteClient,
  args: { row_id: string; fields: Record<string, unknown> },
): Promise<ToolResponse> {
  const row = await client.request<DataRow>(
    `/data-rows/${args.row_id}`,
    { method: "PATCH", body: { fields: args.fields } },
  );
  return ok({ id: row.id, updated_at: row.updated_at });
}

async function deleteDataRow(
  client: HubNoteClient,
  args: { row_id: string },
): Promise<ToolResponse> {
  await client.request(`/data-rows/${args.row_id}`, { method: "DELETE" });
  return ok({ ok: true, note: "Data row deleted permanently." });
}

async function searchHelp(args: {
  query: string;
  limit?: number;
}): Promise<ToolResponse> {
  const limit = args.limit ?? 5;
  const queryLower = args.query.toLowerCase().trim();
  if (!queryLower) {
    return ok([]);
  }

  interface Match {
    slug: string;
    title: string;
    score: number;
    excerpt: string;
    url: string;
  }
  const matches: Match[] = [];

  for (const [slug, content] of Object.entries(HELP_CONTENT)) {
    const lowerContent = content.toLowerCase();
    const occurrences = lowerContent.split(queryLower).length - 1;
    if (occurrences === 0) continue;

    const titleMatch = /^#\s+(.+?)\s*$/m.exec(content);
    const title = titleMatch ? titleMatch[1] : slug;

    const idx = lowerContent.indexOf(queryLower);
    const start = Math.max(0, idx - 60);
    const end = Math.min(content.length, idx + queryLower.length + 140);
    const excerpt = content.slice(start, end).replace(/\n+/g, " ").trim();

    matches.push({
      slug,
      title,
      score: occurrences,
      excerpt,
      url: `https://notion.discof.com/help/${slug}`,
    });
  }

  matches.sort((a, b) => b.score - a.score);
  return ok(matches.slice(0, limit));
}

async function currentUser(client: HubNoteClient): Promise<ToolResponse> {
  const me = await client.request<User>("/users/me");
  return ok({
    id: me.id,
    username: me.username,
    display_name: me.display_name,
    email: me.email,
    is_admin: me.is_admin,
  });
}

// ──────────────────────────────────────────────────────────────────
// Registration
// ──────────────────────────────────────────────────────────────────

export function registerTools(server: Server, client: HubNoteClient): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // SDK 1.0.x 의 CallToolRequestSchema response 타입은 `task` / `content`
  // 등을 포함한 큰 union 이라 우리 ToolResponse 와 정확 매치되지 않습니다.
  // 실제 spec 상 `{ content, isError? }` 만으로도 호환되므로 outer
  // assertion 으로 호환 처리합니다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
    const { name, arguments: rawArgs = {} } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    try {
      switch (name) {
        case "list_workspaces":
          return await listWorkspaces(client);
        case "list_pages":
          return await listPages(client, args as { workspace_id: string });
        case "get_page":
          return await getPage(client, args as { page_id: string });
        case "search_pages":
          return await searchPagesTool(client, args as {
            query: string;
            workspace_id?: string;
            limit?: number;
          });
        case "create_page":
          return await createPage(client, args as {
            workspace_id: string;
            title: string;
            parent_id?: string;
            content_markdown?: string;
            visibility?: "shared" | "private";
          });
        case "update_page":
          return await updatePage(client, args as {
            page_id: string;
            title?: string;
            content_markdown?: string;
          });
        case "archive_page":
          return await archivePage(client, args as { page_id: string });
        case "set_page_visibility":
          return await setPageVisibility(client, args as {
            page_id: string;
            visibility: "shared" | "private";
          });
        case "list_data_rows":
          return await listDataRows(client, args as {
            workspace_id: string;
            limit?: number;
          });
        case "create_data_row":
          return await createDataRow(client, args as {
            workspace_id: string;
            fields: Record<string, unknown>;
          });
        case "update_data_row":
          return await updateDataRow(client, args as {
            row_id: string;
            fields: Record<string, unknown>;
          });
        case "delete_data_row":
          return await deleteDataRow(client, args as { row_id: string });
        case "search_help":
          return await searchHelp(args as { query: string; limit?: number });
        case "current_user":
          return await currentUser(client);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return err(error);
    }
  });
}
