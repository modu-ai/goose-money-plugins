"""Offline canonical history math. This is NOT a provider adapter or source verifier."""
from __future__ import annotations
import argparse
from copy import deepcopy
from datetime import timedelta
from decimal import Decimal
from fractions import Fraction
import json
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from numeric_core import (GateError, require, digest, parse_decimal, parse_day,
                          parse_time, local_day, render_number, load_strict_json)

VERSION = 'canonical-history-semantics/rc5.1'
INPUT_CONTRACT = 'canonical-history/1.0'
FIELDS = ('open', 'high', 'low', 'close', 'volume')
BRANCHES = ('price_relative', 'sma', 'ohlcv', 'volume', 'aggregation')
LIMITATIONS = [
    'Conditional local deterministic math; upstream verification fields are supplied assertions, not authentication.',
    'Provider RC5 histories are RAW ONLY. No raw-provider adapter, promotion, network access or live binding exists here.',
    'No return forecast, causal explanation, ranking, outperformance conclusion or buy/sell recommendation is established.',
    'Only R01.S01 price_relative and neutral volume are traced to the original chart plan. SMA/OHLCV/aggregation are additive capabilities.',
]


def obj(value, required, optional=(), label='object'):
    require(isinstance(value, dict), 'invalid_object', f'{label} must be an object.')
    require(set(required) <= set(value), 'missing_fields', f'{label} lacks: {sorted(set(required)-set(value))}.')
    require(set(value) <= set(required) | set(optional), 'unknown_fields', f'{label} has undeclared fields: {sorted(set(value)-set(required)-set(optional))}.')
    return value


def txt(v, label):
    require(isinstance(v, str) and 0 < len(v) <= 2048 and bool(v.strip()), 'invalid_text', f'{label} requires bounded nonempty text.')
    return v


def enum(v, choices, label):
    require(isinstance(v, str) and v in choices, 'invalid_enum', f'{label} must be one of {list(choices)}.')
    return v


def strings(v, label, limit=10000):
    require(isinstance(v, list) and 0 < len(v) <= limit and all(isinstance(x, str) for x in v), 'invalid_list', label)
    return v


def scale(v):
    n = Fraction(parse_decimal(v, 'scale'))
    require(n in {Fraction(10) ** p for p in range(-12, 13)}, 'invalid_scale', 'Scale requires an explicit power of ten, 1e-12 through 1e12.')
    return n


def date_list(v, label):
    days = strings(v, label)
    parsed = [parse_day(d, label) for d in days]
    require(parsed == sorted(set(parsed)), 'unordered_or_duplicate_dates', label)
    return days


def reason(exc):
    return dict(code=exc.code, detail=exc.detail)


def blocked(identifier, exc):
    return dict(id=identifier, status=exc.status, records=[], reasons=[reason(exc)],
                actual_source_authenticated=False, verified_live_provider_bindings=0)


def missing_cell(message):
    return dict(state='unavailable', value=None, missing_reason=message)


