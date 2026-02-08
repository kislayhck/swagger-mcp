import { createMcpHandler } from "@vercel/mcp-adapter";
import { z } from "zod";
import axios from "axios";
import SwaggerParser from "@apidevtools/swagger-parser";
import { OpenAPIV2, OpenAPIV3 } from "openapi-types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Utils
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
 * MCP Handler
 */
const handler = createMcpHandler((server) => {
  
  server.tool(
    "load-swagger",
    "Load and inspect Swagger/OpenAPI specification",
    {
      url: z.string().describe("HTTPS URL to Swagger/OpenAPI spec"),
    },
    async ({ url }) => {
      try {
        if (!url.startsWith("https://")) {
          throw new Error("Only HTTPS URLs are allowed");
        }

        const response = await axios.get(url, {
          timeout: 10_000,
          maxContentLength: 5 * 1024 * 1024,
          headers: {
            'Accept': 'application/json, application/yaml',
          }
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
                  success: true,
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
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { 
              type: "text", 
              text: JSON.stringify({
                success: false,
                error: errorMessage
              }, null, 2)
            },
          ],
        };
      }
    }
  );

  server.tool(
    "login",
    "Login to API and return authentication token",
    {
      baseUrl: z.string().describe("Base URL of the API"),
      path: z.string().describe("Login endpoint path (e.g., /auth/login)"),
      body: z.record(z.string(), z.unknown()).optional().describe("Login credentials"),
      tokenField: z.string().default("token").describe("Field name containing the token in response"),
    },
    async ({ baseUrl, path, body, tokenField }) => {
      try {
        const response = await axios.post(`${baseUrl}${path}`, body ?? {}, {
          timeout: 10_000,
          headers: {
            'Content-Type': 'application/json',
          }
        });

        const token = response.data?.[tokenField];
        if (typeof token !== "string") {
          throw new Error(`Token field '${tokenField}' not found in response`);
        }

        return {
          content: [
            { 
              type: "text", 
              text: JSON.stringify({ 
                success: true,
                token 
              }, null, 2) 
            },
          ],
        };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { 
              type: "text", 
              text: JSON.stringify({
                success: false,
                error: errorMessage
              }, null, 2)
            },
          ],
        };
      }
    }
  );

  server.tool(
    "call-api",
    "Call any API endpoint with optional authentication",
    {
      baseUrl: z.string().describe("Base URL of the API"),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).describe("HTTP method"),
      path: z.string().describe("API endpoint path"),
      query: z.record(z.string(), z.unknown()).optional().describe("Query parameters"),
      body: z.record(z.string(), z.unknown()).optional().describe("Request body"),
      authToken: z.string().optional().describe("Bearer authentication token"),
    },
    async ({ baseUrl, method, path, query, body, authToken }) => {
      try {
        const response = await axios({
          method,
          url: `${baseUrl}${path}`,
          params: query,
          data: body,
          headers: {
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
        });

        return {
          content: [
            { 
              type: "text", 
              text: JSON.stringify({
                success: true,
                data: response.data,
                status: response.status
              }, null, 2) 
            },
          ],
        };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const axiosError = axios.isAxiosError(err) ? {
          status: err.response?.status,
          statusText: err.response?.statusText,
          data: err.response?.data
        } : null;

        return {
          content: [
            { 
              type: "text", 
              text: JSON.stringify({
                success: false,
                error: errorMessage,
                ...(axiosError && { details: axiosError })
              }, null, 2)
            },
          ],
        };
      }
    }
  );
});

// Export the same handler for both GET and POST
export const GET = handler;
export const POST = handler;