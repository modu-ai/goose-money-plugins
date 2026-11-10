# 호스트·OS별 설치와 보고서 표시 검증표

Refs #25 · 2026-11-10 KST 작성

소스 확인 기준은 main `e67a635c70b25b95c0b27c1eb3d793c8602ea210`입니다.
이 문서는 확인한 근거와 남은 검증을 정리합니다. 최초 지원 호스트·OS나
내장 미리보기 채택을 확정하지 않습니다. 현재 문서 작성 과정에서는
호스트 설치·호출·화면 조작·업데이트·제거를 실행하지 않았습니다.

## 호스트 × OS

각 칸은 **ATP 플러그인**의 검증 상태입니다. 호스트 제품 자체가 해당 OS를
제공하는지와 구분합니다. `미검증`은 아래 확인 범위에 해당 단계의 실제
실행 근거가 없다는 뜻이며, 동작 불가를 뜻하지 않습니다.

| 호스트 | OS | 설치 | 도구 호출 | 보고서 표시 | 업데이트 | 제거 | 확인한 근거와 한계 |
|---|---|---|---|---|---|---|---|
| Claude Code | macOS | 미검증 | 미검증 | 미검증 | 미검증 | 미검증 | E1·E2. 로컬 서버 시험을 Claude Code 내 실행으로 세지 않음 |
| Claude Code | Windows | 미검증 | 미검증 | 미검증 | 미검증 | 미검증 | E1·E3. Windows용 키 파일 저장 거부는 소스 정책이며 호스트 설치 시험이 아님 |
| Claude Desktop | macOS | 미검증 | 미검증 | 미검증 | 미검증 | 미검증 | E1·E2. Claude Code 결과와도 별도 검증 필요 |
| Claude Desktop | Windows | 미검증 | 미검증 | 미검증 | 미검증 | 미검증 | E1·E3. macOS 관찰로 대체하지 않음 |
| ChatGPT | macOS | 미검증 | 미검증 | 미검증 | 미검증 | 미검증 | E1·E2·E4. Codex 설치 캐시·일반 HTML 자원과 ChatGPT 앱 내 표시를 구분 |
| ChatGPT | Windows | 미검증 | 미검증 | 미검증 | 미검증 | 미검증 | E1·E3. 웹·데스크톱 등 실제 검증할 실행 형태도 함께 지정해야 함 |

ChatGPT의 웹/데스크톱 실행 형태, Claude Code의 터미널/앱 실행 형태는
검증할 때 별도로 기록합니다. 같은 제품 이름으로 서로 다른 클라이언트의
결과를 합치지 않습니다. 실제 모바일은 이 6칸 밖의 별도 검증 대상입니다.

## 확인한 근거

| ID | 근거 | 이번에 확인한 내용 | 이 근거가 입증하지 않는 것 |
|---|---|---|---|
| E1 | [CAPABILITIES.json](../../plugins/moai-atp/CAPABILITIES.json) | 기준 소스의 `host_installed=false`, `independent_host_verification=false`, `test_targets=[macOS, Windows]` | 실제 기기의 현재 설치 상태, 호스트 검증 통과 |
| E2 | [report-html-mcp.ts](../../plugins/moai-atp/server/src/report-html-mcp.ts) | `delivery=mcp_resource_link`, `host_rendering=not_observed`, `mime_type=text/html`; 메모리 자원은 최대 5분·3개 | 호스트가 링크를 실제로 표시·다운로드했다는 증거 |
| E3 | [local-credentials.ts](../../plugins/moai-atp/server/src/local-credentials.ts), [README](../../plugins/moai-atp/README.md) | Windows에서는 키 파일 저장을 `secure_file_storage_unsupported`로 거부하는 소스와 안내가 있음 | Windows에서 ATP 전체가 동작하지 않는다는 판정, 실제 Windows 실행 결과 |
| E4 | 과거 로컬 `host-preview-review/RESULT.md`·`installed-contract.json` | 아래 과거 관측 요약을 읽어 확인 | 현재 main·현재 설치본의 재측정, 여섯 호스트 조합의 실제 실행 |

E1–E3은 이 기준 트리의 소스를 읽어 확인한 사실입니다. 특정 OS의 현재
동작을 직접 실행해 측정한 결과는 아닙니다. 패키지 의존성 및
`server/src/`에서 `@modelcontextprotocol/ext-apps`, `registerApp`,
`resourceUri`, `text/html;profile=mcp-app`를 검색했을 때 일치가 없었습니다.
이 검색과 E2는 검사한 코드 범위의 일반 HTML 자원 계약을 보여 줍니다.

