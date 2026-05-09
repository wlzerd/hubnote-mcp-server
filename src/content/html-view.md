# HTML View

HTML View 는 워크스페이스 멤버가 직접 HTML / CSS / JavaScript 를 작성해서 만든 커스텀 페이지입니다. 워크스페이스 데이터 row, 파일, 페이지 목록 등 hubNote 의 데이터를 안전하게 다룰 수 있어 자체 대시보드 / 폼 / 위젯을 만드는 용도로 쓰입니다.

직접 코드를 작성하는 사람은 [HTML View 개발자 가이드](/help/html-view-developer) 를 함께 보세요. 이 문서는 일반 사용자 안내 + 보안 제약 요약입니다.

## 만들기

사이드바의 + 버튼 → "HTML 페이지 (실험)".

- 빈 HTML View 페이지가 만들어지고 자동으로 편집 모드로 진입합니다
- 사이드바 페이지명 옆에 코드 아이콘이 표시되어 일반 페이지와 구분됩니다

## 편집기

편집기는 세 개의 탭으로 구성됩니다.

- **HTML** — 본문 마크업
- **CSS** — 스타일
- **JS** — 동적 동작

오른쪽에 라이브 프리뷰가 있어 800ms 디바운스 후 자동 반영됩니다.

상단의 **Schema** 토글을 누르면 워크스페이스 데이터 row 의 필드 목록이 패널로 뜹니다 — 코드를 짤 때 어떤 필드가 있는지 빠르게 확인할 수 있습니다.

저장은 명시적으로 "저장" 버튼을 눌러야 됩니다 (자동 저장 없음). 저장하면 새 버전이 히스토리에 기록되고, 언제든 이전 버전으로 복원할 수 있습니다.

## 단축키

- **Cmd + E** (Mac) / **Ctrl + E** (Windows) — 보기와 편집 모드 토글

## 누가 편집할 수 있나

- **페이지 작성자** — 자동
- **워크스페이스 소유자** — 자동
- **다른 멤버** — 보기만 가능

작성자 + 소유자 외에는 편집 권한을 부여할 수 없습니다 (다른 사람이 작성한 코드의 보안 검토 책임을 분리하기 위해).

## 자동 제목

페이지 제목은 본인이 작성한 HTML 의 다음 위치에서 자동으로 추출됩니다.

- `<title>` 태그 (우선)
- `<meta name="hubnote-title" content="...">` (대안)

저장하면 사이드바의 페이지명에 자동 동기화됩니다. 둘 다 비워두면 기존 제목이 그대로 유지됩니다.

## 사이즈 한도

| 자원 | 한도 |
|---|---|
| HTML | 100KB |
| CSS | 50KB |
| JS | 50KB |

저장 시 한도를 초과하면 거부됩니다 — 코드 분할이 필요합니다.

## 보안 제약 (요약)

HTML View 는 격리된 sandbox iframe 안에서 실행됩니다. 다음 작업은 **불가능**합니다.

- 외부 URL 로 fetch / XMLHttpRequest / WebSocket 호출
- `<script src="https://cdn...">` 외부 스크립트 로드
- localStorage / sessionStorage / 쿠키 접근
- `window.parent` 등 부모 페이지 접근

대신 부모가 주입한 `window.ws` SDK 를 통해 워크스페이스 데이터 / 파일 / 페이지 목록에 접근합니다.

```javascript
const { items } = await window.ws.list();
const me = await window.ws.currentUser();
const { url } = await window.ws.uploadFile(file);
```

전체 SDK 메서드 / 보안 모델 / 이미지 처리 / 라이브러리 사용법은 [HTML View 개발자 가이드](/help/html-view-developer) 에 있습니다.

## 외부 이미지를 어떻게 넣나 (자주 묻는 점)

- 외부 https 이미지 — `<img src="https://...">` 그대로 사용 가능. 자동으로 백엔드 image-proxy 경유 (viewer IP 누설 차단)
- 자체 업로드 — `ws.uploadFile(file)` 호출 후 반환된 `/files/<uuid>` URL 을 `<img src>` 에 사용
- data URI — `<img src="data:image/png;base64,...">` 가능
- SVG 외부 hot-link 거부 (script 위험), 자체 업로드는 허용
- http (비-https) 거부

## 외부 라이브러리는

CDN `<script src>` 가 차단되니 라이브러리 코드를 JS 탭에 직접 붙여넣어야 합니다.

- 50KB JS 한도 주의 — chart.js minified 만 200KB 가까이 됩니다
- 가벼운 라이브러리 (uPlot, day.js 등) 또는 vanilla JS 권장
- 자세한 권장 사항은 [개발자 가이드](/help/html-view-developer) 참조

## 미지원 (1차 스코프)

다음은 일반 BlockNote 페이지에서는 되지만 HTML View 페이지에서는 안 됩니다.

- 외부 공유 링크 (`/share/<token>`) — 비-멤버에게 사용자 작성 JS 노출 위험
- 검색 인덱싱 — 본문이 코드라 검색 의미 없음
- 멘션 (`@`)
- 실시간 협업 — 단일 작성자, 마지막 저장이 이김 (충돌 시 새로고침 안내)
- 인쇄 / PDF 저장 — sandbox 안의 `window.print()` 가 부모로 전달되지 않음

## 실수로 깨뜨렸을 때

저장한 코드가 무한 루프에 빠지거나 오류로 화면이 새하얗게 변해도 페이지 데이터는 보존됩니다.

- 페이지 메뉴의 "편집" 으로 돌아가 코드를 고치거나
- 편집기의 "버전" 메뉴에서 이전 버전으로 복원
