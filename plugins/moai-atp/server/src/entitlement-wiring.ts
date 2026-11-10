import type { McpServer } from '@modelcontextprotocol/server';
import { createServiceEntitlementEvaluator } from './entitlement.js';

type EvaluatorOptions = Parameters<typeof createServiceEntitlementEvaluator>[0];
export type EntitlementWiringOptions = NonNullable<EvaluatorOptions> & {
  /** Opt in from the trusted host only. No environment or tool arguments supply identity. */
  enabled: boolean;
  /** Evaluator request without feature: identity, membership, subscription, learner_grant. */
  state: () => unknown | Promise<unknown>;
  /** Host policy for shared data tools. Unmapped tools fail closed when enabled. */
  toolFeatures: Readonly<Record<string, string>>;
  /** Optional per-tool capability availability, independent of the membership tier. */
  unavailableTools?: readonly string[];
};

type Handler = (...args: unknown[]) => unknown;
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** Registration facade: preserves SDK schemas, callbacks, context and original server ownership.
 * Call before registering tools/resources. All registered callbacks are checked, including
 * those registered by the HTML/source/native-period helpers. Disabled returns the SDK unchanged.
 */
export function entitlementRegistrations(server: McpServer, options?: EntitlementWiringOptions): McpServer {
  if (options?.enabled !== true) return server;
  const evaluator = createServiceEntitlementEvaluator(options);
  const toolFeatures = new Map(Object.entries(options.toolFeatures));
  const unavailable = new Set(options.unavailableTools ?? []);
  // Mirror the renderer's bounded three-entry, five-minute resource cache. Only a successful
  // server callback may associate a URI with a report feature; never trust a resource URI input.
  const resources = new Map<string, { feature: string; expires: number }>();
  async function check(feature: unknown): Promise<void> {
    let result;
    try { result = evaluator.evaluate({ ...record(await options!.state()), feature }); }
    catch { throw new Error('error_code=entitlement_unavailable'); }
    if (result.decision === 'deny') throw new Error(`error_code=${result.reason}`);
  }
  const reportFeature = (name: string, input: unknown): unknown => {
    const args = record(input);
    if (name === 'build_report_input') return args.report_id;
    if (name === 'render_report_html') return record(args.report_input).report_id;
    return toolFeatures.get(name);
  };
  return new Proxy(server, {
    get(target, key) {
      if (key === 'registerTool') return (name: string, config: unknown, callback: Handler) => {
        const guarded = async (...args: unknown[]) => {
          const feature = reportFeature(name, args[0]);
          if (typeof feature !== 'string') throw new Error('error_code=unsupported');
          await check(feature);
          if (unavailable.has(name)) throw new Error('error_code=unavailable');
          const result: unknown = await callback(...args);
          // Record renderer cache order before an asynchronous post-check can reorder it.
          if (name === 'render_report_html') {
            const metadata = record(record(result).structuredContent);
            if (typeof metadata.resource_uri === 'string' && metadata.report_id === feature && typeof metadata.expires_at === 'string') {
              while (resources.size >= 3) resources.delete(resources.keys().next().value!);
              resources.set(metadata.resource_uri, { feature, expires: Date.parse(metadata.expires_at) });
            }
          }
          // Revocation while an asynchronous provider/render callback runs cannot release data.
          await check(feature);
          return result;
        };
        return Reflect.apply(target.registerTool, target, [name, config, guarded]);
      };
      if (key === 'registerResource') return (name: string, uri: unknown, config: unknown, callback: Handler) => {
        const guarded = async (...args: unknown[]) => {
          const resource = resources.get(String(args[0]));
          if (!resource) throw new Error('error_code=unsupported');
          const now = options.now ? options.now() * 1000 : Date.now();
          if (!Number.isFinite(now) || now >= resource.expires) {
            resources.delete(String(args[0]));
            throw new Error('error_code=unavailable');
          }
          await check(resource.feature);
          const result: unknown = await callback(...args);
          await check(resource.feature);
          return result;
        };
        return Reflect.apply(target.registerResource, target, [name, uri, config, guarded]);
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
