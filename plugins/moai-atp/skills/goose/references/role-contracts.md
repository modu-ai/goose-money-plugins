# 내부 역할 산출 계약

이 문서는 `/goose` 가 내부 전문 절차(`strategy`·`backtest`·`research`·`holdings`·`performance`·`report`)를 연결할 때 각 절차가 내는 산출의 머리(봉투)와 빈칸·실패·인계 규칙을 정합니다. 공개 스킬이나 명령이 아니며 새 도구·MCP 서버·환경 스위치·계약 스키마 파일을 만들지 않습니다. 예시는 모두 합성이며 실제 자료·계좌·키를 담지 않습니다. 이름이 정해지지 않은 산출 계약의 예시는 `synthetic:` id 를 씁니다.

현재 백테스트 엔진, 성과 원장, 리스크 엔진(risk engine), 전략 실행 엔진은 없습니다. 있는 결정적 계산은 사용자 자산곡선의 최대낙폭과 사용자 장부의 포지션 비중 HHI 함수뿐이며 이 두 함수는 엔진이 아닙니다. 별도 shadow·paper 실행 계약이나 산출도 없습니다.

## 흐름과 의존 순서

요청은 다음 순서로 처리합니다: 목적 분류 → 필요한 입력·자료 권한 확인 → 내부 전문 절차·위임 → 결정적 계산·수치/근거 검증 → 통합 보고

- 절차가 둘 이상 필요하면 strategy → backtest → report, research → report 의 의존 순서를 지킵니다.
- 의존 순서는 식별·근거 기반 → 성과 원장·위험 계산 → 리서치 실행(식별·근거 기반은 SPEC-ATP-R02C-001·SPEC-ATP-RCARD-001, 성과 원장·위험 계산은 SPEC-ATP-BTEST-001)이며, 앞 단계가 착지하기 전에는 그것에 기대는 산출은 `not_run` 과 사유로 냅니다.
- 위의 결정적 함수는 엔진이 아니므로 이 순서와 무관하게 쓸 수 있습니다.
- 호스트가 위임 도구와 권한을 제공해 독립 조사를 위임하면 공급자 요청 소유자는 한 명, 최종 writer 도 한 명입니다. 위임 도구나 권한이 없으면 같은 단계를 메인 문맥에서 순차로 수행하고 출력에 `순차 실행`이라고 표기합니다. 동적 스킬 호출이나 서브에이전트를 가정하지 않으며 하지 않은 병렬·독립 실행을 했다고 쓰지 않습니다.

## 공통 봉투

모든 내부 절차의 산출은 아래 열두 키를 이 순서로 가진 봉투를 머리로 둡니다. 알 수 없는 칸은 `null` 과 사유로 둡니다.

| 키 | 뜻 | 없을 때 |
|---|---|---|
| `contract` | 산출 계약 id 와 판 | 필수 |
| `procedure` | `strategy`·`backtest`·`research`·`holdings`·`performance`·`report` | 필수 |
| `target` | 종목·상품 identity 또는 universe 와 `identity_status`(`confirmed`·`candidate`·`unresolved`) | `null` + `target_unspecified` |
| `period` | `start`·`end`·`kind` | `null` + `period_unspecified` |
| `cutoff` | `at_utc`(정확한 UTC 순간)와 `display_tz` | `null` + `cutoff_unspecified` → `blocked` |
| `sources[]` | `source_id` 또는 도구 이름, URL·판, `received_at`, `provider_as_of` | 빈 배열 + `no_source` |
| `units[]` | 필드별 `unit`·`scale`·`currency`·`status` | 미확인 표시, 합산 금지 |
| `versions` | 스킬·계약·서버 패키지 판 | 필수 |
| `evidence_ids[]` | 같은 서버 프로세스가 발급하고 검증한 출처 영수증 ID, 연구카드 착지 뒤에는 연구카드 ID | 빈 배열 + `evidence_unbound` |
| `status` | `ready`·`partial`·`not_run`·`blocked`·`unsupported` | 필수 |
| `reasons[]` | 아래 사유 코드 | `ready` 가 아니면 1개 이상 |
| `execution` | `authority`(`plan_only`·`local_deterministic`), `order_sent: false`(상수), `provider_dispatches` | 필수 |

`cutoff` 가 `null` 이면 `ready` 가 아닙니다. 계획기가 막은 요청(`blocked`·`unsupported`)이나 앞 단계 때문에 시작하지 못한 절차(`not_run`)는 그 사유 하나를 `reasons[]` 에 두고 계산하지 못한 칸은 `null` 로 둡니다. 정규 JSON 해시(`canonical_sha256` 등)는 정규 직렬화에 대한 요약이며 공급자 원응답이 아닙니다.

