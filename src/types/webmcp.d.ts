/**
 * Ambient type declarations for the WebMCP API (W3C Community Group draft).
 *
 * The spec is pre-standardization and the surface has changed more than
 * once — this project deliberately touches only the two stable methods:
 * `registerTool` and `unregisterTool`.
 */

interface WebMCPInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

interface WebMCPToolDefinition {
  name: string;
  description: string;
  inputSchema: WebMCPInputSchema;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

interface WebMCPModelContext {
  registerTool: (definition: WebMCPToolDefinition) => Promise<void> | void;
  /**
   * Present in current spec drafts; some early native builds ship without
   * it. Callers must feature-check before use.
   */
  unregisterTool?: (name: string) => Promise<void> | void;
}

interface Document {
  modelContext?: WebMCPModelContext;
}