def validate_context(h, request, cutoff):
    obj(h, ['contract', 'history_id', 'data_kind', 'context', 'points'], label='history')
    require(h['contract'] == INPUT_CONTRACT, 'not_canonical_input', 'Only the typed canonical contract is accepted; provider/raw documents cannot be promoted.')
    txt(h['history_id'], 'history_id')
    enum(h['data_kind'], ('synthetic', 'actual'), 'data_kind')
    c = obj(h['context'], ['identity', 'units', 'session', 'basis'], label='context')
    identity = obj(c['identity'], ['instrument_id', 'issuer_id', 'venue', 'asset_class', 'share_class', 'contract_id'], label='identity')
    for k, v in identity.items(): txt(v, k)
    enum(identity['asset_class'], ('equity', 'etf', 'index', 'futures'), 'asset_class')
    require(identity['asset_class'] == 'futures' or identity['contract_id'] == 'not_applicable', 'contract_identity_mismatch', 'Only futures may carry a contract identity.')
    require(identity['asset_class'] != 'futures' or identity['contract_id'] != 'not_applicable', 'contract_identity_missing', 'Continuous/rolled futures are not inferred; supply a single contract ID.')
    u = obj(c['units'], ['price_unit', 'currency', 'price_scale', 'volume_unit', 'volume_scale'], label='units')
    expected = {'equity': ('money_per_share', 'shares'), 'etf': ('money_per_share', 'shares'), 'index': ('index_points', 'not_applicable'), 'futures': ('quoted_price', 'contracts')}[identity['asset_class']]
    require((u['price_unit'], u['volume_unit']) == expected, 'unit_asset_mismatch', 'Price and quantity units must match the explicitly declared asset class.')
    require(isinstance(u['currency'], str) and re.fullmatch('[A-Z]{3}', u['currency']), 'currency_unverified', 'Explicit currency required, including benchmark currency.')
    scale(u['price_scale']); scale(u['volume_scale'])
    s = obj(c['session'], ['calendar_id', 'timezone', 'session_id', 'interval', 'date_basis', 'calendar_verified', 'calendar_evidence_ref', 'coverage_start', 'coverage_end', 'coverage_complete', 'expected_sessions'], label='session')
    for k in ('calendar_id', 'session_id', 'calendar_evidence_ref'): txt(s[k], k)
    try:
        require(isinstance(s['timezone'], str), 'unknown_timezone', 'IANA timezone required.')
        zone = ZoneInfo(s['timezone'])
    except (ValueError, ZoneInfoNotFoundError): raise GateError('unknown_timezone', 'IANA timezone required.')
    require(s['interval'] == 'daily' and s['date_basis'] == 'trade_date', 'unsupported_interval', 'Only canonical daily trade-date inputs are implemented; no implicit instant-to-day conversion.')
    require(s['calendar_verified'] is True and s['coverage_complete'] is True, 'calendar_unverified', 'Declared complete calendar coverage with evidence is required; weekdays are not a trading calendar.')
    days = date_list(s['expected_sessions'], 'expected_sessions')
    start, end = parse_day(s['coverage_start'], 'coverage_start'), parse_day(s['coverage_end'], 'coverage_end')
    require(start <= end and start <= parse_day(request['start_date'], 'start') <= parse_day(request['end_date'], 'end') <= end, 'calendar_range_mismatch', 'Calendar coverage must encompass the exact requested range.')
    require(all(start <= parse_day(d, 'session') <= end for d in days), 'calendar_range_mismatch', 'Expected sessions must be within calendar coverage.')
    b = obj(c['basis'], ['price_kind', 'return_policy', 'adjustment', 'adjustment_id', 'adjustment_asof', 'actions_coverage_verified', 'actions_evidence_ref', 'volume_adjustment', 'revision_policy', 'price_definition', 'allow_negative_prices', 'roll_policy'], label='basis')
    enum(b['price_kind'], ('price_level', 'total_return_index'), 'price_kind')
    enum(b['return_policy'], ('price_return', 'total_return'), 'return_policy')
    enum(b['adjustment'], ('unadjusted', 'split_adjusted', 'total_return'), 'adjustment')
    require((b['price_kind'] == 'total_return_index') == (b['return_policy'] == 'total_return') == (b['adjustment'] == 'total_return'), 'return_basis_mismatch', 'Total-return indices and ordinary prices cannot be relabeled as one another.')
    if b['price_kind'] == 'total_return_index': require(identity['asset_class'] == 'index', 'return_basis_mismatch', 'Total-return values require a separately identified index, not equity OHLC.')
    for k in ('adjustment_id', 'actions_evidence_ref'): txt(b[k], k)
    require(parse_time(b['adjustment_asof'], 'adjustment_asof') <= cutoff, 'future_adjustment', 'Adjustment vintage must be available at cutoff.')
    require(b['actions_coverage_verified'] is True, 'actions_unverified', 'Corporate-action coverage must be explicitly supplied, never inferred from price jumps.')
    enum(b['volume_adjustment'], ('unadjusted', 'split_adjusted', 'not_applicable'), 'volume_adjustment')
    require(b['volume_adjustment'] == ('not_applicable' if identity['asset_class'] == 'index' else ('split_adjusted' if b['adjustment'] == 'split_adjusted' else 'unadjusted')), 'volume_adjustment_mismatch', 'Volume adjustment must match declared price/split basis.')
    require(b['revision_policy'] == 'final_current_at_cutoff' and b['price_definition'] == 'official_close', 'unsupported_basis', 'Only final current-at-cutoff official daily closes are supported.')
    require(type(b['allow_negative_prices']) is bool, 'invalid_boolean', 'allow_negative_prices requires a Boolean.')
    require(not b['allow_negative_prices'] or identity['asset_class'] == 'futures', 'negative_price_policy', 'Negative prices are only permitted for explicitly declared futures contracts.')
    require(b['roll_policy'] == ('single_contract' if identity['asset_class'] == 'futures' else 'not_applicable'), 'unsupported_roll', 'Implicit continuous-futures rolling/back-adjustment is unsupported.')
    return c, zone, days