### 기간·출처가 없을 때

이 절의 규칙은 전략·리서치·보유·보고처럼 이 플러그인의 내부 절차가 내는 봉투에 걸립니다.

| 경우 | 봉투 | 상태 |
|---|---|---|
| 요청에 기간 없음 | `period: null` 과 `reasons[]` 의 `period_unspecified` | `ready` 가 아니며 다른 규칙이 `blocked`·`unsupported`·`not_run` 을 내지 않으면 `partial` |
| 출처 기록 없음 | `sources: []` 와 `reasons[]` 의 `no_source`(출처에 묶이지 않은 주장은 제외) | 같음 |
| 둘 다 | 두 사유 모두(위 순서) | 같음 |

- 두 사유 어느 것도 그것만으로 `blocked` 를 내지 않습니다. `blocked` 는 `cutoff_unspecified` 쪽입니다. 성과 요청은 `unsupported` 와 `performance_inputs_missing` 이 정합니다.
- 계산기에 넘길 때는 요청의 기간과 출처 기록을 받은 그대로(`null`·빈 배열 포함) 넘깁니다. 기본 기간을 채우거나 출처를 추정하지 않으며 계산기 결과 봉투에 `period_unspecified`·`no_source` 를 더하지 않습니다.
- 계산기 결과 봉투의 `period`·`sources[]`·`status`·`reasons[]` 를 채우는 방식은 SPEC-ATP-BTEST-001 design.md §2.5 가 정하며 이 문서는 다시 적지 않습니다.

**예시 research-period-missing**

```json
{
  "request": {
    "text": "synthetic research question about EQ-A",
    "period": null,
    "sources": [{"source_id": "synthetic:filing-1", "received_at": "2021-01-04T00:10:00Z", "provider_as_of": "2020-12-30"}]
  },
  "envelope": {
    "contract": "synthetic:research-note",
    "procedure": "research",
    "target": {"ref": "synthetic:EQ-A", "identity_status": "confirmed"},
    "period": null,
    "cutoff": {"at_utc": "2021-01-04T00:00:00Z", "display_tz": "Asia/Seoul"},
    "sources": [{"source_id": "synthetic:filing-1", "version": "v1", "received_at": "2021-01-04T00:10:00Z", "provider_as_of": "2020-12-30"}],
    "units": [],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": ["synthetic:receipt-0001"],
    "status": "partial",
    "reasons": ["period_unspecified"],
    "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0},
    "claims": [{"claim_id": "c1", "kind": "fact", "evidence_ids": ["synthetic:receipt-0001"]}],
    "counterevidence": [],
    "unresolved": [],
    "excluded_sections": []
  }
}
```

**예시 research-source-missing**

```json
{
  "request": {
    "text": "synthetic research question about EQ-A",
    "period": {"start": "2020-01-02", "end": "2020-12-30", "kind": "requested"},
    "sources": []
  },
  "envelope": {
    "contract": "synthetic:research-note",
    "procedure": "research",
    "target": {"ref": "synthetic:EQ-A", "identity_status": "confirmed"},
    "period": {"start": "2020-01-02", "end": "2020-12-30", "kind": "requested"},
    "cutoff": {"at_utc": "2021-01-04T00:00:00Z", "display_tz": "Asia/Seoul"},
    "sources": [],
    "units": [],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "partial",
    "reasons": ["no_source", "evidence_unbound"],
    "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0},
    "claims": [],
    "counterevidence": [],
    "unresolved": ["no source record was supplied, so no factual or numeric claim is made"],
    "excluded_sections": []
  }
}
```

**예시 research-both-missing**

```json
{
  "request": {"text": "synthetic research question about EQ-A", "period": null, "sources": []},
  "envelope": {
    "contract": "synthetic:research-note",
    "procedure": "research",
    "target": {"ref": "synthetic:EQ-A", "identity_status": "confirmed"},
    "period": null,
    "cutoff": {"at_utc": "2021-01-04T00:00:00Z", "display_tz": "Asia/Seoul"},
    "sources": [],
    "units": [],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "partial",
    "reasons": ["period_unspecified", "no_source", "evidence_unbound"],
    "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0},
    "claims": [],
    "counterevidence": [],
    "unresolved": ["no period and no source record were supplied"],
    "excluded_sections": []
  }
}
```

