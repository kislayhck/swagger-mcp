export const runtime = "nodejs";

import { createMcpHandler } from "@vercel/mcp-adapter";
import { z } from "zod";
import axios from "axios";
import SwaggerParser from "@apidevtools/swagger-parser";
import { OpenAPIV2, OpenAPIV3 } from "openapi-types";

/**
 * =========================
 * Utils
 * =========================
 */
function resolveBaseUrl(
  api: OpenAPIV2.Document | OpenAPIV3.Document
): string | null {
  if ("servers" in api && api.servers?.length) {
    return api.servers[0].url;
  }

  if ("host" in api && api.host) {
    const scheme = api.schemes?.[0] ?? "https";
    return `${scheme}://${api.host}${api.basePath ?? ""}`;
  }

  return null;
}

/**
 * =========================
 * MCP Handler (Vercel)
 * =========================
 */
const handler = createMcpHandler((server) => {
  /**
   * TOOL 1: Load Swagger
   */
  server.tool(
    "load-swagger",
    "Load and inspect Swagger/OpenAPI specification",
    {
      url: z.string(),
    },
    async ({ url }) => {
      try {
        if (!url.startsWith("https://")) {
          throw new Error("Only HTTPS URLs are allowed");
        }

        const response = await axios.get(url, {
          timeout: 10_000,
          maxContentLength: 5 * 1024 * 1024,
        });

        const swaggerDoc = response.data;

        if (!swaggerDoc || (!swaggerDoc.openapi && !swaggerDoc.swagger)) {
          throw new Error("Invalid Swagger/OpenAPI document");
        }

        const api = (await SwaggerParser.validate(swaggerDoc, {
          resolve: { external: false },
        })) as OpenAPIV2.Document | OpenAPIV3.Document;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  baseUrl: resolveBaseUrl(api),
                  endpoints: Object.keys(api.paths ?? {}).length,
                  paths: Object.keys(api.paths ?? {}),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [
            { type: "text", text: `❌ Swagger load failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
        };
      }
    }
  );

  /**
   * TOOL 2: Login
   */
  server.tool(
    "login",
    "Login and return auth token",
    {
      baseUrl: z.string(),
      path: z.string(),
      body: z.record(z.string(), z.unknown()).optional(),
      tokenField: z.string().default("token"),
    },
    async ({ baseUrl, path, body, tokenField }) => {
      try {
        const response = await axios.post(`${baseUrl}${path}`, body ?? {}, {
          timeout: 10_000,
        });

        const token = response.data?.[tokenField];
        if (typeof token !== "string") {
          throw new Error("Token not found in response");
        }

        return {
          content: [
            { type: "text", text: JSON.stringify({ token }, null, 2) },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [
            { type: "text", text: `❌ Login failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
        };
      }
    }
  );

  /**
   * TOOL 3: Call API
   */
  server.tool(
    "call-api",
    "Call any API endpoint",
    {
      baseUrl: z.string(),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
      path: z.string(),
      query: z.record(z.string(), z.unknown()).optional(),
      body: z.record(z.string(), z.unknown()).optional(),
      authToken: z.string().optional(),
    },
    async ({ baseUrl, method, path, query, body, authToken }) => {
      try {
        const response = await axios({
          method,
          url: `${baseUrl}${path}`,
          params: query,
          data: body,
          headers: authToken
            ? { Authorization: `Bearer ${authToken}` }
            : {},
          timeout: 10_000,
        });

        return {
          content: [
            { type: "text", text: JSON.stringify(response.data, null, 2) },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [
            { type: "text", text: `❌ API call failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
        };
      }
    }
  );
});

/**
 * MCP supports multiple HTTP methods
 */
export { handler as GET, handler as POST };
