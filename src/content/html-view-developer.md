# HTML View 개발자 가이드

이 문서는 [HTML View](/help/html-view) 페이지를 직접 작성하는 사람을 위한 레퍼런스입니다. 일반 사용자는 그쪽 페이지를 먼저 보세요.

## 보안 모델

HTML View 는 두 겹의 격리 안에서 실행됩니다.

### iframe sandbox

```
sandbox="allow-scripts"
```

`allow-same-origin` 은 의도적으로 빠져있습니다. iframe 은 부모 페이지의 origin / 쿠키 / localStorage / sessionStorage 에 접근할 수 없습니다.

### Content Security Policy

`<head>` 에 inline 으로 박힙니다.

```
default-src 'none';
script-src 'unsafe-inline';
style-src 'unsafe-inline';
img-src https: data:;
font-src https: data:;
connect-src 'none';
```

### 결과적으로 차단되는 것

- 외부 fetch / XMLHttpRequest / WebSocket — `connect-src 'none'`
- `<script src="https://cdn...">` 외부 스크립트 로드 — `script-src 'unsafe-inline'` 만 허용
- `<link href="https://fonts.googleapis.com/...">` 외부 스타일시트
- localStorage / sessionStorage / document.cookie — sandbox + connect-src 조합으로 차단
- iframe 또는 form 의 다른 origin submit
- SVG 외부 hot-link — 백엔드 image-proxy 가 SVG 를 거부합니다

### 허용되는 것

- inline `<script>` (HTML 또는 JS 탭)
- inline `<style>` (HTML 또는 CSS 탭)
- `<img src="https://...jpg">` — 자동으로 백엔드 이미지 프록시 경유
- `<img src="/files/uuid">` — hubNote 자체 업로드
- `<img src="data:image/png;base64,...">`
- 일반 이미지 포맷 (jpeg / png / gif / webp / avif)

### 권한 우회 불가

iframe 안의 JS 가 `window.ws.create(...)` 같은 호출을 해도, 결국 부모(인증된 React 앱) 가 본인 JWT 로 백엔드 호출 → 백엔드 권한 게이트가 적용됩니다. 권한이 없으면 403 → SDK 가 reject. iframe 안에서 권한을 우회하는 코드는 작성할 수 없습니다.

## window.ws SDK

iframe 이 로드되면 부모가 `window.ws` 객체를 주입합니다. 모든 메서드는 `Promise` 를 반환합니다.

### `ws.list(options?)`

워크스페이스 데이터 row 목록.

```javascript
const { items, total } = await window.ws.list({
  filter: { status: "active" },
  sort: [{ field: "created_at", order: "desc" }],
  limit: 50,
  offset: 0
});

items.forEach(row => {
  console.log(row.id, row.fields);
});
```

반환 형식: `{ items: Row[]; total: number }`

각 Row: `{ id, fields, created_at, updated_at, created_by }`

### `ws.get(rowId)`

단일 row.

```javascript
const row = await window.ws.get("uuid");
console.log(row.fields.name);
```

존재하지 않으면 `not_found` 에러.

### `ws.create({ fields })`

새 row 추가.

```javascript
const row = await window.ws.create({
  fields: {
    name: "홍길동",
    age: 30,
    avatar: "/files/uuid"
  }
});
```

### `ws.update(rowId, { fields })`

row 부분 수정. 보내지 않은 필드는 그대로 유지됩니다.

```javascript
await window.ws.update("uuid", {
  fields: { age: 31 }
});
```

### `ws.delete(rowId)`

row 삭제.

```javascript
await window.ws.delete("uuid");
```

### `ws.currentUser()`

현재 보고 있는 사용자.

```javascript
const me = await window.ws.currentUser();
console.log(me.id, me.username, me.display_name, me.avatar_url);
```

### `ws.uploadFile(file)`

File 객체를 업로드하고 hubNote 내부 URL 을 반환합니다.

```javascript
document.getElementById("input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const { url } = await window.ws.uploadFile(file);
  // url = "/files/<uuid>"
  document.getElementById("preview").src = url;
});
```

이 URL 을 그대로 row 의 image 필드에 저장하면 됩니다.

5MB 이하 권장 — 큰 파일은 부모 페이지의 메모리 부담이 커집니다.

### `ws.listPages()`