**예시 handoff-calculator**

```json
{
  "request": {"period": null, "sources": []},
  "envelope": {
    "contract": "synthetic:research-note",
    "procedure": "research",
    "target": {"ref": "synthetic:EQ-A", "identity_status": "confirmed"},
    "period": null,
    "cutoff": {"at_utc": "2021-01-04T00:00:00Z", "display_tz": "Asia/Seoul"},
    "sources": [],
    "units": [],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "partial",
    "reasons": ["period_unspecified", "no_source", "evidence_unbound"],
    "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0}
  },
  "calculator_request": {"period": null, "sources": []},
  "t35_added_reasons_to_calculator_result": []
}
```

## 인계, 중간 실패, 자료 누락

- 받는 절차는 입력을 쓰기 전에 봉투의 계약 판·cutoff·target identity·단위가 기대와 같은지 대조하고, 하나라도 다르면 값을 맞추어 쓰지 않고 `blocked` 와 `handoff_contract_mismatch` 로 끝냅니다.
- 한 단계가 실패하거나 `not_run`·`blocked`·`unsupported` 이면 그것에 기대는 모든 뒤 단계는 `not_run` 과 `upstream_not_completed:<step id>` 를 내고 전체를 완료로 보고하지 않습니다.
- 빠진 필드는 `null` 과 사유로 두고 영향을 받는 절을 사유와 함께 제외하며 0·이전 값·다른 단위·다른 출처로 대체하지 않습니다.

**예시 handoff-mismatch**

```json
{
  "request": {
    "receiver": "report",
    "expected": {"contract": "moai.atp.backtest-result.v1", "cutoff": "2021-01-04T00:00:00Z", "target": "synthetic:EQ-A", "units": "KRW"},
    "received": {"contract": "moai.atp.backtest-result.v0", "cutoff": "2021-01-04T00:00:00Z", "target": "synthetic:EQ-A", "units": "KRW"}
  },
  "envelope": {
    "contract": "synthetic:report",
    "procedure": "report",
    "target": null,
    "period": null,
    "cutoff": null,
    "sources": [],
    "units": [],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "blocked",
    "reasons": ["handoff_contract_mismatch"],
    "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0},
    "input_used": false
  }
}
```

**예시 upstream-propagation**

```json
{
  "request": {
    "steps": ["strategy", "backtest", "report"],
    "own_results": {"strategy": {"status": "blocked", "reasons": ["cutoff_unspecified"]}}
  },
  "envelope": {
    "contract": "synthetic:report",
    "procedure": "report",
    "target": null,
    "period": null,
    "cutoff": null,
    "sources": [],
    "units": [],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "not_run",
    "reasons": ["upstream_not_completed:backtest"],
    "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0},
    "step_results": [
      {"step": "strategy", "status": "blocked", "reasons": ["cutoff_unspecified"]},
      {"step": "backtest", "status": "not_run", "reasons": ["upstream_not_completed:strategy"]},
      {"step": "report", "status": "not_run", "reasons": ["upstream_not_completed:backtest"]}
    ],
    "complete": false
  }
}
```

**예시 unit-unconfirmed**

```json
{
  "request": {"field": "market_value", "unit_status": "unconfirmed", "prior_value": "123"},
  "envelope": {
    "contract": "synthetic:report",
    "procedure": "report",
    "target": {"ref": "synthetic:EQ-A", "identity_status": "confirmed"},
    "period": null,
    "cutoff": {"at_utc": "2021-01-04T00:00:00Z", "display_tz": "Asia/Seoul"},
    "sources": [],
    "units": [{"field": "market_value", "unit": null, "scale": null, "currency": null, "status": "unconfirmed"}],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "partial",
    "reasons": ["unit_unconfirmed"],
    "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0},
    "figures": [{"field": "market_value", "value": null, "reasons": ["unit_unconfirmed"]}],
    "excluded_sections": [{"section": "valuation", "reason": "unit_unconfirmed"}]
  }
}
```

## 수치 추적과 검수

- 통합 보고의 모든 수치는 입력의 SHA-256 을 가진 결정적 함수 또는 증거 ID 로 추적합니다. 추적이 없는 수치는 그 절을 `blocked` 와 `numeric_trace_missing` 으로 만듭니다.
- 통합 보고를 보여 주기 전에 `fact-check-report-qa` 절차를 적용하고, 호스트의 위임 도구로 독립 검수자를 쓸 수 없으면 검수를 `same-context self-check, not independent` 로 기록합니다.