def validate_point(p, h, zone, cutoff):
    obj(p, ['fact_id', 'trade_date', 'context_sha256', 'point_kind', 'observed_at', 'session_close_at', 'published_at', 'received_at', 'available_at', 'finality', 'revision', 'provenance', 'rights', 'values'], label='point')
    txt(p['fact_id'], 'fact_id')
    parse_day(p['trade_date'], 'trade_date')
    require(p['context_sha256'] == digest(h['context']), 'point_context_mismatch', 'Identity/unit/scale/session/adjustment context must match at every point.')
    enum(p['point_kind'], ('date', 'instant'), 'point_kind')
    close_at = parse_time(p['session_close_at'], 'session_close_at')
    require(local_day(close_at, zone).isoformat() == p['trade_date'], 'session_trade_date_mismatch', 'This engine requires a verified close-date trade-date convention; other session mappings remain unsupported.')
    if p['point_kind'] == 'date': require(p['observed_at'] is None, 'invented_observation_time', 'Date-only observations must not invent a midnight or provider observation instant.')
    else: require(parse_time(p['observed_at'], 'observed_at') >= close_at, 'observation_before_close', 'Daily observation must follow verified session close.')
    pub, received, available = [parse_time(p[k], k) for k in ('published_at', 'received_at', 'available_at')]
    require(close_at <= pub <= received <= available <= cutoff, 'future_or_reversed_availability', 'Session close <= publication <= receipt <= availability <= cutoff is required for each point.')
    if h['context']['basis']['adjustment'] != 'unadjusted':
        require(parse_time(h['context']['basis']['adjustment_asof'], 'adjustment_asof') <= available, 'adjustment_vintage_after_availability', 'An adjusted historical point cannot be available before its declared adjustment vintage.')
    if p['point_kind'] == 'instant': require(parse_time(p['observed_at'], 'observed_at') <= pub, 'observation_after_publication', 'Observation cannot follow publication.')
    require(p['finality'] == 'final', 'unconfirmed_finality', 'Partial/preliminary daily bars are not final daily observations.')
    source = obj(p['provenance'], ['source_id', 'document_id', 'locator', 'revision_id', 'source_sha256', 'selector_id', 'data_kind', 'semantic_binding_verified', 'identity_verified', 'unit_verified', 'currency_verified', 'scale_verified', 'time_verified', 'semantic_evidence_ref', 'identity_evidence_ref', 'unit_evidence_ref', 'currency_evidence_ref', 'scale_evidence_ref', 'time_evidence_ref'], label='provenance')
    for k, v in source.items():
        if k.endswith('_verified'): require(v is True, 'unverified_' + k, f'{k} must be explicitly asserted at an independent canonical boundary.')
        else: txt(v, k)
    require(re.fullmatch('[a-f0-9]{64}', source['source_sha256']), 'invalid_digest', 'SHA-256 required.')
    require(source['data_kind'] == h['data_kind'], 'source_kind_mismatch', 'Synthetic and actual input kinds cannot be mixed.')
    revision = obj(p['revision'], ['status', 'revision_id', 'current_at_cutoff_verified', 'evidence_ref'], ['supersedes_revision_id'], label='revision')
    enum(revision['status'], ('original', 'unchanged', 'revised'), 'revision.status')
    require(revision['current_at_cutoff_verified'] is True and revision['revision_id'] == source['revision_id'], 'revision_unverified', 'Current-as-of revision and source revision must agree.')
    txt(revision['evidence_ref'], 'revision.evidence_ref')
    if revision['status'] == 'revised': require(isinstance(revision.get('supersedes_revision_id'), str) and revision['supersedes_revision_id'].strip() and revision['supersedes_revision_id'] != revision['revision_id'], 'invalid_revision', 'Revised facts require distinct superseded revision identity.')
    rights = obj(p['rights'], ['state', 'use', 'evidence_ref'], ['expires_at'], label='rights')
    require(rights['state'] == 'allowed' and rights['use'] == 'local_report', 'rights_unverified', 'Allowed local-report use required, not redistribution permission.')
    txt(rights['evidence_ref'], 'rights.evidence_ref')
    if rights.get('expires_at') is not None: require(parse_time(rights['expires_at'], 'rights.expires_at') >= cutoff, 'rights_expired', 'Rights expire before cutoff.')
    cells = obj(p['values'], FIELDS, label='values')
    values, errors = {}, {}
    for field in FIELDS:
        try:
            cell = obj(cells[field], ['state', 'value', 'missing_reason'], label=field)
            enum(cell['state'], ('available', 'unavailable'), f'{field}.state')
            if cell['state'] == 'unavailable':
                require(cell['value'] is None, 'invalid_missingness', 'Unavailable value must be null, never zero.')
                txt(cell['missing_reason'], 'missing_reason')
                errors[field] = cell['missing_reason']; values[field] = None; continue
            require(cell['missing_reason'] is None, 'invalid_missingness', 'Available values cannot carry a missing reason.')
            n = Fraction(parse_decimal(cell['value'], field)) * scale(h['context']['units']['volume_scale' if field == 'volume' else 'price_scale'])
            if field == 'volume':
                require(h['context']['units']['volume_unit'] != 'not_applicable', 'unexpected_volume', 'Index volume is not defined under this contract.')
                require(n >= 0 and n.denominator == 1, 'invalid_volume', 'Volume must be a nonnegative integral quantity, not traded money.')
            else: require(n >= 0 or h['context']['basis']['allow_negative_prices'], 'negative_price', 'Negative prices require the explicitly permitted futures branch.')
            values[field] = n
        except GateError as exc: values[field] = None; errors[field] = exc.code
    valid = all(values[k] is not None for k in ('open', 'high', 'low', 'close'))
    if valid:
        valid = values['low'] <= min(values['open'], values['close']) <= max(values['open'], values['close']) <= values['high']
        if not valid: errors['ohlc'] = 'invalid_ohlc_order'
    else: errors['ohlc'] = 'missing_ohlc_component'
    return dict(raw=p, values=values, errors=errors, ohlc_valid=valid, envelope_valid=True)


