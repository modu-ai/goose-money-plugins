# PDF 내보내기: 고정 CDN 글꼴과 합성 검증 원형

Refs #24. 조사 기준은 2026-11-10의 main `45bf490fb74ad1291dad956b11d0bd4c134393bf`이다.
#52의 HTML 실화면 QA를 기다리지 않고 독립 범위부터 진행한다는 사용자 지시를 반영했다.
후속 기준 main은 `83441146cdbd0c6dbceb4f13405abd5152fe8617`이며, 사용자 결정에 따라
PDF 글꼴은 **CDN 로드 후 PDF 출력**으로 정했다.
실제 보고서의 인쇄 품질이나 출시 완료를 판정하는 문서가 아니다.

## 현재 제공하는 범위

`server/src/report-pdf-export.ts`는 합성으로 표시된 `ActiveReportInput`만 받는 원형이다.
명시적 확인과 사용자가 지정한 비공개 디렉터리가 필요하다. 실제·혼합·사용자 제공 모드,
비합성 출처, 다른 사용자에게 열린 디렉터리, 디렉터리 자체의 심볼릭 링크는 거부한다.
렌더러는 호스트가 주입하며 고정 CDN 글꼴 외 요청 차단과 취소 시 프로세스 종료를 담당한다.
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

합성 검증 도구는 페이지를 `about:blank`로 만들고 HTML과 같은 버전 고정 CDN 글꼴 URL만
허용한 뒤 HTML 문자열을 주입한다. 기존 사용자 브라우저·쿠키·프로필은 사용하지 않는다.
허용 URL은 보고서 입력에서 받지 않고 저장소의 글꼴 CSS에서 얻는다. 정확히 일치하는
`Font` 종류의 `GET`만 허용하며 쿼리·다른 URL·리다이렉트는 거절한다.
허용 요청의 헤더 전체를 고정 `Origin: null`로 교체하므로 보고서 URL·Referer·쿠키·인증 헤더를
넘기지 않는다. 실제 전송 헤더 이벤트도 요청 ID로 대조하며, 위반이 관측되면 저장 전에 거절한다.
이벤트가 없는 요청 수는 별도로 표시하며 관측하지 못한 헤더를 검증 완료로 바꾸지 않는다.
인쇄 전과 브라우저 종료 후 두 번 검사하고 자신이 만든 프로필을 삭제한다.
`Page.printToPDF`로 A4 출력을 요청하고, 취소·성공·실패 뒤 자신이 만든 브라우저와 프로필을 정리한다.
이 도구는 거부된 실제 보고서 화면을 우회해 열거나 검수하기 위한 수단이 아니다.
사용자가 별도 승인한 고정 합성 fixture의 변환만 수행한다.