**예시 numeric-trace**

```json
{
  "request": {"purpose": "synthetic integrated report"},
  "envelope": {
    "contract": "synthetic:report",
    "procedure": "report",
    "target": {"ref": "synthetic:EQ-A", "identity_status": "confirmed"},
    "period": {"start": "2020-01-02", "end": "2020-12-30", "kind": "requested"},
    "cutoff": {"at_utc": "2021-01-04T00:00:00Z", "display_tz": "Asia/Seoul"},
    "sources": [{"source_id": "synthetic:filing-1", "version": "v1", "received_at": "2021-01-04T00:10:00Z", "provider_as_of": "2020-12-30"}],
    "units": [],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": ["synthetic:receipt-0001"],
    "status": "partial",
    "reasons": ["numeric_trace_missing"],
    "execution": {"authority": "local_deterministic", "order_sent": false, "provider_dispatches": 0},
    "sections": [
      {
        "id": "s1",
        "status": "ready",
        "reasons": [],
        "numbers": [
          {"label": "synthetic ratio", "value": "12.5", "trace": {"function_id": "synthetic.ratio", "inputs_sha256": "e979b29ee8bcaf3f544784e34d467b70c683ab5d09e55c25e3b435245a77ccff"}},
          {"label": "quoted figure", "value": "1000", "trace": {"evidence_id": "synthetic:receipt-0001"}}
        ]
      },
      {
        "id": "s2",
        "status": "blocked",
        "reasons": ["numeric_trace_missing"],
        "numbers": [{"label": "untraced figure", "value": "45", "trace": null}]
      }
    ],
    "review": {"procedure": "fact-check-report-qa", "independent": false, "label": "same-context self-check, not independent"}
  }
}
```

## 전략 명세 `moai.atp.strategy-spec.v1`

전략 절차는 버전이 고정된 전략 명세를 냅니다. 봉투 열두 키에 더해 칸은 `strategy_id`, `version`, `universe`, `signal`(관측 입력과 산식 id), `entry_timing`·`exit_timing`(신호를 관측한 시각과 체결할 수 있는 다음 시각을 분리), `sizing`, `constraints`, `invalidation_rules`, `undecided_rules`, `required_data`, `cost_fill_assumptions`(근거가 없으면 `null`), `source_ledger`, `validation_plan`, `spec_sha256` 입니다.

`spec_sha256` 은 SPEC-ATP-BTEST-001 design.md §2.4 정본 문단 (1)이 정한 대로 계산한 값이며 이 문서는 해시 범위를 따로 정의하지 않습니다. 아래 예시의 `spec_sha256` 값은 합성 명세에 대해 그 정의대로 계산한 합성 예시 값입니다.

실험 장부는 명세의 칸이 아니며 백테스트 입력과 결과의 `experiment` 로만 다닙니다. 명세는 기대수익, 계수 추정, 성과 수치를 담지 않습니다. 금액·비율은 십진 문자열로 쓰고 JSON 수는 정수 개수만 씁니다.

**예시 strategy-spec**

```json
{
  "contract": "moai.atp.strategy-spec.v1",
  "procedure": "strategy",
  "target": {"ref": "synthetic:EQ-A", "identity_status": "candidate"},
  "period": {"start": "2020-01-02", "end": "2020-12-30", "kind": "requested"},
  "cutoff": {"at_utc": "2021-01-04T00:00:00Z", "display_tz": "Asia/Seoul"},
  "sources": [{"source_id": "synthetic:paper-note-1", "version": "v1", "received_at": "2021-01-04T00:00:00Z", "provider_as_of": "2020-12-30"}],
  "units": [{"field": "sizing.initial_cash", "unit": "currency", "scale": "1", "currency": "KRW", "status": "confirmed"}],
  "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
  "evidence_ids": [],
  "status": "partial",
  "reasons": ["evidence_unbound"],
  "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0},
  "strategy_id": "synthetic-sma-cross",
  "version": "1",
  "universe": [{"instrument_ref": "synthetic:EQ-A", "identity_status": "candidate"}],
  "signal": {"formula_id": "synthetic.sma_cross", "inputs": ["daily_close"], "fast_window": 5, "slow_window": 20},
  "entry_timing": {"signal_observed": "close_of_day_t", "fill_possible": "open_of_day_t_plus_1"},
  "exit_timing": {"signal_observed": "close_of_day_t", "fill_possible": "open_of_day_t_plus_1"},
  "sizing": {"initial_cash": "10000000", "position_fraction": "1"},
  "constraints": {"long_only": true, "max_positions": 1},
  "invalidation_rules": ["fast window must be shorter than slow window"],
  "undecided_rules": ["cost and slippage assumptions"],
  "required_data": ["daily_close_adjusted"],
  "cost_fill_assumptions": null,
  "source_ledger": [{"source_id": "synthetic:paper-note-1", "claim_id": "c1"}],
  "validation_plan": {"sections": ["out_of_sample", "walk_forward", "cost_sensitivity", "leakage_checks", "multiple_experiments"]},
  "spec_sha256": "e1dde1ccf1df3eccfcfe7e4136600973376561879beb867967aca0edd1e0d59c"
}
```

