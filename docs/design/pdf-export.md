# PDF 내보내기: 독립 단계 원형과 남은 결정

Refs #24. 조사 기준은 2026-11-10의 main `45bf490fb74ad1291dad956b11d0bd4c134393bf`이다.
#52의 HTML 실화면 QA를 기다리지 않고 독립 범위부터 진행한다는 사용자 지시를 반영했다.
실제 보고서의 인쇄 품질이나 출시 완료를 판정하는 문서가 아니다.

## 현재 제공하는 범위

`server/src/report-pdf-export.ts`는 합성으로 표시된 `ActiveReportInput`만 받는 원형이다.
명시적 확인과 사용자가 지정한 비공개 디렉터리가 필요하다. 실제·혼합·사용자 제공 모드,
비합성 출처, 다른 사용자에게 열린 디렉터리, 디렉터리 자체의 심볼릭 링크는 거부한다.
렌더러는 호스트가 주입하며 네트워크 차단과 취소 시 프로세스 종료를 담당한다.
PDF 서명·크기를 확인한 뒤 임시 파일을 `0600`으로 쓰고 hard link로 원자적으로 확정한다.
기존 파일이나 링크를 덮어쓰지 않는다. HTML은 저장하지 않고 렌더러에 메모리로 전달한다.

Windows ACL의 비공개 저장은 구현·검증하지 않아 원형은 Windows 저장을 거부한다.
PDF 바이트의 시작·끝 표시는 완전한 PDF 구조 검사나 페이지 검수를 대신하지 않는다.
자격증명·사용자 보유 저장소를 읽거나 공급자 요청을 만드는 경로는 없다.
실제 입력을 합성으로 거짓 표시하는 것을 탐지하는 자료 분류 기능은 아니다.

MCP 도구나 사용자용 CLI에 등록하지 않았다. 기존 HTML 자원의 만료를 늘리지 않으며
다른 프로세스의 receipt를 복구하거나 합성 입력에 실제 출처를 섞지 않는다.
실자료 내보내기를 열기 전에는 권한 재판정, 신뢰한 보고서와의 결속, 사용자별 격리,
저장·삭제 UX를 별도 구현·시험해야 한다.

## 변환 경로 비교

| 경로 | 이번에 확인한 상태 | 남은 범위 |
|---|---|---|
| 브라우저 인쇄 → PDF | 기존 HTML의 인쇄 CSS를 활용할 수 있는 경로 | 실제 호스트의 인쇄·저장과 페이지 품질은 미검증 |
| 격리 Chrome → PDF | 아래 도구가 새 임시 프로필과 private debugging pipe로 고정 합성 입력만 변환 | 실제 보고서·다른 OS·배포용 어댑터는 미검증 |
| WeasyPrint | 현재 조사 환경에 미설치 | 설치하지 않았으며 CSS·스크립트 차트 호환성 미검증 |
| CoreText/Quartz | 기존 별도 요약 PDF 2개가 이 방식으로 생성됨 | HTML→PDF 변환 경로가 아니므로 HTML QA 근거로 사용하지 않음 |

합성 검증 도구는 페이지를 `about:blank`로 만들고 네트워크를 offline으로 설정한 뒤 모든
URL을 차단하고 HTML 문자열을 주입한다. 기존 사용자 브라우저·쿠키·프로필은 사용하지 않는다.
`Page.printToPDF`로 A4 출력을 요청하고, 취소·성공·실패 뒤 자신이 만든 브라우저와 프로필을 정리한다.
이 도구는 거부된 실제 보고서 화면을 우회해 열거나 검수하기 위한 수단이 아니다.
사용자가 별도 승인한 고정 합성 fixture의 변환만 수행한다.