E4는 운영자가 보존한 `/tmp/atp-verify-HKpvkKiM/host-preview-review/` 기록입니다.
Git에 포함되지 않아 다른 환경에서는 원문 확인이 필요합니다. 기록은 같은
Mac의 설치 캐시 dev.5를 Node 22.22.3으로 초기화해 도구·자원 목록을 조회했고,
`registered_tools=36`, `render_tool_ui_resource_uri=null`,
`MCP_App_UI_advertised=false`, `tool_calls=0`, `new_API_requests=0`을 남겼습니다.
실화면 PASS는 0건입니다. 이번 문서 작업에서는 그 진단을 재실행하지
않았습니다. 설치 캐시에 파일이 있다는 사실을 위 표의 호스트 설치 통과로
옮기지 않습니다.

2026-11-10 #52의 합성 HTML 브라우저 검수도 `file:` 접근 거부로 실화면
검증을 완료하지 못했습니다. #52의 관련 시험은 HTML 구조와 렌더러에 대한
근거이며, 글꼴 실제 로드·Referer·차단/오프라인 대체·390px 레이아웃을
호스트 화면에서 확인한 근거로 쓰지 않습니다. 접근 거부를 다른 경로로
우회하지 않습니다.

## ChatGPT 내장 미리보기 선택지 — 결정 필요

일반 HTML 링크의 반환과 대화 안에 포함되는 UI는 별도 계약입니다.
[MCP Apps 공식 개요](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html)는
서버의 UI 자원 선언, 호스트의 iframe 표시, 양쪽의 통신을 구분하며
호스트의 UI 지원 capability 확인을 설명합니다. 프로토콜의 지원 설명은
ATP의 ChatGPT 내장 미리보기가 구현·검증됐다는 근거가 아닙니다.

| 선택지 | 제품에서 제공할 것 | 필요한 작업·검증 | 현재 판단 |
|---|---|---|---|
| 일반 HTML 자원 링크 유지 | 기존 `resource_link`와 호스트가 제공하는 열람·다운로드 | 여섯 조합에서 실제 표시·만료·접근 거부 동작 확인 | 기존 반환 계약. 호스트 표시 미검증 |
| MCP Apps UI를 추가 목표로 채택 | 지원 호스트에서 보고서를 대화 안에 표시 | UI 자원·연결 메타데이터·capability 협상·bridge·CSP 설계, 호스트별 검증 | 채택 여부 결정 필요, 이번 PR에서 구현하지 않음 |

내장 UI를 채택하더라도 보고서별 권리·만료·호출 결속을 보존해야 합니다.
개인 보고서를 전역의 ‘마지막 보고서’로 공유하거나 TTL·권리 검사를 느슨하게
만드는 방식은 대안으로 삼지 않습니다. 지원하지 않는 호스트의 처리와
CDN 글꼴 허용 범위도 호스트별로 검증해야 합니다.

공식 제품 문서는 검증 경로를 조사하는 참고 자료입니다.
[Claude Code 설치 안내](https://code.claude.com/docs/en/setup)와
[ChatGPT 플러그인 안내](https://learn.chatgpt.com/docs/plugins)를 2026-11-10에
확인했습니다. 제품의 설치·플러그인 지원 설명을 ATP 지원표의 통과로
대체하지 않습니다. 새로운 터널·원격 배포·서비스 등록은 이번 범위가 아닙니다.

## 각 칸을 검증할 때 남길 기록

1. 호스트·OS·앱/웹 형태·버전, 플러그인 버전과 아티팩트 해시, 검증 시각을 기록합니다.
2. 설치 후 같은 호스트에서 도구 목록과 합성 입력 호출을 확인합니다.
   셸의 직접 stdio 시험은 별도 근거로 남깁니다. 키·실계좌·공급자 호출은
   이 검증의 기본 입력으로 쓰지 않습니다.
3. 반환된 보고서의 글꼴·차트·표·출처·한국어/KST·좁은 창을 실제 화면에서
   확인합니다. HTML 응답 성공과 실화면 성공을 따로 기록합니다.
4. 업데이트 전후 버전·도구 정의 갱신·기존 연결의 동작을 같은 호스트에서 확인합니다.
5. 제거 후 해당 호스트에서 연결·도구가 사라졌는지 확인합니다.
   사용자 자료 삭제는 별도 권한과 계약에 따라 수행하며 자동으로 지우지 않습니다.

검증자는 각 단계의 명령 또는 UI 동작, 관측 결과, 민감정보를 제외한 증거
위치를 남깁니다. 실패·차단·미실행도 그대로 기록합니다. 최초 지원 조합과
내장 미리보기 채택은 이 근거를 검토한 뒤 별도로 결정합니다.
