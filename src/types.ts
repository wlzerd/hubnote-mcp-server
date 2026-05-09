// hubNote REST API 응답 형식 정의. 백엔드 (FastAPI) 의 Pydantic
// 스키마와 짝이 맞아야 합니다 — 변경 시 양쪽을 같이 갱신.

export interface User {
  id: string;
  username: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  is_admin: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  type: "personal" | "team";
  image_url: string | null;
  owner_id: string;
}

export type PageType = "blocknote" | "html_view" | "database";
export type PageVisibility = "shared" | "private";

export interface Page {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  type: PageType;
  visibility: PageVisibility;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// 페이지 본문은 BlockNote JSON 의 array 형식. 각 항목이 한 블록.
// MCP 측에서는 마크다운 ↔ 이 JSON 사이의 변환만 수행하고
// 구조 자체에 깊이 접근하지 않습니다.
export type BlockNoteJson = unknown[];

export interface PageContent {
  page_id: string;
  blocks: BlockNoteJson;
  version: number;
  updated_at: string;
}

export interface PageProperties {
  page_id: string;
  status: string | null;
  doc_type: string | null;
  tags: string[] | null;
  due_date: string | null;
  start_date: string | null;
  priority: "low" | "medium" | "high" | null;
}

export interface DataRow {
  id: string;
  workspace_id: string;
  fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface SearchHit {
  page_id: string;
  workspace_id: string;
  title: string;
  snippet: string;
  score: number;
}

export interface ApiErrorBody {
  detail?: string | Record<string, unknown>;
}
