import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createStockMcpServer } from '../../src/server.js';
import { nativePeriodOptions } from '../native-period-mcp-fixtures.js';
// Test-only synthetic injection, never imported by production main.ts.
serveStdio(() => createStockMcpServer(nativePeriodOptions()), { legacy: 'serve' });