def normalize(h, request, cutoff):
    if h is None: raise GateError('history_not_supplied', 'History is not supplied; a snapshot is not historical evidence.', 'unavailable')
    c, zone, days = validate_context(h, request, cutoff)
    require(isinstance(h['points'], list) and len(h['points']) <= 10000, 'invalid_points', 'Bounded point list required.')
    by, seen_ids, documents, source_signature = {}, set(), {}, None
    for p in h['points']:
        # Ambiguous/duplicate date keys fail the history rather than silently choosing a row.
        require(isinstance(p, dict), 'invalid_point', 'Point must be an object.')
        day = p.get('trade_date'); parse_day(day, 'trade_date')
        require(day in days and day not in by, 'ambiguous_point_date', 'Point must have a unique verified calendar trade date.')
        fid = txt(p.get('fact_id'), 'fact_id')
        require(fid not in seen_ids, 'duplicate_fact_id', 'A single snapshot/fact cannot be repeated across historical dates.')
        seen_ids.add(fid)
        try:
            row = validate_point(p, h, zone, cutoff)
            src = p['provenance']; key = (src['source_id'], src['document_id'], src['revision_id'])
            require(key not in documents or documents[key] == src['source_sha256'], 'inconsistent_source_document', 'One source document revision cannot have conflicting hashes.')
            documents[key] = src['source_sha256']
            signature = (src['source_id'], src['selector_id'])
            require(source_signature is None or signature == source_signature, 'mixed_history_sources', 'One history requires one declared source and selector; merged providers require a separate verified contract.')
            source_signature = signature
            by[day] = row
        except GateError as exc:
            if exc.code in ('inconsistent_source_document', 'mixed_history_sources'): raise
            by[day] = dict(raw=p, values=dict.fromkeys(FIELDS), errors={k: exc.code for k in FIELDS}, ohlc_valid=False, envelope_valid=False)
    for day in days:
        by.setdefault(day, dict(raw=None, values=dict.fromkeys(FIELDS), errors={k: 'absent_expected_session' for k in FIELDS}, ohlc_valid=False, envelope_valid=False))
    return dict(raw=h, context=c, days=days, rows=by, cutoff_basis=dict(whole_second_utc=cutoff[0].isoformat(), fraction_of_second=format(cutoff[1], 'f')),
                output_days=[d for d in days if request['start_date'] <= d <= request['end_date']])


def record(h, day, field, number=None, missing=None, dependencies=None):
    row = h['rows'][day]
    ids = dependencies if dependencies is not None else ([row['raw']['fact_id']] if row['raw'] else [])
    out = dict(subject_id=h['context']['identity']['instrument_id'], series_id=field, x_kind='date', x_value=day,
               y_axis='left', y_kind='numeric', y_value=None, exact_fraction=None, decimal_policy=None,
               source_fact_result_ids=ids, missing_reason=missing, data_kind=h['raw']['data_kind'])
    if number is not None:
        formatted = render_number(number)
        out.update(y_value=formatted['value'], exact_fraction=formatted['exact_fraction'], decimal_policy=formatted['decimal_policy'])
    return out


def finish(identifier, records, histories, extra=None):
    valid = sum(r.get('y_value') is not None or r.get('ohlc') is not None or r.get('close_only') is not None for r in records)
    out = dict(id=identifier, status='computed' if valid else 'unavailable', records=records, reasons=[], connect_nulls=False,
               actual_source_authenticated=False, verified_live_provider_bindings=0,
               context=[deepcopy(h['context']) for h in histories], cutoff_basis=deepcopy(histories[0]['cutoff_basis']),
               lineage=[dict(history_id=h['raw']['history_id'], context_sha256=digest(h['context']), points=[dict(trade_date=d, input_sha256=digest(row['raw']) if row['raw'] else None, envelope_valid=row['envelope_valid'], field_errors=deepcopy(row['errors']), accepted_fact=deepcopy(row['raw']) if row['envelope_valid'] else None) for d, row in h['rows'].items()]) for h in histories], limitations=LIMITATIONS[:], missing_record_count=len(records)-valid)
    if extra: out.update(extra)
    out['result_id'] = 'history:' + digest(dict(version=VERSION, result=out))
    return out


