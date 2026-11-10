# 호스트·OS별 설치와 보고서 표시 검증표

Refs #25 · 2026-11-10 KST 작성

소스 확인 기준은 main `e67a635c70b25b95c0b27c1eb3d793c8602ea210`입니다.
이 문서는 확인한 근거와 남은 검증을 정리합니다. 최초 지원 호스트·OS나
내장 미리보기 채택을 확정하지 않습니다.
초기 작성 때는 호스트 실행을 하지 않았습니다. 이후 이 Mac의 Claude Code만
임시 프로필에서 설치·업데이트·제거 명령을 실행했습니다. E5의 설치 실패 뒤
Claude용 구성을 추가해 E6에서 로컬 설치·갱신·제거를 확인했습니다.
보고서 요청은 인증 단계에서 멈춰 도구 호출·호스트 안 표시는 미검증입니다.
2026-11-11에는 같은 조건(로그인 없음·임시 프로필)으로 병합 main
`9d96b939dd627ca1abee40b6a781ceebed2ef19f`에서 설치·갱신·제거를 다시
실행했습니다(E7). 남은 27칸은 "로그인·Windows 없이 채울 수 없는 칸" 절에
사유와 채우는 데 필요한 사람 작업으로 정리했습니다.

## 호스트 × OS

각 칸은 **ATP 플러그인**의 검증 상태입니다. 호스트 제품 자체가 해당 OS를
제공하는지와 구분합니다. `미검증`은 아래 확인 범위에 해당 단계의 실제
실행 근거가 없다는 뜻이며, 동작 불가를 뜻하지 않습니다.

| 호스트 | OS | 설치 | 도구 호출 | 보고서 표시 | 업데이트 | 제거 | 확인한 근거와 한계 |
|---|---|---|---|---|---|---|---|
| Claude Code | macOS | 로컬 설치 확인(E6) | 인증 차단·미검증(E6) | 미검증(E6) | 로컬 시험 갱신 확인(E6) | 설치 기록 제거 확인(E6) | Claude Code 2.1.322 · macOS 27.0.1 arm64 · dev.6 런타임. MCP 연결 확인, 로그인 세션의 호출·표시나 실제 출시 버전 간 갱신은 별도. E7(2026-11-11)에서 병합 main 기준 설치·MCP 연결·갱신·제거 재확인 |
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
| E6 | 아래 Claude용 패키지 추가 후 재실측 | 로컬 설치·MCP 연결·시험 메타데이터 갱신·설치 기록 제거 | 인증된 도구 호출·호스트 안 HTML 표시·기존 실행 세션 갱신/제거 |
| E7 | 아래 병합 main 재실측(2026-11-11) | 병합 main `9d96b93` 기준 로컬 설치·MCP Connected·시험 표식 갱신·설치 기록 제거 재확인. E1·E2·E3의 소스 근거와 MCP Apps 부재 검색도 같은 커밋에서 재확인 | OS 샌드박스 미적용(E6과의 격리 차이는 E7 절에 기술), 인증된 호출·표시, Windows·Desktop·ChatGPT 칸 |
| E5 | 아래 Claude Code 임시 프로필 실측 | 로컬 소스 설치 실패, 업데이트·제거 미설치 오류, 전후 플러그인 목록 비어 있음 | 도구 호출·보고서 표시, 버전 간 업데이트·설치된 플러그인 제거 성공 |
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

## E5 · 이 Mac의 Claude Code 임시 프로필 실측

사용자 결정에 따라 2026-11-10 22:55 KST에 Claude Code 터미널 CLI
2.1.322 / macOS 27.0.1 arm64에서 측정했습니다. 대상은 main
`83441146cdbd0c6dbceb4f13405abd5152fe8617`의 Git 추적 파일로 추출한
`0.1.0-dev.6` 소스이며, 런타임 번들 설치 시험이 아닙니다. 기존 dev.5
설치본을 검사·수정하거나 실사용 설정을 복사하지 않았습니다.

### 격리와 실행 범위

