# 보고서 산출물 계보와 라벨 정정안

Refs #26 · 기준 `838217231d33c137767c45982d00e58343b1eb1e`

## 판 구분

샘플의 `archive`라는 폴더 이름만으로 API 원본 여부를 판단하지 않습니다. 2026-11-10 아래 HTML 파일의 SHA-256을 직접 계산했습니다. 보고서 루트는 사용자 PC의 `reports/`이며 이 저장소에 포함하지 않습니다.

| 구분 | 보고서 루트 아래 경로 | SHA-256 |
|---|---|---|
| API 원본으로 기록된 OpenDART HTML | `2026-11-08-samsung-R01-opendart/actual-report.html` | `574b391a13649142bdcdbe87c2da1cd186421ec481b9e34f4769ef92edd24657` |
| API 원본으로 기록된 KIS HTML | `2026-11-08-samsung-R01-kis/actual-report.html` | `4f8359723071dc063198d9a7fd95558a27e578c68cada98ad410e515b59d217f` |
| OpenDART v3 표시본 | `2026-11-08-samsung-display-v3/opendart-display-v3.html` | `a8cfdeed176208806131bba39ca475177d17a99c84e80799ac0842bd62ca822c` |
| KIS v3 표시본 | `2026-11-08-samsung-display-v3/kis-display-v3.html` | `86753f83e576efe8f3f4d64ec1b74ff593c864ad78fe9b67fed8ae4f15892721` |
| 별도 KIS 로컬 재렌더본 | `2026-11-08-local-regeneration/samsung-kis-archive-rerender.html` | `7c0761d67ccc0d88b7c7b1f5032c5feced9483209a16b023f921b2c107dcf980` |
| 별도 OpenDART 로컬 재렌더본 | `2026-11-08-local-regeneration/samsung-opendart-archive-rerender.html` | `a4326ff4b132c8c7035caf1bd59338b01ec6941915cbaefe7e49b34f511f13c6` |

`2026-11-09-samsung-skhynix-samples/archive/`와 `2026-11-09-public-evidence-followup/user-package/archive/`의 `samsung-opendart-display-v3.html`·`samsung-kis-display-v3.html`은 각각 위 v3 표시본과 같은 전체 해시입니다. API 원본으로 기록된 HTML과는 다릅니다. 이번 검증은 파일 간 동일성만 확인했으며 API 수집을 다시 실행하거나 API 응답과의 연결을 새로 검증하지 않았습니다.

표시 라벨은 **“보존된 실제 입력을 사용한 v3 오프라인 재렌더본(API HTML 원본과 다름)”**으로 구분합니다. `local-regeneration`의 두 파일도 샘플 archive와 다른 판으로 표기합니다.

## 저장소 밖 manifest 정정 제안

[이슈 #26의 기존 정정 기록](https://github.com/modu-ai/goose-money-plugins/issues/26#issuecomment-6754547113)을 구체화한 제안입니다. 해당 manifest는 Git 추적 대상이 아니므로 이 PR에서 수정하지 않습니다.

| 대상 | 제안 |
|---|---|
| 두 샘플 manifest의 archive 항목 `kind` | `previously_created_actual_partial_report` → `offline_display_v3_rerender_of_actual_partial_report` |
| API HTML 동일성 | `api_html_hash_match: false`를 명시 |
| 계보 | v3 `source_path`와 별도 `api_original_path`·`api_original_sha256`을 구분해 기록 |
| 호환성 | 상위 키 `archived_real_partial_reports`는 소비 코드 확인 전 변경하지 않음 |
| 기존 SHA·복사 정보 | 파일 자체를 바꾸지 않으면 보존. 전체 64자리 해시는 위 표와 실제 파일을 대조 |
| 전달된 zip·SHA256 목록 | 기존 묶음은 보존. 정정본을 만들기로 결정하면 새 버전의 묶음과 체크섬 생성 |

manifest 소비 스크립트와 전달 묶음 재생성은 이번 범위에서 검증하지 않았습니다. 정정 적용과 재배포는 별도 결정이 필요합니다.

## PDF 상태 정정

`2026-11-08-samsung-pdf-summary/`의 `samsung-kis-summary.pdf`(571335 bytes)와 `samsung-opendart-summary.pdf`(574458 bytes)는 이번에 파일 존재와 크기를 확인했습니다. 보존된 `kis-pdfinfo.txt`·`opendart-pdfinfo.txt`는 각각 `Pages: 2`, `Page size: 595.276 x 841.89 pts (A4)`를 기록합니다. `generation-result.json`도 두 건 모두 `pages: 2`, `html_print_test: false`, `new_provider_requests: 0`을 기록합니다.

따라서 사전 조사 문서의 “PDF 아직 수행하지 않음”은 **“HTML 인쇄 PDF 검수는 미수행이며, 별도 요약 PDF 시제품 두 개가 존재함”**으로 구분하는 정정안입니다. 기존 요약 PDF 존재는 HTML 인쇄·글꼴 포함·실제 페이지 검수 또는 제품 PDF 내보내기 완료의 근거가 아닙니다. 이번에는 PDF를 열거나 `pdfinfo`를 다시 실행하지 않았습니다.

저장소 밖 사전 조사 문서에는 원본 HTML 위치, v3 archive와 로컬 재렌더본의 차이, 요약 PDF 위치와 `html_print_test: false`를 함께 적도록 제안합니다. 그 원본 문서도 이번 PR에서 변경하지 않습니다.