## 백테스트 결과 `moai.atp.backtest-result.v1`

봉투 열두 키에 더해 `strategy_spec_sha256`, `experiment`, 다섯 절 `out_of_sample`·`walk_forward`·`cost_sensitivity`·`leakage_checks`·`multiple_experiments`, `metrics`, `simulated_fills`, `execution_receipt` 를 둡니다. 가정 체결(`simulated_fills`)은 이 결과 안에서만 존재하며 각 행에 `simulated: true`, 가정의 출처, `order_sent: false` 를 둡니다.

백테스트의 상태와 사유는 SPEC-ATP-BTEST-001 design.md §5.0 첫 일치 판정표를 따르며 이 문서는 그 순서를 다시 적지 않습니다.

오늘은 백테스트 계산기가 없으므로 명세가 있든 없든 결과는 `not_run` 과 `backtest_engine_unavailable` 이고, 모든 지표·`simulated_fills`·`execution_receipt` 는 `null` 이며, 명세가 주어졌으면 `experiment` 에 실행했을 명세를 싣습니다. 계산기가 있다고 가정한 합성 예시 (c)·(d)는 계산기가 생긴 뒤의 모양을 보여 줄 뿐 계산기가 있다는 뜻이 아닙니다.

- (a) 명세 없음, 계산기 없음 → `not_run`, `backtest_engine_unavailable` (판정표 0행)
- (b) 명세 있음, 계산기 없음 → `not_run`, `backtest_engine_unavailable` (판정표 0행)
- (c) 계산기 있음(합성 가정), 명세 없음 → `blocked`, `strategy_spec_missing` (판정표 3행)
- (d) 계산기·명세 있음(합성 가정), 이력 없음, 명세의 규칙이 v1 규칙 문법 밖 → `blocked`, `rule_unsupported` (판정표 5행)

(d)의 합성 명세는 `signal` 에 `formula_id` 를 쓰는 명세 꼴이라 v1 규칙 문법 밖이며, 판정표는 이 규칙 행을 이력 없음 행보다 먼저 맞춥니다. 그래서 (d)는 이력이 없어도 규칙 행에서 멈춥니다. 이력 없음 행은 규칙이 문법 안인 명세에서 이력이 없을 때 맞으며, 이 문서는 그 모양을 예시로 싣지 않습니다.

**예시 backtest-a**

```json
{
  "request": {"strategy_spec_present": false, "calculator_present": false, "validated_history_present": false},
  "envelope": {
    "contract": "moai.atp.backtest-result.v1",
    "procedure": "backtest",
    "target": null,
    "period": null,
    "cutoff": null,
    "sources": [],
    "units": [],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "not_run",
    "reasons": ["backtest_engine_unavailable"],
    "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0},
    "strategy_spec_sha256": null,
    "experiment": null,
    "sections": {"out_of_sample": null, "walk_forward": null, "cost_sensitivity": null, "leakage_checks": null, "multiple_experiments": null},
    "metrics": null,
    "simulated_fills": null,
    "execution_receipt": null
  }
}
```

**예시 backtest-b**

```json
{
  "request": {"strategy_spec_present": true, "calculator_present": false, "validated_history_present": false},
  "envelope": {
    "contract": "moai.atp.backtest-result.v1",
    "procedure": "backtest",
    "target": null,
    "period": null,
    "cutoff": null,
    "sources": [],
    "units": [],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "not_run",
    "reasons": ["backtest_engine_unavailable"],
    "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0},
    "strategy_spec_sha256": "e1dde1ccf1df3eccfcfe7e4136600973376561879beb867967aca0edd1e0d59c",
    "experiment": {"strategy_id": "synthetic-sma-cross", "parameters": {"fast_window": 5, "slow_window": 20}, "ledger": null},
    "sections": {"out_of_sample": null, "walk_forward": null, "cost_sensitivity": null, "leakage_checks": null, "multiple_experiments": null},
    "metrics": null,
    "simulated_fills": null,
    "execution_receipt": null
  }
}
```