워크스페이스의 페이지 목록.

```javascript
const pages = await window.ws.listPages();
pages.forEach(p => {
  console.log(p.id, p.title, p.type, p.archived, p.visibility);
});
```

페이지 트리를 깊이 우선으로 평탄화한 결과입니다. 본인이 볼 수 있는 페이지만 포함됩니다.

### `ws.notify(message, level?)`

부모 페이지의 토스트 알림.

```javascript
window.ws.notify("저장 완료");
window.ws.notify("실패: 네트워크 오류", "error");
```

`level` — `"info"` (기본) / `"success"` / `"warning"` / `"error"`

같은 페이지에서 1초당 1번 throttle. 폭주 시 silent drop 됩니다.

## 데이터 row 다루기

### 필드 타입

워크스페이스 데이터 row 는 자유 형식 JSON 이지만 다음 관습을 권장합니다.

| 타입 | 값 형식 | 비고 |
|---|---|---|
| text | string | |
| number | number | |
| boolean | boolean | |
| date | ISO 8601 | `"2026-05-09"` |
| image | string | `/files/<uuid>` 또는 `https://...` |
| reference | string (id) | 다른 row 의 id |

image 필드는 백엔드가 검증합니다.

- `/files/<uuid>` — 자체 업로드 (허용)
- `https://...` — 외부 URL (허용, 자동으로 image-proxy 경유)
- `http://...` — 거부
- `/api/files/...` — 거부

### Schema 확인

편집기 우상단의 "Schema" 토글로 현재 워크스페이스의 필드 목록 (id / 이름 / 타입 / 사용 빈도) 을 볼 수 있습니다.

JS 에서 schema 자동 조회 SDK 는 없습니다. 필요하면 row 1개 받아서 `Object.keys(row.fields)` 로 확인하세요.

### 참조 무결성 없음

필드 이름이 바뀌거나 타입이 변하면 사용자 JS 가 `undefined` 또는 형 불일치를 그대로 만납니다. 방어적으로 코딩하세요.

```javascript
const { items } = await ws.list();
items.forEach(row => {
  const name = row.fields.name ?? "(이름 없음)";
  const age = Number(row.fields.age) || 0;
});
```

## 이미지 처리 정리

자주 헷갈리는 부분입니다.

### 외부 https 이미지를 그냥 박고 싶다

```html
<img src="https://example.com/photo.jpg">
```

백엔드가 자동으로 `<img src="/api/image-proxy?u=https://...">` 로 rewrite. viewer IP 가 외부에 누설되지 않습니다.

제약:

- https only (http 거부)
- 콘텐츠 타입은 jpeg / jpg / png / gif / webp / avif
- SVG 외부 hot-link 거부 (script 위험)
- 10MB 이하
- 클라우드 메타데이터 IP / 사설망 IP / loopback 거부 (SSRF 방어)

### 사용자에게 이미지 업로드 받기

```html
<input type="file" id="up" accept="image/*">
<img id="preview">
```

```javascript
document.getElementById("up").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const { url } = await window.ws.uploadFile(file);
  document.getElementById("preview").src = url;
  await window.ws.create({ fields: { photo: url } });
});
```

### data URI

```javascript
const canvas = document.createElement("canvas");
const dataUrl = canvas.toDataURL("image/png");
img.src = dataUrl;
```

허용됩니다. 다만 row 에 저장하기엔 사이즈가 큽니다 — 가능하면 Blob 을 File 로 변환해서 `uploadFile` 로 가세요.

## 라이브러리 사용

CDN `<script src>` 가 차단되니 두 방법뿐입니다.

### 코드를 JS 탭에 직접 붙여넣기

`chart.js`, `lodash`, `dayjs` 등의 minified 코드를 통째로 JS 탭에 붙여넣습니다.

JS 한도 50KB 주의 — chart.js minified 만 200KB 가까이 되어 그대로는 들어가지 않습니다. 필요한 부분만 떼어내거나 더 가벼운 라이브러리 (uPlot, day.js 등) 를 쓰세요.

### Vanilla JS 와 표준 API 활용

- 대부분의 차트는 SVG 또는 Canvas 직접 그리기로 50KB 안에 가능합니다
- 날짜는 `Intl.DateTimeFormat`
- DOM 조작은 `querySelector` / `addEventListener`