[Chrome 공식 Page 프로토콜](https://chromedevtools.github.io/devtools-protocol/tot/Page/)과
[Network 프로토콜](https://chromedevtools.github.io/devtools-protocol/tot/Network/)을 확인했다.
표준 인쇄 기능을 사용해도 내장 UI·호스트 지원이나 실제 PDF의 모양이 자동으로 검증되지는 않는다.

## 글꼴: 결정 필요

HTML은 기존 사용자 결정대로 고정 CDN 글꼴을 유지한다. 이 PR은 HTML 글꼴·CSP를 바꾸지 않는다.
PDF의 글꼴 정책은 다음 선택지와 검증이 남아 있다.

| 선택지 | 조건과 확인할 것 |
|---|---|
| 시스템 글꼴 의존 | 설치 글꼴과 대체 글꼴이 OS마다 다름. 한글·기호 표시와 페이지 재배치 확인 필요 |
| 라이선스 확인 후 임베딩 | 글꼴별 재배포·서브셋 허용 원문, 실제 PDF 포함, 저작권 고지 확인 필요 |
| CDN 로드 후 PDF 출력 | 고정 URL·권리·Referer·보고서 정보 비전송을 유지하고 로드 완료 및 PDF 내 실제 포함을 확인해야 함 |

진단 도구가 CDN을 차단하는 것은 오프라인 실패·대체 경로를 확인하기 위한 조건이며,
시스템 글꼴 방식을 최종 선택한 것이 아니다. 원형의 결과는 항상 `font_policy=decision_required`,
`font_embedding=not_verified`, `page_review=not_verified`로 반환한다.
실제 산출물의 별도 검사 결과와 API의 미검증 기본값을 혼동하지 않는다.

## 기존 요약 PDF 2개

보존된 `2026-11-08-samsung-pdf-summary/`의 파일을 변경하지 않고 메타데이터를 확인했다.

| 파일 | 이번 관측 | 해석 범위 |
|---|---|---|
| `samsung-kis-summary.pdf` | 2페이지·A4·Quartz PDFContext | 별도 시세 요약본. HTML 인쇄본 아님 |
| `samsung-opendart-summary.pdf` | 2페이지·A4·Quartz PDFContext | 별도 공시·재무 요약본. HTML 인쇄본 아님 |

KIS 요약본의 `pdffonts`에는 Pretendard·ChosunilboNM·Menlo 서브셋 포함이 표시된다.
이는 그 파일의 관측이며 새 변환물이나 다른 OS의 글꼴 포함을 보장하지 않는다.
기존 `verification-result.json`의 104 pass/0 fail은 과거 기록을 읽은 것으로 재실행한 결과가 아니다.
두 실제 요약 PDF·원문 데이터·페이지 이미지를 저장소에 복사하지 않는다.

## 합성 검증 방법과 남은 검수

서버 디렉터리에서 실행한다. 이미 설치된 Chrome 경로만 명시하며 자동 설치하지 않는다.
출력 디렉터리는 미리 만든 본인 소유 `0700` 디렉터리여야 한다.

```sh
npm ci --ignore-scripts
npm run build
node --test dist/test/report-pdf-export.test.js
node scripts/export-synthetic-pdf.mjs --chrome <설치된-Chrome-실행파일-절대경로> --output-dir <비공개-출력디렉터리-절대경로>
pdfinfo <출력디렉터리>/R01-synthetic.pdf
pdffonts <출력디렉터리>/R01-synthetic.pdf
pdftotext <출력디렉터리>/R01-synthetic.pdf <출력디렉터리>/text.txt
```

변환물 관측 결과는 검증 후 이 문서의 아래 절에 기록한다.
실제 결합 R01·기존 28+2 보고서의 페이지 전수 검수, CDN 실제 포함, Windows·Claude·ChatGPT의
저장·인쇄 화면은 미검증이다. #52 실화면 QA를 이 원형의 합성 시험으로 대체하지 않는다.

## 이번 원형의 실제 관측과 실패 범위

2026-11-10 macOS에서 설치된 Chrome(Skia/PDF m157)으로 고정 합성 R01 한 종류를 변환했다.
`npm run build`와 PDF·렌더러·CDN 회귀 시험 15건이 통과했다. 원형이 없을 때는 모듈 부재로
RED(build exit 2)를 확인했다. 첫 실제 출력에서는 과도한 URL 차단이 `data:` 로고도 막았다.
이미지 디코딩 검증을 넣어 실패(exit 1)를 재현한 뒤 HTTP·파일·WebSocket 등 외부 스킴만 차단했다.
최종 진단은 이미지 1개/디코딩 1개, 문서 HTTP 응답 0건이다.

- 최종 PDF: 1,403,353바이트, A4 9페이지, `pdfinfo`로 열림 확인.
- `pdftotext -bbox`: 1,315개 단어, 9페이지의 페이지 경계 밖 텍스트 상자 0개.
  도형·그림 잘림이나 모든 글리프의 시각적 표시까지 보증하는 검사가 아니다.
- `pdffonts`: 244개 글꼴 레코드 모두 포함 표시. Pretendard·MaruBuri·Gowun Batang 계열이 표시됐다.
  CDN을 차단한 산출물이므로 이를 CDN 글꼴 로드 성공으로 표시하지 않는다. 선택된 로컬 파일의
  출처·라이선스 대조와 다른 기기의 재현은 미검증이다.
- 초기 출력의 1·7·9페이지를 이미지로 열어 로고 누락과 막대 미표시를 관찰했다.
  최종 출력의 1·7·9페이지도 이미지로 열어 로고 복원과 막대 미표시 지속을 확인했다.
  전체 페이지의 육안 검수는 미검증이다.

**확인된 미완료 사항:** 현재 기준 HTML의 인쇄 CSS는 `.chart-scroll{display:none}`을 적용하지만
`chartFigure` 출력에는 이를 대신할 `.print-chart`가 없다. Chrome 측정에서도 차트 1개 중 숨김 1개,
PDF 7페이지에서 막대 대신 원수치 표만 남는 것을 확인했다.
근거는 `server/assets/report-runtime/original-report-layout.css:23`,
`server/src/report-template-renderer.ts:118`이다. #52 담당과 겹치는 HTML 렌더러는 이 PR에서 수정하지 않았다.
따라서 이 원형은 **실제 보고서의 완성된 PDF 내보내기 기능이 아니며**, 합성 시험 통과를
인쇄 레이아웃·차트 품질 통과로 바꾸어 보고하지 않는다. 최종 정책·실자료 연결·전체 페이지 QA는 후속 범위다.
