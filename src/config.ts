import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  WIKIJS_BASE_URL: z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, '')),
  WIKIJS_API_KEY: z
    .string()
    .min(1, 'WIKIJS_API_KEY is required. Create one in Wiki.js under Administration → API Access.'),
  WIKIJS_DEFAULT_LOCALE: z.string().default('en'),
  WIKIJS_READ_ONLY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MCP_SERVER_NAME: z.string().default('wikijs-mcp-server'),
  MCP_TRANSPORT: z.enum(['http', 'stdio']).default('http'),
  MCP_HTTP_HOST: z.string().default('0.0.0.0'),
  MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3123),
  MCP_AUTH_TOKEN: z.string().optional(),
});

export const config = envSchema.parse(process.env);