[Chrome 공식 Page 프로토콜](https://chromedevtools.github.io/devtools-protocol/tot/Page/)과
[Network 프로토콜](https://chromedevtools.github.io/devtools-protocol/tot/Network/),
[Fetch 프로토콜](https://chromedevtools.github.io/devtools-protocol/tot/Fetch/)을 사용한다.
표준 인쇄 기능을 사용해도 내장 UI·호스트 지원이나 실제 PDF의 모양이 자동으로 검증되지는 않는다.

## 글꼴: CDN 로드 후 PDF 출력으로 결정

HTML은 기존 사용자 결정대로 고정 CDN 글꼴을 유지한다. 이 PR은 HTML 글꼴·CSP를 바꾸지 않는다.
PDF도 같은 고정 CDN 글꼴을 불러온다. 다음은 결정 당시 비교한 선택지다.

| 선택지 | 조건과 확인할 것 |
|---|---|
| 시스템 글꼴 의존 | 설치 글꼴과 대체 글꼴이 OS마다 다름. 한글·기호 표시와 페이지 재배치 확인 필요 |
| 라이선스 확인 후 임베딩 | 글꼴별 재배포·서브셋 허용 원문, 실제 PDF 포함, 저작권 고지 확인 필요 |
| CDN 로드 후 PDF 출력 | 고정 URL·권리·Referer·보고서 정보 비전송을 유지하고 로드 완료 및 PDF 내 실제 포함을 확인해야 함 |

PDF에서는 신뢰한 글꼴 CSS의 `local()` 우선 경로만 제거해 설치된 MaruBuri가 CDN 로드를
대신하지 않도록 한다. 공유 HTML CSS와 일반 대체 글꼴 스택은 유지한다.
`document.fonts.ready`와 이미지 디코딩·두 프레임의 배치를 기다린 뒤 인쇄한다.
`--block-font-network`는 글꼴 요청을 차단해 대체 경로를 검사하는 합성 진단 옵션이다.
원형의 결과는 `font_policy=cdn_load_then_pdf`, `font_embedding=not_verified`,
`page_review=not_verified`로 반환한다. 정책 결정만으로 매 출력의 글꼴 포함·페이지 검수를
자동 완료 처리하지 않는다.
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
node --test dist/test/report-pdf-export.test.js dist/test/pdf-renderer-abort.test.js dist/test/pdf-renderer-cdn.test.js dist/test/report-fonts-cdn.test.js
node scripts/export-synthetic-pdf.mjs --chrome <설치된-Chrome-실행파일-절대경로> --output-dir <비공개-출력디렉터리-절대경로>
pdfinfo <출력디렉터리>/R01-synthetic.pdf
pdffonts <출력디렉터리>/R01-synthetic.pdf
pdftotext <출력디렉터리>/R01-synthetic.pdf <출력디렉터리>/text.txt
# 별도 비공개 출력 디렉터리에서 같은 합성 입력의 차단·대체 경로 확인
node scripts/export-synthetic-pdf.mjs --chrome <설치된-Chrome-실행파일-절대경로> --output-dir <다른-비공개-출력디렉터리> --block-font-network
```

변환물 관측 결과는 검증 후 이 문서의 아래 절에 기록한다.
실제 결합 R01·기존 28+2 보고서의 페이지 전수 검수, CDN 실제 포함, Windows·Claude·ChatGPT의
저장·인쇄 화면은 미검증이다. #52 실화면 QA를 이 원형의 합성 시험으로 대체하지 않는다.

## 최초 원형의 관측과 실패 범위 (당시 기준)

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

**최초 원형에서 확인한 미완료 사항:** 당시 HTML의 인쇄 CSS는 `.chart-scroll{display:none}`을 적용하지만
`chartFigure` 출력에는 이를 대신할 `.print-chart`가 없다. Chrome 측정에서도 차트 1개 중 숨김 1개,
PDF 7페이지에서 막대 대신 원수치 표만 남는 것을 확인했다.
근거는 `server/assets/report-runtime/original-report-layout.css:23`,
`server/src/report-template-renderer.ts:118`이다. #52 담당과 겹치는 HTML 렌더러는 이 PR에서 수정하지 않았다.
이 기록은 최초 조사 기준의 관측이며 이후 HTML 변경의 검증 결과는 아니다.
이 원형은 **실제 보고서의 완성된 PDF 내보내기 기능이 아니며**, 합성 시험 통과를
실제 보고서의 인쇄 레이아웃·차트 품질 통과로 바꾸어 보고하지 않는다.
실자료 연결·전체 페이지 QA는 후속 범위다.

## CDN 정책 후속 검증

기준 main `8344114`에서 macOS Chrome 157.0.8103.39와 Poppler 26.02.0으로
고정 합성 R01을 온라인·차단 모드 각각 변환했다. 실제 보고서 폴더·공급자 API·사용자 키는
이번 검증에서 읽거나 호출하지 않았다.

| 관측 | CDN 허용 | 글꼴 네트워크 차단 |
|---|---|---|
| 출력 | A4 9페이지, 1,266,366바이트 | A4 9페이지, 1,890,700바이트 |
| 웹 글꼴 | 로드 26개, 실패 0개, 세 계열 모두 로드 | 로드 0개, 실패 27개, 대체 글꼴로 출력 |
| 요청 정책 | 정확한 고정 글꼴 URL 26개만 허용 | 27개 요청 거절, 허용 0개 |
| 실제 전송 헤더 | 26개 관측, 누락·미결합 0개, 민감 헤더·비허용 URL 0개 | 실제 전송 이벤트 0개, 차단 요청의 전송 헤더는 관측 대상 아님 |
| `pdffonts` | 97개 레코드 모두 `emb=yes`, `uni=yes` | 141개 레코드 모두 `emb=yes`, `uni=yes` |
| 텍스트 경계 | 1,324개 단어, 페이지 경계 밖 상자 0개 | 1,695개 단어, 페이지 경계 밖 상자 0개 |

온라인 요청은 Pretendard 11개·MaruBuri 2개·Gowun Batang 13개의 고정 URL이다.
PDF에는 세 계열의 글꼴 이름이 표시됐다. 차단 산출물에 설치 글꼴 이름이 표시되는 것은
대체 경로의 관측이며 CDN 로드 성공 근거가 아니다. 변경 전 요청 이벤트에 나타난 헤더와
가로채기 후 실제 전송 헤더를 구분해 검사했다. PDF에 포함된 글꼴 레코드의 관측은
원래 WOFF2 파일 전체가 그대로 포함되거나 다른 OS에서 같은 배치가 된다는 뜻은 아니다.

양쪽 출력의 1·7페이지를 이미지로 열어 한글·숫자·로고와 대체 경로의 줄바꿈 차이를 확인했다.
전체 페이지 육안 검수는 미검증이다. **합성 PDF에서도 막대 그래프는 숨겨지고 원수치 표만
남는 기존 인쇄 문제가 계속 관측됐다**(차트 1개, 숨김 1개). 이번 글꼴 변경은 HTML 인쇄 CSS를
수정하지 않았다. 실제 보고서 전체 페이지 검수는 사용자 배차대로 #52 결과 이후 진행한다.

회귀 시험은 새 경로의 최초 3실패, 인쇄 중 늦은 헤더 이벤트 1실패, 설치 글꼴 우선 경로
2실패를 각각 먼저 관측한 뒤 수정했다. 최종 `npm run build`와 위 명령의 관련 19개 시험이
통과했다. 실제 CDN 출력과 차단 출력의 관측을 전체 CI·다른 OS·실제 보고서 검수로 확대하지 않는다.