def compare_compatible(a, b):
    ac, bc = a['context'], b['context']
    require(a['raw']['data_kind'] == b['raw']['data_kind'], 'source_kind_mismatch', 'Synthetic/actual comparator mixing prohibited.')
    for group, keys in [('units', ['currency']), ('session', ['calendar_id', 'timezone', 'session_id', 'date_basis']), ('basis', ['price_kind', 'return_policy', 'adjustment', 'adjustment_asof'])]:
        for key in keys: require(ac[group][key] == bc[group][key], 'comparison_' + key + '_mismatch', f'Comparison requires identical {key}; no implicit currency conversion or calendar alignment.')
    require(a['days'] == b['days'], 'comparison_calendar_mismatch', 'Both series require the same explicitly verified session keys; missing observations remain null.')
    require(ac['identity']['instrument_id'] != bc['identity']['instrument_id'], 'benchmark_identity_mismatch', 'Comparator requires its own explicit identity.')
    docs, fact_ids = {}, set()
    for h in (a, b):
        for row in h['rows'].values():
            if not row['envelope_valid']: continue
            p = row['raw']; src = p['provenance']; key = (src['source_id'], src['document_id'], src['revision_id'])
            require(p['fact_id'] not in fact_ids, 'comparison_fact_alias', 'Different histories cannot reuse one historical fact ID.')
            fact_ids.add(p['fact_id'])
            require(key not in docs or docs[key] == src['source_sha256'], 'comparison_source_mismatch', 'One source revision cannot have conflicting hashes across compared histories.')
            docs[key] = src['source_sha256']


def rebase(subject, benchmark):
    a = subject
    valid = [d for d in a['output_days'] if a['rows'][d]['values']['close'] is not None]
    require(len(valid) >= 2, 'insufficient_observations', 'At least two valid subject closes required; snapshot alone cannot satisfy R01.S01.')
    require(all(a['rows'][d]['values']['close'] > 0 for d in valid), 'nonpositive_rebase_price', 'Rebasing requires strictly positive prices throughout, even when negative futures OHLC is legitimate.')
    bench_error, b = None, benchmark
    if isinstance(b, GateError): bench_error, b = reason(b), None
    if b is not None:
        try:
            compare_compatible(a, b)
            bvalid = [d for d in b['output_days'] if b['rows'][d]['values']['close'] is not None]
            require(len(bvalid) >= 2 and all(b['rows'][d]['values']['close'] > 0 for d in bvalid), 'invalid_benchmark_observations', 'Comparator requires at least two strictly positive levels.')
            common = [d for d in valid if b['rows'][d]['values']['close'] is not None]
            require(len(common) >= 2, 'insufficient_common_observations', 'Comparison requires at least two common valid dates, without fill.')
            baseline = common[0]
        except GateError as exc: bench_error, b = reason(exc), None
    if b is None: baseline = valid[0]
    records = []
    for role, h in [('subject', a), ('benchmark', b)]:
        if h is None: continue
        base = h['rows'][baseline]['values']['close']
        for day in a['output_days']:
            row = h['rows'][day]; n = row['values']['close']; missing = row['errors'].get('close')
            if day < baseline: n, missing = None, 'before_common_baseline'
            ids = [h['rows'][baseline]['raw']['fact_id']]
            if row['raw'] and row['raw']['fact_id'] not in ids: ids.append(row['raw']['fact_id'])
            records.append(record(h, day, role, None if n is None else 100 * n / base, missing, ids))
    return finish('price_relative', records, [a] + ([b] if b else []), dict(
        unit='index100', currency='not_applicable', baseline_date=baseline, formula='100 * close_t / close_first_common_valid',
        benchmark_status='computed' if b else 'unavailable', benchmark_reason=bench_error or (None if b else dict(code='benchmark_not_supplied', detail='Comparison unavailable; subject-only first valid date = 100.')),
        comparison_conclusion=None, source_plan='R01.S01 / price_relative', minimum_observations=2))


