# MCP 통합 (Claude Desktop / Cursor)

hubNote 를 **MCP (Model Context Protocol) 서버** 로 노출해서, Claude Desktop / Cursor / Codex 같은 외부 LLM 클라이언트에서 자연어로 hubNote 워크스페이스를 조작할 수 있습니다.

한 번 셋업하면 자연어로 다음과 같은 작업이 됩니다.

- "Engineering 워크스페이스에 'Q2 OKR' 페이지 만들고 KR1, KR2, KR3 하위 페이지로 자동 생성해줘"
- "어제 회의록 페이지에 액션 아이템 표 추가해줘. 담당자별로 정리해서"
- "이 코드 변경사항을 요약해서 hubNote 의 Engineering 워크스페이스에 changelog 페이지로 작성"

## 작동 방식

이 문서가 안내하는 것은 **외부 도구가 hubNote 를 사용하는 흐름** 입니다.

1. 사용자가 hubNote 에서 개인 API 키를 발급
2. Claude Desktop (또는 Cursor / Codex) 의 설정 파일에 hubNote MCP 서버 한 블록 추가
3. 클라이언트 재시작 — 도구 목록이 자동으로 LLM 에게 노출됩니다
4. 사용자는 자연어로 명령. LLM 이 알아서 도구를 호출, hubNote 백엔드가 권한 게이트 적용

비용은 사용자 본인의 LLM 구독 (Claude Pro / Cursor Pro 등). hubNote 운영자는 토큰 비용을 부담하지 않습니다.

## API 키 발급

1. hubNote 에 로그인 → 우상단 프로필 → "계정 설정"
2. 좌측 사이드바에서 "API 키" 탭 클릭
3. "+ 새 API 키 발급" → 라벨 입력 (예: `claude-mac`, `cursor-work`)
4. 발급된 키 (예: `hbn_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`) 를 안전한 곳에 복사
5. 키는 **이 시점에 한 번만 화면에 표시** 됩니다. 분실 시 새로 발급해야 합니다

키의 권한 = 본인 hubNote 계정의 모든 권한. 본인이 속한 모든 워크스페이스에 대해 동일하게 적용됩니다.

## Claude Desktop 셋업

설정 파일 위치:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

다음 블록을 추가합니다 (`mcpServers` 가 이미 있으면 그 안에 hubnote 만 추가).

```json
{
  "mcpServers": {
    "hubnote": {
      "command": "npx",
      "args": ["-y", "@hubnote-mcp/server"],
      "env": {
        "HUBNOTE_API_KEY": "hbn_여기에본인키"
      }
    }
  }
}
```

저장 후 Claude Desktop **완전 종료 → 재시작**. 채팅창 하단의 도구 아이콘에 hubNote 도구 목록이 보이면 성공.

## Cursor 셋업

Cursor 는 Claude Desktop 과 같은 MCP 표준을 지원합니다. Settings → MCP 패널에서 같은 형식으로 추가하거나, `~/.cursor/mcp.json` 에 직접 입력.

## Codex (Anthropic Codex) 셋업

Codex 의 설정 파일에 같은 형식 (`mcpServers`) 으로 추가. Codex 가 stdio 트랜스포트를 지원하면 자동 작동.

## 도구 레퍼런스 (14개)

LLM 이 자동으로 골라서 호출합니다. 사용자가 직접 호출 형식을 외울 필요 없음.

### 워크스페이스 / 페이지

- **`list_workspaces`** — 본인 워크스페이스 목록
- **`list_pages`** — 한 워크스페이스의 페이지 트리
- **`get_page`** — 페이지 본문 (Markdown 변환) + 메타
- **`search_pages`** — PGroonga 한국어 풀텍스트 검색
- **`create_page`** — 새 BlockNote 페이지 (`parent_id` 로 하위 페이지)
- **`update_page`** — 제목 / 본문 수정 (Yjs 호환 snapshot)
- **`archive_page`** — 보관함 이동 (복원 가능)
- **`set_page_visibility`** — 공유 ↔ 비공개

### 데이터 row

- **`list_data_rows`** — 워크스페이스 데이터 row 목록
- **`create_data_row`** — 새 row
- **`update_data_row`** — row 부분 수정
- **`delete_data_row`** — row 삭제 (즉시, 복원 불가)

### 도움말 / 사용자