- 새 임시 디렉터리에 프로필·빈 작업 폴더·소스 사본을 만들고
  `CLAUDE_CONFIG_DIR`와 `CLAUDE_CODE_TMPDIR`를 그 안으로 지정했습니다.
  환경은 허용 목록으로 새로 구성해 인증·공급자 관련 변수를 전달하지 않았습니다.
- 모든 측정 명령은 `sandbox-exec` 안에서 `claude --bare --setting-sources user`로
  실행했습니다. 설치된 CLI의 `--bare` 설명은 키체인 읽기·훅·자동 탐색을
  건너뛴다고 명시합니다. OS 샌드박스는 네트워크, 실사용 홈 경로 읽기,
  키체인 파일·서비스 접근, 임시 경로 밖 쓰기를 차단했습니다. 실행 파일의
  읽기만 명시적으로 허용했으며 호스트 바이너리를 업데이트하지 않았습니다.
- 합성 파일 읽기 거부·허용 경로 밖 쓰기 거부가 각각 종료 1로 관측됐고,
  loopback 연결도 `Operation not permitted`로 거부됐습니다. 키·토큰을
  읽어 검증하지 않았으며 공급자 실호출을 하지 않았습니다.
- 시작·종료의 `claude plugin list --json`은 모두 종료 0과 `[]`였습니다.
  이 관측은 임시 프로필에만 해당합니다. 실사용 프로필을 읽어 전후 비교하지
  않았으며, 해당 경로의 변경 방지는 샌드박스 쓰기 제한으로 보장했습니다.