## 권한 처리

권한이 없는 작업을 시도하면 SDK 가 reject 합니다.

```javascript
try {
  await window.ws.create({ fields: { } });
} catch (err) {
  if (err.code === "permission_denied") {
    window.ws.notify("이 작업을 할 권한이 없습니다", "error");
    return;
  }
  if (err.code === "rate_limited") {
    return;
  }
  throw err;
}
```

에러 코드:

| code | 의미 |
|---|---|
| `validation` | 입력 형식 오류 |
| `permission_denied` | 권한 없음 |
| `rate_limited` | 너무 빠른 호출 |
| `not_found` | 대상 row 또는 파일 없음 |
| `unknown` | 그 외 |

## 자주 묻는 질문

### 외부 API 를 호출하고 싶다 (예: 날씨 API)

직접 호출 불가. 두 가지 우회:

1. 워크스페이스 데이터 row 에 사람이 수동으로 데이터를 박아두고 그걸 `ws.list()` 로 꺼내쓰기
2. 운영자에게 요청해서 백엔드 측 프록시 추가 (별도 사이클이 필요합니다)

### localStorage 에 사용자 설정을 저장하고 싶다

sandbox 가 막아서 불가능합니다. 대신 `ws.create()` 로 워크스페이스 row 에 저장하고, `ws.currentUser()` 로 본인 id 를 가져와 `created_by` 로 필터하세요.

### 다른 페이지로 이동시키고 싶다

현재 SDK 에 navigation 메서드는 없습니다. `<a href="/p/<page-id>" target="_top">` 로 link 하세요.

`target="_top"` 필수 — sandbox 안에서 페이지 전체를 이동시키려면 top 을 명시해야 합니다.

### 부모 페이지의 다크 모드를 따라가고 싶다

iframe 은 부모 origin 접근이 불가라 자동 동기화가 불가능합니다. CSS `@media (prefers-color-scheme: dark)` 를 자체적으로 사용하면, 시스템 설정과 부모 설정이 일치할 때 같이 갑니다.

### 다른 사용자의 라이브 변경을 실시간으로 반영하고 싶다

WebSocket 차단으로 직접 push 받을 수 없습니다. 폴링으로 우회.

```javascript
setInterval(async () => {
  const { items } = await window.ws.list();
  render(items);
}, 5000);
```

부담을 줄이려면 `updated_at` 정렬과 limit 으로 변경분만 받으세요.

### 인쇄 또는 PDF 저장

현재 미지원. iframe sandbox 안에서 `window.print()` 가 부모로 전달되지 않습니다.

### 페이지 본문에 다른 페이지를 임베드 하고 싶다

iframe nested embedding 미지원. `ws.listPages()` 로 목록을 받아 link 카드를 직접 만들 수는 있습니다.

### 여러 HTML View 페이지가 같은 코드를 공유하고 싶다 (DRY)

현재 모듈 시스템이 없습니다. 같은 코드를 각 페이지에 복붙해야 합니다. 향후 워크스페이스 단위 라이브러리 페이지를 추가할지는 backlog 입니다.

## 제약 정리

| 항목 | 한도 |
|---|---|
| HTML | 100KB |
| CSS | 50KB |
| JS | 50KB |
| 업로드 파일 | 5MB 권장 |
| 사용자 누적 업로드 | 5GiB |
| 외부 이미지 | 10MB / 일정 콘텐츠 타입만 |
| `ws.notify` | 1Hz throttle |
| SDK 메서드 timeout | 10초 |

## 디버깅

iframe 안의 console 출력은 부모 console 에 그대로 흐릅니다 (브라우저별로 다름). 안 보이면 DevTools 의 frame 셀렉터에서 sandbox iframe 을 선택하세요.

network 탭에서 `/api/...` 호출이 보이는데, 이는 부모가 SDK 위임으로 호출하는 것입니다. iframe 자체는 외부 origin 호출이 불가합니다.

자주 만나는 오류:

- `Refused to load the script ... violates ... script-src` — CDN `<script src>` 시도. inline 으로 옮기세요
- `Refused to connect ... violates ... connect-src` — 외부 fetch. SDK 로 우회하거나 row 에 미리 저장
- `permission_denied` — 워크스페이스 관리자에게 권한 토글 요청
