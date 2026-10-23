import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createStockMcpServer } from '../../src/server.js';
import { injectedOptions } from '../source-input-fixtures.js';
const options = injectedOptions();
const send = options.benchmarkHistoryTransport!.send;
options.benchmarkHistoryTransport = { origin: 'synthetic', async send(request) {
  if (request.query.FID_INPUT_ISCD === 'OVERSIZE') return { http_status: 200, tr_cont: null, body_text: JSON.stringify({ rt_cd: '0', output2: Array.from({ length: 250 }, () => ({ stck_bsop_date: '20261020', ovrs_nmix_prpr: '1' })) }) };
  return send(request);
} };
serveStdio(() => createStockMcpServer(options), { legacy: 'serve' });
