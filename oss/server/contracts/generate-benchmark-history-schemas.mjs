import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { Kis072HistoryInputSchema, Kis264HistoryInputSchema, Kis072HistoryResultSchema, Kis264HistoryResultSchema } from '../dist/src/benchmark-history-inputs.js';
for (const [name, schema] of Object.entries({ 'kis072-history-input': Kis072HistoryInputSchema, 'kis264-history-input': Kis264HistoryInputSchema,
 'kis072-history-result': Kis072HistoryResultSchema, 'kis264-history-result': Kis264HistoryResultSchema })) {
 const json = z.toJSONSchema(schema, { target: 'draft-2020-12' });
 json.$id = `https://moai.local/contracts/${name}-v1.schema.json`;
 json.$comment = 'Shape contract only. Exact calendar/time/row invariants and provenance reconstruction require TypeScript APIs; JSON Schema validation alone is not evidence verification. This is raw evidence, not canonical history.';
 writeFileSync(new URL(`./${name}-v1.schema.json`, import.meta.url), JSON.stringify(json, null, 2) + '\n');
}