**예시 backtest-c**

```json
{
  "request": {
    "strategy_spec_present": false,
    "calculator_present": true,
    "validated_history_present": false,
    "assumption": "synthetic: a backtest calculator is assumed to exist here; none exists today"
  },
  "envelope": {
    "contract": "moai.atp.backtest-result.v1",
    "procedure": "backtest",
    "target": null,
    "period": null,
    "cutoff": null,
    "sources": [],
    "units": [],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "blocked",
    "reasons": ["strategy_spec_missing"],
    "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0},
    "strategy_spec_sha256": null,
    "experiment": null,
    "sections": {"out_of_sample": null, "walk_forward": null, "cost_sensitivity": null, "leakage_checks": null, "multiple_experiments": null},
    "metrics": null,
    "simulated_fills": null,
    "execution_receipt": null
  }
}
```

**예시 backtest-d**

```json
{
  "request": {
    "strategy_spec_present": true,
    "calculator_present": true,
    "validated_history_present": false,
    "strategy_rule_in_v1_grammar": false,
    "assumption": "synthetic: a backtest calculator is assumed to exist here; none exists today"
  },
  "envelope": {
    "contract": "moai.atp.backtest-result.v1",
    "procedure": "backtest",
    "target": null,
    "period": null,
    "cutoff": null,
    "sources": [],
    "units": [],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "blocked",
    "reasons": ["rule_unsupported"],
    "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0},
    "strategy_spec_sha256": "e1dde1ccf1df3eccfcfe7e4136600973376561879beb867967aca0edd1e0d59c",
    "experiment": {"strategy_id": "synthetic-sma-cross", "parameters": {"fast_window": 5, "slow_window": 20}, "ledger": null},
    "sections": {"out_of_sample": null, "walk_forward": null, "cost_sensitivity": null, "leakage_checks": null, "multiple_experiments": null},
    "metrics": null,
    "simulated_fills": null,
    "execution_receipt": null
  }
}
```

## 수익·성과 현황

| 계산 | 필요한 입력 | 없을 때의 사유 |
|---|---|---|
| 보유 종목 수익률 | 종목별 매입가(또는 원가)·수량·평가액·통화·기준일 | `cost_basis_missing` |
| 기간 수익률 | 기간 시작·끝 평가액, 기간 중 입출금 흐름, 통화 | `cash_flows_missing`, `period_unspecified` |
| 자산곡선 최대낙폭 | 엄격 증가 날짜와 양의 초기값을 가진 곡선 | `backtest_curve_dates_not_strictly_increasing`, `backtest_curve_requires_positive_initial_equity` |
| 포지션 비중 HHI | 양의 평가액 포지션 | `positive_spot_value_required` |
| 통화 혼합 합산 | 공통 통화·환율·기준시각 | `currency_basis_unresolved` |

수익률·성과는 필요한 입력이 모두 있고 유효할 때만 말합니다. 하나라도 없거나 잘못되면 결과는 `계산할 수 없음` 과 빠진 입력마다의 사유이며 추정값을 내지 않습니다. 입력 없이 들어온 성과 요청은 계획기가 `unsupported` 와 `performance_inputs_missing`, 단계 0개로 막습니다.

**예시 performance-cost-basis**

```json
{
  "request": {
    "measure": "holding_return",
    "positions": [{"label": "synthetic-A", "market_value": "1000000", "quantity": "10", "currency": "KRW"}],
    "cost_basis_present": false
  },
  "envelope": {
    "contract": "synthetic:performance-status",
    "procedure": "performance",
    "target": null,
    "period": null,
    "cutoff": {"at_utc": "2021-01-04T00:00:00Z", "display_tz": "Asia/Seoul"},
    "sources": [],
    "units": [{"field": "positions.market_value", "unit": "currency", "scale": "1", "currency": "KRW", "status": "confirmed"}],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "not_run",
    "reasons": ["cost_basis_missing"],
    "execution": {"authority": "local_deterministic", "order_sent": false, "provider_dispatches": 0},
    "figures": [{"measure": "holding_return", "value": null, "display": "계산할 수 없음", "reasons": ["cost_basis_missing"]}]
  }
}
```

**예시 performance-cash-flows**