설정 경로의 근거는 [Claude Code 설정 문서](https://code.claude.com/docs/en/settings),
CLI 동작은 설치 버전의 `--help`·`plugin <명령> --help`를 확인했습니다.
`--bare`는 일반 사용자 세션과 다른 최소 모드이므로 정상 로그인 세션의
플러그인 자동 로드나 화면 동작을 통과로 판정하지 않습니다.

### 다섯 단계의 관측

아래 `$SOURCE`는 추출한 소스 사본의 루트입니다. 모든 명령 앞에 위 격리
설정이 적용됐으며 개인 경로·응답 원문·화면 캡처는 Git에 넣지 않았습니다.

| 단계 | 명령 또는 선행 조건 | 실제 결과 | 판정 |
|---|---|---|---|
| 설치 | `claude plugin install moai-atp --marketplace "$SOURCE" --scope user --json` | 종료 1, `manifest_missing`. `.claude-plugin/marketplace.json` 없음 | 이 로컬 소스 경로의 설치 실패 |
| 설치 경로 추가 확인 | `claude plugin install moai-atp --marketplace "$SOURCE/.agents/plugins/marketplace.json" --scope user --json` | 종료 1, `manifest_invalid`. `owner` 누락 오류 | 기존 카탈로그를 직접 지정해도 실패 |
| 도구 호출 | 설치 완료 후 같은 Claude Code에서 합성 입력 호출 | 설치된 ATP가 없어 실행하지 않음 | 선행 설치 실패로 차단·미검증 |
| 보고서 표시 | 같은 호스트의 호출 결과로 보고서 표시 | 도구 호출 결과가 없어 실행하지 않음. 외부 브라우저의 로컬 HTML 표시로 대체하지 않음 | 차단·미검증 |
| 업데이트 | `claude plugin update moai-atp --scope user --json` | 종료 1, `not_installed` | 명령 실행만 확인. 버전 전환 검증 아님 |
| 제거 | `claude plugin uninstall moai-atp --scope user --json` | 종료 1, `not_installed` | 명령 실행만 확인. 설치된 연결·도구 제거 검증 아님 |

추가로 기존 카탈로그를 `claude plugin validate ... --json`으로 검사한 결과는
종료 1이며 `owner`와 `plugins.0.source` 오류였습니다. 플러그인 디렉터리만
검사하면 종료 0이지만 `manifest: null`, `contents: []`였으므로 이를 ATP
플러그인 인식·설치 성공으로 세지 않습니다. 현재 manifest는
[OpenAI 확장](../../plugins/moai-atp/plugin.json)을 사용합니다. 이번 작업은
Claude용 manifest·카탈로그를 새로 만들거나 기존 형식을 변환하지 않았습니다.
그런 배포 경로의 추가 여부·패키징은 별도 범위 결정이 필요합니다.

재현 아티팩트의 SHA-256:

| 파일 | SHA-256 |
|---|---|
| `.agents/plugins/marketplace.json` | `b64fcd3f40d2e5e121d721feb4cfd6bcad81cea4ec85324ca5f1eb891be5de5b` |
| `plugins/moai-atp/plugin.json` | `8ecaa778daf40c0ba3070c9b2a9f7b77c71b12cf27980267db3d3734e925e4e3` |
| `plugins/moai-atp/mcp.json` | `878f11b7b996e6ac98d4a0614653239a68729746b8a2cb2b65f2c02b6e47bbd0` |

민감정보를 제외한 원시 명령 로그·격리 정책·실측 요약은 검증자의 로컬
`codex-6/STAGE.md`에 기록한 증거 폴더에만 보존합니다. 그 폴더는 Git
미추적이며 다른 환경에서는 위 기준 커밋과 명령으로 재현해야 합니다.
실제 도구 호출·화면 표시·업데이트·제거까지 완료한 지원 조합은 아직 없습니다.
다른 호스트·OS의 25칸은 미검증을 유지하고 #25를 닫지 않습니다.

## E6 · Claude용 패키지 추가 후 임시 프로필 재실측

2026-11-11 00:17~00:19 KST, 같은 Mac의 Claude Code 2.1.322 /
macOS 27.0.1 arm64에서 사용자 결정 2차를 실행했습니다. 기준 main은
`06b7eef3b60e23abf036d68d7801a1bb89d5e47a`이며, 그 위에 Claude용
카탈로그·manifest·런타임 ZIP 반입을 추가한 작업 트리로 측정했습니다.
기존 OpenAI용 설정과 저장소 버전 `0.1.0-dev.6`는 바꾸지 않았습니다.

새 임시 프로필·빈 작업 폴더에서 허용 목록 환경과 `--bare --setting-sources user`를
사용했습니다. E5와 같이 OS 샌드박스로 실사용 홈·키체인 접근, 임시 경로 밖
쓰기와 모든 네트워크를 차단했고 합성 읽기·쓰기·loopback 거부를 재확인했습니다.
기존 dev.5·실사용 설정·키를 읽거나 변경하지 않았습니다. 로컬 카탈로그의
설치 정보는 이 임시 프로필에만 저장했고 외부 게시·마켓 등록은 하지 않았습니다.

검증용 ZIP은 Node 24.22.1로 만든 MJS 런타임이며 Node 실행 파일을 포함하지
않습니다. Claude가 실행한 Node는 22.22.3입니다. ZIP SHA-256은
`92bd76b8990c99639ccdc714db85727a135305f7e77c7fbb242f6c5bd0c02bcd`입니다.
검증 시 사본을 로컬 카탈로그의 `plugins/moai-atp`에 펼쳤습니다. 소스용
manifest는 `server/dist/src/main.js`, ZIP용은 `server/runtime/src/main.mjs`를
가리킵니다. 경로 변수는 모두 `${CLAUDE_PLUGIN_ROOT}`입니다.

아래 `$CATALOG`와 `$CACHE`는 임시 카탈로그와 설치 후 반환된 캐시 경로입니다.
모든 명령은 위 격리 안에서 실행했습니다.

| 단계 | 실행과 관측 | 확인 범위·한계 |
|---|---|---|
| 설치 | 카탈로그·플러그인 각각 `claude plugin validate <path> --strict --json`: 종료 0, errors/warnings 비어 있음. `claude plugin install moai-atp --marketplace "$CATALOG" --scope user --json`: 종료 0, outcome ok | `plugin list --json`에서 dev.6 enabled 확인. `plugin details`는 Goose 스킬 1개·MCP 서버 1개 인식 |
| 호출 | `claude --plugin-dir "$CACHE" mcp list`: 종료 0, `Connected`. 이어 `claude --plugin-dir "$CACHE" --print --max-turns 1 <합성 R01 요청>`: 종료 1, `Not logged in · Please run /login` | 호스트의 MCP 연결까지만 확인. 실제 보고서 도구 호출은 인증 차단·미검증이며 로그인·키 읽기를 진행하지 않음 |
| 표시 | 위 요청이 보고서 결과를 만들지 못해 호스트 안 표시를 실행하지 못함 | 미검증. 별도 stdio의 HTML 반환을 호스트 화면 성공으로 세지 않음 |
| 업데이트 | 변경 없는 `plugin update ... --json`: 종료 0, up_to_date. 임시 사본의 메타데이터를 시험 표식 `0.1.0-dev.6-localprobe.1`로 바꾼 뒤 같은 명령: 종료 0, updated. 새 캐시 버전·경로와 MCP 재연결 확인 | 저장소·출시 버전 변경 없음. 시험 표식으로 로컬 갱신 경로만 검증했으며 실제 두 출시 버전의 교체·기존 실행 세션 전환은 미검증 |
| 제거 | `claude plugin uninstall moai-atp@moai-atp-claude-local --scope user --json`: 종료 0. 설치 목록 `[]`, 같은 ID의 `plugin details`는 종료 1/not found. 임시 카탈로그 제거 후 카탈로그 목록도 `[]` | 설치 기록·컴포넌트 조회에서 제거 확인. 기존 대화 세션 안에서 도구가 사라지는 동작은 미검증 |

보조 시험은 설치된 캐시의 실제 manifest를 읽어 지정된 MJS 진입점을 별도
stdio 클라이언트로 실행했습니다. `tools/list` 36개, 합성 `build_report_input`
→ `render_report_html` → `resources/read`의 HTML 읽기가 성공했습니다.
네트워크 차단을 유지했고 공급자 실호출은 0입니다. 이 경로는 Claude Code가
도구를 호출하거나 보고서를 화면에 표시한 근거가 아닙니다.

설치·갱신·제거에 대한 이전 E5의 미설치 차단은 이 로컬 패키지 경로에서
해소됐습니다. 인증된 보고서 호출·표시를 실제로 측정할 허용 환경은 별도
조건으로 남습니다. `Not logged in`은 인증을 가져오지 않은 이 임시 프로필의
결과이며 실사용 계정의 로그인 상태를 판정한 것이 아닙니다. Desktop·ChatGPT·Windows 25칸은 미검증을 유지하고
#25를 닫지 않습니다. 원시 로그·격리 정책·합성 응답은 E5와 같이 로컬
증거 폴더에만 보존하며 Git·이슈·PR에는 올리지 않습니다.

## E7 · 병합 main 재실측 (2026-11-11, 로그인 없음)

2026-11-11 02:41~02:51 KST, 같은 Mac의 Claude Code 2.1.322 /
macOS 27.0.1 arm64 / Node 22.14.0에서 병합 main
`9d96b939dd627ca1abee40b6a781ceebed2ef19f`을 Git worktree로 추출해
`npm ci` → `npm run build`(둘 다 종료 0)한 뒤 소스 모드로 재실측했습니다.
플러그인 카탈로그는 worktree 사본(`.claude-plugin/marketplace.json` +
`plugins/moai-atp`, node_modules 포함)을 임시 디렉터리에 두고 사용했습니다.
저장소 버전은 바꾸지 않았습니다.

같은 조건의 소스 재확인(모두 `9d96b93` 직접 측정): E1
`CAPABILITIES.json`의 `host_installed=false`(144행)·
`independent_host_verification=false`(194행), E2
`report-html-mcp.ts`의 `mime_type: text/html`(28·143행)·
`delivery: mcp_resource_link`(31·146행)·
`host_rendering: not_observed`(32·147행), E3
`local-credentials.ts`의 win32 저장 거부(28행)는 모두 그대로였고,
`@modelcontextprotocol/ext-apps`·`registerApp`·`resourceUri`·
`text/html;profile=mcp-app` 검색 일치도 0건이었습니다.

### 격리와 한계

- 새 임시 디렉터리에 `CLAUDE_CONFIG_DIR`와 `CLAUDE_CODE_TMPDIR`를
  지정했고, 세션 환경의 인증·세션 변수(ANTHROPIC_*·CLAUDE_*·Z_AI_*·
  공급자 키 계열)를 **이름 목록으로 제거**했습니다. 값은 읽거나 기록하지
  않았고 PATH를 목록으로 한정했습니다. 모든 명령은
  `claude --bare --setting-sources user`로 실행했습니다.
- **E6과의 차이**: OS 샌드박스(sandbox-exec)는 적용하지 않았습니다.
  격리는 설정 경로 전환·변수 제거·`--bare`에 한정되며 네트워크를 OS
  수준에서 강제하지 못합니다. 다만 이번 단계는 모두 로컬 경로만 읽는
  명령이고 네트워크를 부르는 단계가 없으며, `--print` 호출은 인증 부재로
  즉시 종료됐습니다. 실사용 프로필·키·dev.5 설치본은 읽거나 쓰지
  않았습니다(설정 경로가 임시 디렉터리).
- 측정 준비 실수 1건: 첫 카탈로그 사본에서 `node_modules`를 뺐더니
  설치는 성공(`outcome ok`)했고 `mcp list`는 `CONNECTION_CLOSED`로
  실패했습니다. 캐시 진입점을 직접 실행해 `server_load_failed`와
  `node_modules` 부재를 확인했고, 사본에 의존성을 포함해 재설치하자
  아래 표의 결과를 얻었습니다. 제품 동작이 아니라 측정 준비 문제였음을
  구분해 기록합니다.
- 갱신 표식은 임시 사본의 설치 기록과 카탈로그 manifest 버전만 바꿨고
  저장소·출시 버전은 그대로입니다. 원시 로그는 이 머신의
  `/tmp/lane2-e7/*.log`에만 두며 Git 미추적입니다.

### 다섯 단계의 재관측

| 단계 | 명령 또는 선행 조건 | 실제 결과 | 판정 |
|---|---|---|---|
| 설치 | `plugin list --json` 사전 확인(종료 0, `[]`) → 카탈로그·플러그인 `plugin validate <경로> --strict --json`(둘 다 success true, errors/warnings 비어 있음) → `plugin install moai-atp --marketplace <임시 카탈로그> --scope user --json` | 종료 0, `outcome ok`. `plugin list`에서 `0.1.0-dev.6` enabled, MCP 서버 `moai-kis-readonly` 인식, `plugin details`는 Skills(1) goose · MCP servers(1) | E6 재확인. 이번에도 로그인 없이 설치 단계만으로 완결됨 |
| 도구 호출 | `claude --plugin-dir <캐시> --print --max-turns 1 <합성 R01 요청>` | 종료 1, `Not logged in · Please run /login` | 인증 차단 재관측. 로그인 없이는 채울 수 없음 |
| 보고서 표시 | 위 호출이 결과를 만들지 못해 실행하지 않음 | 미검증 유지 | 별도 stdio의 HTML 반환을 호스트 표시로 세지 않음 |
| 업데이트 | 변경 없는 `plugin update --json`: `up_to_date`. 설치 기록·카탈로그 사본의 버전을 `0.1.0-dev.6-localprobe.1`로 바꾼 뒤 같은 명령 | 종료 0, `updated from 0.1.0-dev.6 to 0.1.0-dev.6-localprobe.1`. 새 캐시 버전 디렉터리 생성, 그 경로의 `mcp list` `✔ Connected` | 로컬 갱신 경로 재확인. 실제 출시 버전 간 교체·기존 세션 전환은 미검증 |
| 제거 | `plugin uninstall moai-atp@moai-atp-claude-local --scope user --json` | 종료 0, `outcome ok`(`keptData:false`). 이후 `plugin list` `[]`, 같은 ID `plugin details` 종료 1 `not found` | 설치 기록 제거 재확인 |

`check_package.py`(빌드 트리 기본 모드)는
"Local package component checks passed; account upload/host installation
not performed." 종료 0이고 `python3 -m unittest discover -s scripts -p
test_claude_package.py`는 Ran 2 tests / OK였습니다. `--source-only`는
빌드 산출물이 있는 트리에서 설계대로 거부(AssertionError)했고, 산출물
없는 순수 사본에서의 재실행은 이번 세션의 도구 가드 거절로 수행하지
못했습니다(이 문서의 E7 근거에서 제외).

## 로그인·Windows 없이 채울 수 없는 칸 (2026-11-11 정리)

남은 27칸(호출·표시 2칸 + 미검증 25칸)은 아래 사유 없이는 채울 수
없습니다. 이 표는 채움 가능성을 닫는 것이 아니라, 각 칸에 무엇이 필요한지를
남기기 위한 것입니다.

| 칸 묶음 | 칸 수 | 로그인·Windows 기기 없이 채울 수 없는 이유 | 채우는 데 필요한 사람 작업 |
|---|---|---|---|
| Claude Code × macOS 도구 호출·보고서 표시 | 2 | 도구 호출은 로그인된 Claude 세션이 필요. E6·E7 모두 인증을 가져오지 않은 임시 프로필이라 `Not logged in`으로 종료(E7 02:44 KST 재관측) | 로그인된 상태의 격리 실측 허용 여부 사용자 결정(실사용 프로필·설치본 노출 감수). 또는 테스트 전용 계정·자격 준비 |
| Claude Code × Windows 5단계 전체 | 5 | Windows 환경 부재. 키 파일 저장이 Windows에서 거부되는 것은 소스 정책(E3)까지 확인됐지만 호스트 설치·호출 동작은 측정한 적이 없음 | Windows 기기에서 E6·E7과 같은 절차 실행. GitHub 호스팅 Windows runner로 설치·갱신·제거 3단계만 측정하는 방안은 claude CLI를 runner에 설치하는 CI 워크플로 추가가 전제라 별도 결정 대상(이번 PR에서 수행하지 않음) |
| Claude Desktop × macOS·Windows 5단계 전체 | 10 | Claude Desktop 앱과 로그인 필요. 플러그인 설치 경로가 Claude Code CLI와 달라 E6·E7 절차를 그대로 쓸 수 없음 | Claude Desktop이 설치된 기기와 로그인 세션에서 5단계 실행(기기·계정 확보는 사용자 몫) |
| ChatGPT × macOS·Windows 5단계 전체 | 10 | ChatGPT 앱(웹·데스크톱 형태 포함)과 로그인 필요. ChatGPT의 MCP 지원 범위·설치 경로 자체가 아직 확인되지 않음 | 검증할 실행 형태를 먼저 지정하고, 실제 ChatGPT 세션에서 5단계 실행. 아래 MCP Apps 채택 여부 결정에 따라 검증 설계가 달라짐 |

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

2026-11-11 현재(병합 main `9d96b93` 재확인): 위 두 선택지의 비교는
그대로이며 채택 여부는 여전히 결정 필요입니다. 이번 재확인에서
`@modelcontextprotocol/ext-apps`·`registerApp`·`resourceUri`·
`text/html;profile=mcp-app` 검색 일치는 0건이었고, E2의 일반 HTML 자원
계약(`delivery=mcp_resource_link`, `host_rendering=not_observed`)도
`report-html-mcp.ts` 28·31·32·143·146·147행에서 그대로 확인됐습니다.
즉 MCP Apps UI 쪽 선택지는 아직 구현·검증이 시작되지 않은 상태이고,
일반 HTML 자원 유지 쪽도 호스트 표시가 미검증인 상태입니다.

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
