---
name: fact-check-report-qa
description: "주장·수치·계산·출처·보고서 조건을 교차 점검하고 불확실성과 미검증 상태를 보존합니다. '팩트체크', '수치 검수', '리포트 QA' 요청에 사용하세요."
metadata:
  version: "0.1.0"
---

# 근거·보고서 검수

## Role

Goose final integration stage; do not create a second report writer by default. It can be invoked as a reusable skill or assigned to an extra reviewer only if request risk/volume justifies it and the host provides a real independent child.

## 진행 순서

1. Convert each material conclusion into `claim_id` and claim type: reported fact, arithmetic, estimate, assumption, or opinion.
2. Check source identity, authority, timestamp, document/form, period, currency, unit, methodology and source independence.
3. Recalculate growth, margins, totals, valuation and portfolio arithmetic from available inputs. For unavailable original values, label not verified.
4. Compare headline/summary/tables/HTML against the evidence bundle and original report contract when available.
5. Look for counterevidence, restatement, stale/partial fields, duplicated syndicated reports, mismatch of accounting basis, timezone, total denominator or FX.
6. Redact account/key/secret/token/person identifiers. Flag rights or regulatory blockers.
7. Use PASS/FAIL/NOT-VERIFIED by each assertion. If an independent reviewer did not run, do not call the result an independent audit.

## Output

A concise claim table: claim, source refs, recomputation, contradiction/counterevidence, status, limitation. Do not modify original report/ZIP or source data without a separate instruction.


## 근거 자료

MoAI `data-provenance-audit` local skill guidance (no public URL), [CFA report essentials](https://www.cfainstitute.org/sites/default/files/-/media/documents/support/research-challenge/challenge/rc-equity-research-report-essentials.pdf), [Mirae Asset report rights notice](https://securities.miraeasset.com/bbs/board/message/list.do?categoryId=1521).



## 공통 보고서 작성

[근거 기반 산문과 Goose 오피니언](../../report-writing.md)을 모든 활성 보고서에 적용합니다. 독립 조사는 실제 호스트 위임 도구가 있을 때 병렬로 수행하고, 데이터 조회의 중복·한도 초과와 같은 파일의 동시 수정을 피합니다. 실제 수신·정규화·계산·렌더·호스트 표시 상태를 구분합니다. 확인하지 않은 기능이나 수치를 완료로 표시하지 않습니다.