```json
{
  "request": {
    "measure": "period_return",
    "valuation_start": "1000000",
    "valuation_end": "1100000",
    "currency": "KRW",
    "cash_flows_complete": false
  },
  "envelope": {
    "contract": "synthetic:performance-status",
    "procedure": "performance",
    "target": null,
    "period": {"start": "2020-01-02", "end": "2020-12-30", "kind": "requested"},
    "cutoff": {"at_utc": "2021-01-04T00:00:00Z", "display_tz": "Asia/Seoul"},
    "sources": [],
    "units": [{"field": "valuation", "unit": "currency", "scale": "1", "currency": "KRW", "status": "confirmed"}],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "not_run",
    "reasons": ["cash_flows_missing"],
    "execution": {"authority": "local_deterministic", "order_sent": false, "provider_dispatches": 0},
    "figures": [{"measure": "period_return", "value": null, "display": "계산할 수 없음", "reasons": ["cash_flows_missing"]}]
  }
}
```

**예시 performance-currency**

```json
{
  "request": {
    "measure": "total_value",
    "positions": [
      {"label": "synthetic-A", "market_value": "1000000", "currency": "KRW"},
      {"label": "synthetic-B", "market_value": "900", "currency": "USD"}
    ],
    "fx_basis_present": false
  },
  "envelope": {
    "contract": "synthetic:performance-status",
    "procedure": "performance",
    "target": null,
    "period": null,
    "cutoff": {"at_utc": "2021-01-04T00:00:00Z", "display_tz": "Asia/Seoul"},
    "sources": [],
    "units": [{"field": "positions.market_value", "unit": "currency", "scale": "1", "currency": null, "status": "unconfirmed"}],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "not_run",
    "reasons": ["currency_basis_unresolved"],
    "execution": {"authority": "local_deterministic", "order_sent": false, "provider_dispatches": 0},
    "figures": [{"measure": "total_value", "value": null, "display": "계산할 수 없음", "reasons": ["currency_basis_unresolved"]}]
  }
}
```

## 읽기 전용 보유 조회

읽기 전용 보유 조회는 SPEC-ATP-ACCT-001 이 착지하기 전에는 제공하지 않으며 키·계좌 식별자·동의를 요청하지 않고 도구를 호출하지 않습니다. 계획기는 `account_access` 로 막고 단계를 비웁니다. 착지한 뒤에는 그 SPEC 의 읽기 전용 도구 결과만 입력으로 쓰고 계좌 식별자를 보고서에 넣지 않습니다. 새 스킬을 만들지 않습니다.

**예시 holdings-waiting**

```json
{
  "request": {"text": "synthetic: show my account holdings"},
  "envelope": {
    "contract": "synthetic:holdings-status",
    "procedure": "holdings",
    "target": null,
    "period": null,
    "cutoff": null,
    "sources": [],
    "units": [],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "blocked",
    "reasons": ["account_access"],
    "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0},
    "display": "읽기 전용 보유·계좌 수익률 조회는 아직 제공하지 않습니다(별도 승인 뒤 제공 예정)",
    "tool_calls": 0,
    "credential_requested": false,
    "account_identifier_requested": false,
    "consent_requested": false
  }
}
```

## 리서치 노트

봉투에 더해 `claims[]`(`claim_id`, `kind` ∈ {`fact`, `calculation`, `assumption`, `estimate`}, `evidence_ids`, 계산이면 `formula_id`), `counterevidence[]`, `unresolved[]`, `excluded_sections[]` 를 둡니다. 증거 ID가 없는 주장은 숫자·계산·차트·의견에서 제외합니다.

`evidence_ids` 는 같은 서버 프로세스가 발급하고 보고서 입력 조립기가 검증한 출처 영수증 ID 이며, 연구카드(SPEC-ATP-RCARD-001)가 착지한 뒤에는 연구카드 ID 도 씁니다.

**예시 research-note**

