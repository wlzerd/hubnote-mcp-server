# @hubnote-mcp/server

MCP (Model Context Protocol) server for hubNote — connect Claude Desktop,
Cursor, Codex, or any MCP client to your hubNote workspaces.

Once installed, you can ask your LLM to:

- "Create a page in my Engineering workspace called 'Q2 OKR' with KR1, KR2, KR3 as sub-pages"
- "Find all meeting notes with action items past due"
- "Summarize the design review and post it as a new page"

## Installation

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "hubnote": {
      "command": "npx",
      "args": ["-y", "@hubnote-mcp/server"],
      "env": {
        "HUBNOTE_API_KEY": "hbn_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Restart Claude Desktop. The hubNote tools should appear in the tool
picker.

### Get an API Key

1. Sign in to https://notion.discof.com
2. Account settings → "API 키" tab
3. "+ 새 API 키 발급" — copy the key (shown only once)

The key carries your full hubNote permissions for all your workspaces.
Revoke at any time from the same panel.

## Available Tools

(Implemented in Phase 6 — see `collab_guide/plans/mcp_integration.md`)

- `list_workspaces`, `list_pages`, `get_page`, `search_pages`
- `create_page`, `update_page`, `archive_page`, `set_page_visibility`
- `list_data_rows`, `create_data_row`, `update_data_row`, `delete_data_row`
- `search_help`, `current_user`

## Documentation

- Full setup + tool reference: https://notion.discof.com/help/mcp-integration
- Source: https://github.com/wlzerd/hubnote-mcp-server

## Limits & Safety

- HTML View pages cannot be created/edited via MCP (security: LLM-authored JS would run in other members' browsers)
- Database card / view manipulation excluded in v1
- Page archive is soft (recoverable from "보관함")
- Data row deletion is immediate — Claude Desktop's confirm dialog is your safety net

## License

MIT
