# 구독·결제 사건 상태기계 (설계 초안)

Refs #8.

- 상태: **초안(제안)**. 결제 공급자·가격·청구 주기·체험·환불 기준·유예 기간은 정하지 않습니다(이슈 제외 범위, #5 D-02). 실제 결제는 만들지 않습니다.
- 선행: 이슈 본문의 선행 #5(상품 계약 — `docs/design/product-tiers.md`)와 #7(권한 평가기, 미처리). 권한 평가기와 맞닿는 칸은 "#7 의존"으로 표시합니다.
- 코드 기준: main `fc3b16f`. 구독·entitlement 코드는 없습니다(2026-11-10 설계 감사, `subscription|entitlement` 검색에서 시장자료 경고 문구 외 0건).
- 작성: 2026-11-10 설계 감사.

## 1. 반영한 사용자 결정 (2026-11-10, #5 이슈 댓글)

| 결정 | 상태기계에 주는 영향 |
|---|---|
| 무료 = 로그인 필수 + R01·R07 | 구독이 없거나 끝나도 로그인 사용자는 무료 entitlement를 유지 |
| 유료 = 확장 기능 + 개인 계좌 분석 | 구독 상태가 `active`·`grace`(유예를 둔다면)일 때만 유료 entitlement |
| 수강생 = 수강 기간 동안 유료와 동일, **구독과 별도 권한** | 이 상태기계는 **구독만** 다룹니다. 수강생 권한은 별도 축(Learner grant)이고, entitlement = max(무료, 구독 유료, 수강 기간 중 유료) |

## 2. 원칙

1. **권한은 검증된 결제 사건으로만 오르내립니다.** 클라이언트 화면, 모델 입력, 결제 페이지 리다이렉트 결과 파라미터는 상태를 바꾸지 않습니다.
2. 사건은 서명 검증된 공급자 webhook 또는 공급자 API 조회 결과로만 받아들입니다(공급자는 결정 필요).
3. 상태 전이는 서버 한 곳(구독 저장소)에서만 씁니다 — 단일 writer.
4. entitlement는 상태에서 **계산**하고 따로 저장하지 않습니다(어긋남 방지). 캐시하면 사건 반영 즉시 무효화합니다.
5. 개인 금융정보(카드번호 등)는 저장하지 않습니다. 공급자 고객 ID·구독 ID만 저장합니다.

## 3. 상태

| 상태 | 유료 entitlement | 설명 |
|---|---|---|
| `none` | 아니오 | 구독 이력 없음 |
| `pending` | 아니오 | 결제 시작, 확정 사건 전 |
| `trialing` | 예(체험을 둔다면) | 체험 기간 — 체험 여부 **결정 필요** |
| `active` | 예 | 정상 |
| `past_due` | 결정 필요(유예) | 갱신 결제 실패, 재시도 중 |
| `canceled_pending_end` | 예(기간 끝까지) | 해지 예약, 현재 기간은 유지 |
| `expired` | 아니오 | 기간 종료 |
| `refunded` | 아니오 | 환불 완료 — 기간 남아도 즉시 종료(환불 규칙 **결정 필요**) |
| `disputed` | 결정 필요 | 지불 거절·분쟁 |

## 4. 사건과 전이

| 현재 | 사건(검증된 것만) | 다음 |
|---|---|---|
| `none`/`expired` | `checkout.completed` | `pending` |
| `pending` | `payment.succeeded` | `active` (체험이면 `trialing`) |
| `pending` | `payment.failed` / 시간 초과 | `none` |
| `trialing` | `trial.ended` + `payment.succeeded` | `active` |
| `trialing` | `trial.ended` + 결제 실패 | `past_due` 또는 `expired` (결정 필요) |
| `active` | `renewal.succeeded` | `active` (기간 연장) |
| `active` | `renewal.failed` | `past_due` |
| `past_due` | `payment.succeeded` 또는 `renewal.succeeded` (갱신 재시도 성공) | `active` (기간 연장) |
| `past_due` | 재시도 소진 / 유예 종료 | `expired` |
| `active`/`trialing` | `subscription.cancel_requested` | `canceled_pending_end` |
| `canceled_pending_end` | `subscription.resumed` | `active` |
| `canceled_pending_end` | 기간 종료 | `expired` |
| `active`/`canceled_pending_end`/`past_due` | `refund.succeeded` (전액) | `refunded` |
| `active` 등 | `dispute.opened` | `disputed` |
| `disputed` | `dispute.won` / `dispute.lost` | 이전 상태 / `refunded` |

사건 이름은 설명용이며 공급자 사건 이름에 맞춰 매핑합니다(공급자 결정 후). 표에 없는 (상태, 사건) 조합은 상태를 바꾸지 않고 기록한 뒤 공급자 API 조회로 현재 상태를 맞춥니다(§5 유실 대사와 같은 경로).

## 5. 멱등·순서 역전·중복·지연

| 문제 | 처리 |
|---|---|
| **중복 사건** | 공급자 사건 ID를 유일 키로 저장. 이미 처리한 ID는 200 응답만 하고 무시 |
| **순서 역전** | 사건마다 공급자 발생 시각과 구독 판본(공급자가 주는 순번이 있으면 그것)을 저장. 저장된 판본보다 오래된 사건은 상태를 되돌리지 않고 기록만 함. 순번이 없으면 사건을 받은 뒤 공급자 API로 현재 구독 상태를 조회해 그 값으로 맞춤 |
| **지연** | 기간 종료는 사건을 기다리지 않고 저장된 `current_period_end`로 계산. 만료 사건이 늦게 와도 그 사이 유료 entitlement는 이미 꺼져 있음 |
| **유실** | 주기적으로 공급자 API와 대사(주기 **결정 필요**). 차이가 나면 공급자 값 우선, 차이 기록 |
| **서명 실패** | 거부(4xx), 상태 변화 0, 보안 기록 |
| **동시 처리** | 같은 구독의 사건은 구독 ID 단위로 직렬 처리 |

## 6. entitlement 반영 (#7 의존)

- 상태가 바뀌면 그 사용자의 entitlement 캐시를 즉시 무효화하고, 다음 도구 호출에서 다시 계산합니다.
- 유료 → 무료로 내려가도 **사용자 PC의 계좌 자료는 지우지 않습니다**(#9 결정: 지울 때까지 보관). 유료 기능으로 다시 여는 것만 막습니다.
- 실행 중인 유료 작업은 `blocked`로 바꾸고 사용자에게 알립니다(`docs/design/durable-job-and-stock-link.md` §2.2).
- 수강 기간이 남아 있으면 구독이 끝나도 유료 entitlement가 유지됩니다(Learner grant 축).

## 7. 시험 설계

| # | 시험 | 기대 |
|---|---|---|
| S1 | 같은 `payment.succeeded`를 두 번 전달 | 상태 전이 1회 |
| S2 | `renewal.succeeded`가 `renewal.failed`보다 먼저 도착(발생은 반대) | 최종 `active`, 되돌림 없음 |
| S3 | 만료 사건 유실 | `current_period_end` 지나면 유료 entitlement 꺼짐 |
| S4 | 서명 불량 webhook | 거부, 상태 변화 0 |
| S5 | 결제 페이지 리다이렉트의 `success=true`만 있음 | 상태 변화 0 |
| S6 | 해지 예약 후 기간 중 | 유료 유지, 종료 시 무료 |
| S7 | 전액 환불 | 즉시 무료 |
| S8 | 구독 만료 + 수강 기간 중 | 유료 유지(Learner grant) |
| S9 | 구독 만료 + 수강 기간 종료 | 무료 |
| S10 | 유료 → 무료 전환 뒤 PC의 계좌 자료 | 그대로 있음, 유료 기능 호출은 `entitlement_required` |
| S11 | 같은 구독 사건 동시 2건 | 직렬 처리, 최종 상태 일관 |
| S12 | 대사에서 공급자와 다름 | 공급자 값으로 맞추고 기록 |
| S13 | 저장 데이터에 카드번호 등 결제 수단 원문 | 0건 |
| S14 | `renewal.failed` 뒤 갱신 재시도가 성공해 `renewal.succeeded` 도착 | `past_due` → `active`, 기간 연장, 전이표에 없는 (상태, 사건) 조합 0 |

## 8. 결정 필요

| ID | 결정 |
|---|---|
| B-01 | 결제 공급자 |
| B-02 | 가격·청구 주기 (#5 D-02) |
| B-03 | 체험 여부·기간 |
| B-04 | `past_due` 유예 기간과 그동안 유료 유지 여부 |
| B-05 | 환불 규칙(전액·부분, 즉시 종료 여부) |
| B-06 | 분쟁 중 entitlement |
| B-07 | 대사 주기 |
| B-08 | 권한 평가기 연결(#7) |
