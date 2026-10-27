import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { Kis072PeriodInputSchema, Kis264PeriodInputSchema, Kis072PeriodResultSchema, Kis264PeriodResultSchema,
 Kis072PeriodRequestSchema, Kis264PeriodRequestSchema } from '../dist/src/benchmark-period-inputs.js';
for (const [name, schema] of Object.entries({ 'kis072-period-input': Kis072PeriodInputSchema, 'kis264-period-input': Kis264PeriodInputSchema,
 'kis072-period-result': Kis072PeriodResultSchema, 'kis264-period-result': Kis264PeriodResultSchema,
 'kis072-period-request': Kis072PeriodRequestSchema, 'kis264-period-request': Kis264PeriodRequestSchema })) {
 const json = z.toJSONSchema(schema, { target: 'draft-2020-12' });
 json.$id = `https://moai.local/contracts/${name}-v1.schema.json`;
 json.$comment = 'Shape only; runtime defensive ingress and independent reconstruction required. Requested native W/M/Y never establishes actual coverage, period boundaries, finality, complete periods, units, identity or total return. Not canonical daily history.';
 writeFileSync(new URL(`./${name}-v1.schema.json`, import.meta.url), JSON.stringify(json, null, 2) + '\n');
}