def sma(h, windows):
    require(isinstance(windows, list) and len(windows) <= 16 and all(type(n) is int and 1 <= n <= 500 for n in windows) and len(windows) == len(set(windows)), 'invalid_sma_windows', 'SMA windows must be explicit unique integers, 1 to 500 sessions.')
    records = []
    for window in windows:
        for i, day in enumerate(h['days']):
            if day not in h['output_days']: continue
            subset = h['days'][max(0, i-window+1):i+1]
            rows = [h['rows'][d] for d in subset]
            missing = 'warmup_insufficient_sessions' if len(subset) < window else ('missing_session_in_window' if any(r['values']['close'] is None for r in rows) else None)
            value = None if missing else sum((r['values']['close'] for r in rows), Fraction(0)) / window
            records.append(record(h, day, f'sma_{window}', value, missing, [r['raw']['fact_id'] for r in rows if r['raw']]))
    return finish('sma', records, [h], dict(unit=h['context']['units']['price_unit'], currency=h['context']['units']['currency'], windows=windows,
        formula='sum(last N contiguous expected-session closes, including current) / N', warmup='full N sessions required; explicit prehistory may warm up requested range', gap_policy='any missing expected close nulls entire window; no skip, forward fill or lookahead', source_plan='additive capability; not a claimed R01 plan section'))


def ohlcv(h):
    records = []
    for day in h['output_days']:
        row = h['rows'][day]
        r = record(h, day, 'ohlcv', missing=row['errors'].get('ohlc'))
        # Do not place low/open/close/high into an ambiguous positional renderer array.
        r['ohlc'] = {k: render_number(row['values'][k]) for k in ('open', 'high', 'low', 'close')} if row['ohlc_valid'] else None
        r['close_only'] = render_number(row['values']['close']) if row['values']['close'] is not None else None
        r['close_only_missing_reason'] = row['errors'].get('close')
        r['volume'] = render_number(row['values']['volume']) if row['values']['volume'] is not None else None
        r['volume_missing_reason'] = row['errors'].get('volume')
        if not row['ohlc_valid'] and not r['missing_reason']: r['missing_reason'] = row['errors'].get('close', 'invalid_ohlc')
        records.append(r)
    return finish('ohlcv', records, [h], dict(unit=h['context']['units']['price_unit'], currency=h['context']['units']['currency'], volume_unit=h['context']['units']['volume_unit'], candle_order='named OHLC fields; adapter must map explicitly', candle_status='computed' if any(r['ohlc'] is not None for r in records) else 'unavailable', close_status='computed' if any(r['close_only'] is not None for r in records) else 'unavailable', source_plan='additive capability; R01.S01 price_relative remains line-only'))


def volume(h, direction):
    obj(direction, ['rule', 'evidence_ref', 'disclosure'], label='volume_direction')
    rule = enum(direction['rule'], ('neutral', 'close_vs_open', 'close_vs_previous_session'), 'volume_direction.rule')
    txt(direction['evidence_ref'], 'direction evidence'); txt(direction['disclosure'], 'direction disclosure')
    records = []
    for i, day in enumerate(h['days']):
        if day not in h['output_days']: continue
        row = h['rows'][day]; n = row['values']['volume']
        r = record(h, day, 'volume', n, row['errors'].get('volume'))
        close, ref, ref_date = row['values']['close'], None, None
        if rule == 'close_vs_open' and row['ohlc_valid']: ref, ref_date = row['values']['open'], day
        elif rule == 'close_vs_previous_session' and i:
            prev = h['rows'][h['days'][i-1]]; ref, ref_date = prev['values']['close'], h['days'][i-1]
            if prev['raw']: r['source_fact_result_ids'] = list(dict.fromkeys(r['source_fact_result_ids'] + [prev['raw']['fact_id']]))
        sign = None if rule == 'neutral' or close is None or ref is None or n is None else (1 if close > ref else -1 if close < ref else 0)
        r.update(direction=sign, direction_label={1: '+ 가격 상승', -1: '− 가격 하락', 0: '0 가격 보합', None: '중립 / 비교 불가'}[sign], color={1: '#D71920', -1: '#3E6AE1', 0: '#68737D', None: '#68737D'}[sign], direction_reference_date=ref_date,
                 direction_reference_value=render_number(ref) if ref is not None else None, direction_rule=rule, volume_change_inferred=False)
        records.append(r)
    return finish('volume', records, [h], dict(unit=h['context']['units']['volume_unit'], currency='not_applicable', direction_policy=deepcopy(direction),
        source_plan='R01.S01 / volume; neutral default. Explicit price-direction coloring is an additive disclosed convention, not signed volume change.'))


def window_metadata(w):
    obj(w, ['window_id', 'kind', 'definition', 'start_date', 'end_date', 'calendar_id', 'calendar_verified', 'complete', 'evidence_ref', 'expected_sessions'], label='aggregation window')
    txt(w['window_id'], 'window_id'); txt(w['evidence_ref'], 'window evidence')
    kind = enum(w['kind'], ('week', 'month'), 'window.kind')
    start, end = parse_day(w['start_date'], 'start_date'), parse_day(w['end_date'], 'end_date')
    require(start <= end, 'window_order', 'Window start must not follow end.')
    if kind == 'week': require(w['definition'] == 'ISO_MONDAY_SUNDAY' and start.weekday() == 0 and end == start + timedelta(days=6), 'partial_calendar_window', 'Weekly aggregation requires the full declared ISO Monday-Sunday window.')
    else:
        require(w['definition'] == 'GREGORIAN_MONTH' and start.day == 1 and start.year == end.year and start.month == end.month and (end + timedelta(days=1)).day == 1, 'partial_calendar_window', 'Monthly aggregation requires the full declared Gregorian month.')
    txt(w['calendar_id'], 'window calendar')
    require(type(w['calendar_verified']) is bool and type(w['complete']) is bool, 'invalid_boolean', 'Window flags must be Boolean.')
    date_list(w['expected_sessions'], 'window.expected_sessions')
    return deepcopy(w)