- **`search_help`** — 도움말 13문서 자체 검색 (LLM 이 hubNote 사용법 모를 때 자가 학습)
- **`current_user`** — 본인 정보

## 콘텐츠 형식

페이지 본문은 hubNote 내부에서 **BlockNote JSON** 으로 저장되지만, MCP 도구는 **Markdown** 으로 입출력합니다. LLM 이 다루기 자연스럽게 자동 변환.

지원되는 Markdown 요소:

- 헤딩 (H1~H3)
- 단락
- 글머리 / 번호 / 체크박스 목록
- 인용 (`>`)
- 코드 블록 (펜스드, 언어 지정 가능)
- 표 (GFM 형식)
- 이미지 (`![alt](url)`)
- 구분선 (`---`)
- 인라인 굵게 / 기울임 / 취소선 / 코드 / link / `@username` 멘션

**한계**: BlockNote 의 callout 색상 / 표 헤더 스타일 등 일부 시각 props 는 round-trip 시 손실.

## 권한과 안전

- API 키는 본인 권한 그대로. LLM 이 갑자기 다른 사용자의 데이터에 접근할 수 없습니다
- 권한 없는 작업 시도 시 백엔드가 403 반환 → 도구가 친절한 에러로 LLM 에게 전달
- Claude Desktop / Cursor 는 도구 호출 전 사용자 확인 prompt 를 띄웁니다 (기본). "Always allow" 로 자동화 가능
- 키 폐기는 즉시 — 계정 설정의 "API 키" 탭에서 폐기 버튼

### 위험 작업

- `archive_page` 는 **soft delete** (복원 가능)
- 페이지 본문 수정은 Yjs 협업으로 다른 사람 변경과 머지
- **`delete_data_row` 는 즉시 삭제 + 복원 불가** — Claude Desktop 의 confirm prompt 가 1차 방어

## 알려진 한계 (1차 스코프)

다음은 v1 에서 의도적으로 제외되었습니다.

- **HTML View 페이지 작성 / 편집** — LLM 이 자동 작성한 JS 가 워크스페이스 다른 멤버 브라우저에서 실행될 위험
- **데이터베이스 카드 / view 조작** — linked-database 시맨틱이 LLM 입장에서 모델링 어려움
- **멘션 알림 자동 발송** — `update_page` 가 멘션을 본문에 추가해도 알림 트리거되지 않습니다
- **외부 호스팅 서버** — 현재는 로컬 stdio 만 (사용자 PC 에서 실행). Remote MCP server 는 후속 사이클
- **워크스페이스별 scope 키** — 키는 본인의 모든 워크스페이스 권한 그대로

## 문제 해결

### "도구가 안 보여요"

- Claude Desktop 을 완전히 종료 → 재시작했나요? (창만 닫는 게 아니라)
- `claude_desktop_config.json` 의 JSON 형식이 valid 한지 확인
- 키가 `hbn_` 로 시작하는지

### "auth_failed 에러"

- 키가 폐기된 상태일 수 있습니다. 계정 설정의 "API 키" 탭에서 마지막 사용 시간 확인 후 새로 발급

### "permission_denied 에러"

- 본인이 그 워크스페이스의 멤버인지 확인
- 권한이 부족한 작업일 수 있습니다 (예: 다른 사람의 페이지 편집 — `page.edit` 권한 필요)
- 자세한 권한 모델은 [역할과 권한](/help/roles-permissions) 참조

### "Network error"

- 키 환경 변수의 `HUBNOTE_URL` 가 정확한지 (`https://notion.discof.com`, 기본값)
- 인터넷 연결 / DNS / 방화벽 확인

## 키 관리 권장

- 클라이언트별로 다른 키 발급 (`claude-mac`, `cursor-work` 등) — 한 곳 노출 시 그 키만 폐기
- 정기적 회전 (분기에 한 번 정도)
- 사용 안 하는 키는 즉시 폐기 — "마지막 사용" 컬럼이 한 달 이상 비어있으면 후보
- 키 발급 시 표시되는 plain text 는 비밀번호 매니저 (1Password / Bitwarden) 에 저장

## 참고

- 패키지 소스: https://github.com/wlzerd/open-notion/tree/main/packages/mcp
- MCP 표준: https://modelcontextprotocol.io
- 문제 보고: support@discof.com