```json
{
  "request": {"text": "synthetic research question about EQ-A"},
  "envelope": {
    "contract": "synthetic:research-note",
    "procedure": "research",
    "target": {"ref": "synthetic:EQ-A", "identity_status": "confirmed"},
    "period": {"start": "2020-01-02", "end": "2020-12-30", "kind": "requested"},
    "cutoff": {"at_utc": "2021-01-04T00:00:00Z", "display_tz": "Asia/Seoul"},
    "sources": [{"source_id": "synthetic:filing-1", "version": "v1", "received_at": "2021-01-04T00:10:00Z", "provider_as_of": "2020-12-30"}],
    "units": [{"field": "synthetic ratio", "unit": "percent", "scale": "1", "currency": null, "status": "confirmed"}],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": ["synthetic:receipt-0001", "synthetic:receipt-0002"],
    "status": "partial",
    "reasons": ["evidence_unbound"],
    "execution": {"authority": "local_deterministic", "order_sent": false, "provider_dispatches": 0},
    "claims": [
      {"claim_id": "c1", "kind": "fact", "evidence_ids": ["synthetic:receipt-0001"]},
      {"claim_id": "c2", "kind": "calculation", "evidence_ids": ["synthetic:receipt-0002"], "formula_id": "synthetic.ratio"},
      {"claim_id": "c3", "kind": "fact", "evidence_ids": [], "excluded": true, "excluded_from": ["numbers", "calculations", "charts", "opinions"]},
      {"claim_id": "c4", "kind": "assumption", "evidence_ids": []}
    ],
    "numbers": [{"label": "synthetic ratio", "value": "12.5", "claim_id": "c2"}],
    "counterevidence": [],
    "unresolved": ["c3 has no evidence id"],
    "excluded_sections": []
  }
}
```

## 위험·집중도

위험·집중도 수치는 검증된 입력에 대한 결정적 함수로만 내며 그 밖의 위험 절은 `risk_engine_unavailable` 로 `not_run` 입니다. 자산곡선 최대낙폭과 포지션 비중 HHI 함수는 엔진이 아닙니다.

**예시 risk-beyond-functions**

```json
{
  "request": {"measure": "engine_risk_section"},
  "envelope": {
    "contract": "synthetic:risk-status",
    "procedure": "performance",
    "target": null,
    "period": null,
    "cutoff": null,
    "sources": [],
    "units": [],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "not_run",
    "reasons": ["risk_engine_unavailable"],
    "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0},
    "figures": [{"measure": "engine_risk_section", "value": null, "display": "계산할 수 없음", "reasons": ["risk_engine_unavailable"]}]
  }
}
```

## ATS가 필요한 계산

ATS가 설치되지 않아도 ATP의 읽기·보고 기능은 그대로이며, ATS가 있어야 하는 계산은 `not_run` 또는 `blocked` 와 사유 `ats_not_installed` 로 내고 지원된다고 쓰지 않습니다. 이 플러그인에는 ATS 도구·서버·스위치가 없고 이 문서도 ATP 와 ATS 사이의 계약을 정의하지 않습니다.

**예시 ats-not-installed**

```json
{
  "request": {"requested_calculation": "a calculation that needs the separate system"},
  "envelope": {
    "contract": "synthetic:separate-system-result",
    "procedure": "strategy",
    "target": null,
    "period": null,
    "cutoff": null,
    "sources": [],
    "units": [],
    "versions": {"contract": "1", "skill": "synthetic", "server_package": "synthetic"},
    "evidence_ids": [],
    "status": "not_run",
    "reasons": ["ats_not_installed"],
    "execution": {"authority": "plan_only", "order_sent": false, "provider_dispatches": 0}
  }
}
```

## 사유 코드

| 코드 | 쓰는 곳 |
|---|---|
| `account_access` | 보유 조회가 아직 제공되지 않음 |
| `ats_not_installed` | ATS가 있어야 하는 계산 |
| `backtest_engine_unavailable` | 백테스트 계산기가 없음 |
| `cash_flows_missing` | 기간 수익률의 입출금 흐름 |
| `cost_basis_missing` | 보유 수익률의 매입가 |
| `currency_basis_unresolved` | 통화 혼합 합산 |
| `cutoff_unspecified` | 봉투의 기준 시각 |
| `evidence_unbound` | 증거 ID 가 없음 |
| `handoff_contract_mismatch` | 인계 대조 불일치 |
| `no_source` | 출처 기록이 없음 |
| `numeric_trace_missing` | 추적 없는 수치 |
| `performance_inputs_missing` | 입력 없는 성과 요청(계획기) |
| `period_unspecified` | 요청에 기간이 없음 |
| `risk_engine_unavailable` | 결정적 함수 밖의 위험 절 |
| `rule_unsupported` | 명세의 규칙이 백테스트 v1 규칙 문법 밖 |
| `strategy_spec_missing` | 백테스트에 명세가 없음 |
| `target_unspecified` | 대상이 없음 |
| `unit_unconfirmed` | 단위 미확인 |
| `upstream_not_completed:<step id>` | 앞 단계가 끝나지 않음 |
| `validated_history_unavailable` | 허용된 이력이 없음 |