def aggregate_one(h, w, cutoff):
    window_metadata(w)
    start, end = parse_day(w['start_date'], 'start_date'), parse_day(w['end_date'], 'end_date')
    kind = w['kind']
    require(w['calendar_verified'] is True and w['complete'] is True, 'incomplete_window', 'No implicit resampling: explicit verified complete windows only.')
    require(w['calendar_id'] == h['context']['session']['calendar_id'], 'window_calendar_mismatch', 'Calendar identities must match.')
    require(end < local_day(cutoff, ZoneInfo(h['context']['session']['timezone'])), 'partial_future_window', 'The complete calendar period must have ended: cutoff local date must be strictly after its final date, even when the last trading session was earlier.')
    s = h['context']['session']
    require(s['coverage_start'] <= w['start_date'] <= w['end_date'] <= s['coverage_end'], 'window_outside_coverage', 'Calendar must explicitly cover the whole window, including nontrading endpoints.')
    expected = date_list(w['expected_sessions'], 'window.expected_sessions')
    canonical = [d for d in h['days'] if w['start_date'] <= d <= w['end_date']]
    require(expected == canonical, 'window_session_mismatch', 'Complete window session list must match the verified canonical calendar exactly.')
    rows = [h['rows'][d] for d in expected]
    require(all(r['ohlc_valid'] and r['values']['volume'] is not None for r in rows), 'window_gap', 'Every expected session requires complete valid OHLCV; partial aggregation remains unavailable.')
    vals = dict(open=rows[0]['values']['open'], high=max(r['values']['high'] for r in rows), low=min(r['values']['low'] for r in rows), close=rows[-1]['values']['close'], volume=sum((r['values']['volume'] for r in rows), Fraction(0)))
    r = record(h, expected[-1], 'ohlcv_' + kind, dependencies=[row['raw']['fact_id'] for row in rows])
    r.update(ohlc={k: render_number(vals[k]) for k in ('open', 'high', 'low', 'close')}, volume=render_number(vals['volume']), period=deepcopy(w), x_kind='period', x_value=w['window_id'], first_trade_date=expected[0], last_trade_date=expected[-1])
    return r


def aggregate(h, windows, cutoff):
    require(isinstance(windows, list) and len(windows) <= 1000, 'invalid_windows', 'Aggregation windows must be an explicit bounded list.')
    records, rejected, prepared = [], [], []
    for w in windows:
        try: prepared.append(window_metadata(w))
        except (GateError, OverflowError) as exc:
            rejected.append(dict(window_id=w.get('window_id') if isinstance(w, dict) and isinstance(w.get('window_id'), str) else None, status='unavailable', period=None, reason=reason(exc) if isinstance(exc, GateError) else dict(code='calendar_overflow', detail='Window exceeds representable calendar range.')))
    prepared.sort(key=lambda w: (w['kind'], w['start_date'], w['end_date'], w['window_id']))
    previous = {}
    for w in prepared:
        try:
            require(sum(x['window_id'] == w['window_id'] for x in prepared) == 1, 'duplicate_window_id', 'All windows with a duplicate identifier are rejected.')
            require(not any(x is not w and x['kind'] == w['kind'] and x['start_date'] <= w['end_date'] and w['start_date'] <= x['end_date'] for x in prepared), 'overlapping_windows', 'All overlapping same-frequency windows are rejected; a new ID cannot bypass overlap checks.')
            r = aggregate_one(h, w, cutoff)
        except (GateError, OverflowError) as exc:
            why = reason(exc) if isinstance(exc, GateError) else dict(code='calendar_overflow', detail='Window exceeds representable calendar range.')
            rejected.append(dict(window_id=w['window_id'], status='unavailable', period=deepcopy(w), reason=why))
            r = dict(subject_id=h['context']['identity']['instrument_id'], series_id='ohlcv_' + w['kind'], x_kind='period', x_value=w['window_id'], y_axis='left', y_kind='numeric', y_value=None, exact_fraction=None, decimal_policy=None, ohlc=None, volume=None, period=deepcopy(w), first_trade_date=None, last_trade_date=None, source_fact_result_ids=[], missing_reason=why['code'], data_kind=h['raw']['data_kind'])
        prior = previous.get(w['kind'])
        r['contiguous_with_previous'] = None if prior is None else parse_day(prior['end_date'], 'prior end') + timedelta(days=1) == parse_day(w['start_date'], 'start')
        r['gap_before'] = None if prior is None or r['contiguous_with_previous'] else dict(reason='requested_windows_not_contiguous', previous_window_id=prior['window_id'], previous_end=prior['end_date'], current_start=w['start_date'])
        previous[w['kind']] = w
        records.append(r)
    return finish('aggregation', records, [h], dict(rejected_windows=rejected, unit=h['context']['units']['price_unit'], currency=h['context']['units']['currency'], volume_unit=h['context']['units']['volume_unit'], ordering='Separate frequency series, then chronological period start. Validated rejected windows retain null geometry. A gap_before requires a rendering break, never a connecting segment.', formula='open=first open; high=max highs; low=min lows; close=last close; volume=sum quantities; full explicit sessions only', source_plan='additive complete-calendar window capability, not general provider resampling'))


def validate_json_value(value):
    """Python callers get the same finite, string-keyed JSON boundary as the CLI."""
    stack, visited = [(value, 0)], 0
    while stack:
        v, depth = stack.pop(); visited += 1
        require(depth <= 64 and visited <= 1000000, 'input_too_large', 'Bounded nonrecursive JSON input required.')
        if isinstance(v, dict):
            require(all(isinstance(k, str) for k in v), 'invalid_json_key', 'JSON object keys must be strings.')
            stack.extend((item, depth+1) for item in v.values())
        elif isinstance(v, list): stack.extend((item, depth+1) for item in v)
        else: require(type(v) in (str, int, float, bool, type(None)), 'invalid_json_value', 'Only JSON primitive values are accepted.')
    try: digest(value)
    except (ValueError, TypeError, RecursionError): raise GateError('invalid_json_value', 'Nonfinite, cyclic or unencodable JSON input is rejected.')


def calculate_report(payload):
    out = dict(version=VERSION, actual_source_authenticated=False, source_authentication_performed=False,
               verified_live_provider_bindings=0, actual_provider_calls=0, results={}, limitations=LIMITATIONS[:])
    try:
        validate_json_value(payload)
        obj(payload, ['contract', 'cutoff', 'request', 'histories', 'options'], label='payload')
        require(payload['contract'] == INPUT_CONTRACT, 'not_canonical_input', 'Typed canonical input required. RAW provider histories are not accepted.')
        cutoff = parse_time(payload['cutoff'], 'cutoff')
        request = obj(payload['request'], ['start_date', 'end_date'], label='request')
        require(parse_day(request['start_date'], 'start_date') <= parse_day(request['end_date'], 'end_date'), 'range_order', 'Requested start must precede or equal end.')
        histories = obj(payload['histories'], ['subject'], ['benchmark'], label='histories')
        options = obj(payload['options'], ['sma_windows', 'volume_direction', 'aggregation_windows'], label='options')
        subject = normalize(histories['subject'], request, cutoff)
        try: benchmark = normalize(histories.get('benchmark'), request, cutoff)
        except GateError as exc: benchmark = exc
        operations = dict(price_relative=lambda: rebase(subject, benchmark), sma=lambda: sma(subject, options['sma_windows']), ohlcv=lambda: ohlcv(subject), volume=lambda: volume(subject, options['volume_direction']), aggregation=lambda: aggregate(subject, options['aggregation_windows'], cutoff))
        for name, fn in operations.items():
            try: out['results'][name] = fn()
            except GateError as exc: out['results'][name] = blocked(name, exc)
        out['data_kind'] = subject['raw']['data_kind']
        out['data_notice'] = 'SYNTHETIC TEST ONLY' if out['data_kind'] == 'synthetic' else 'SUPPLIED CANONICAL EVIDENCE ONLY; NOT SOURCE AUTHENTICATED'
        out['actual_input_rows'] = len(subject['raw']['points']) if out['data_kind'] == 'actual' else 0
    except GateError as exc:
        out['results'] = {name: blocked(name, exc) for name in BRANCHES}
        out['data_notice'] = 'No accepted canonical history'
        out['actual_input_rows'] = 0
    out['report_cutoff'] = payload.get('cutoff') if isinstance(payload, dict) and isinstance(payload.get('cutoff'), str) else None
    out['status_counts'] = {s: sum(r['status'] == s for r in out['results'].values()) for s in ('computed', 'unavailable', 'blocked')}
    return out


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input'); parser.add_argument('--output'); args = parser.parse_args()
    result = json.dumps(calculate_report(load_strict_json(args.input)), ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as stream: stream.write(result)
    else: print(result, end='')
