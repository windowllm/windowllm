/**
 * Google Gemini Adapter
 *
 * Calls the Gemini API (generativelanguage.googleapis.com) directly. Gemini
 * sends CORS headers for cross-origin requests with an `x-goog-api-key` header,
 * so this adapter works from a browser page (the vault iframe) — browserDirect.
 */

import type {
  Message,
  ToolDefinition,
  ToolCall,
  LLMModel,
  ModelCapabilities,
  ContentPart,
} from '@windowllm/types';

import { mapHttpError } from './index.js';
import type {
  ProviderAdapter,
  ProviderConfig,
  NormalizedRequest,
  NormalizedResponse,
  NormalizedChunk,
} from './index.js';

export interface GeminiConfig extends ProviderConfig {}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

interface GeminiModelInfo {
  name: string;               // "models/gemini-2.0-flash"
  displayName?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

const STANDARD_CAPABILITIES: ModelCapabilities = {
  chat: true,
  streaming: true,
  vision: true,
  tools: true,
  embeddings: false,
  jsonMode: true,
  systemPrompt: true,
  multiTurn: true,
  audioInput: false,
  audioOutput: false,
};

export class GeminiAdapter implements ProviderAdapter {
  readonly id = 'gemini';
  readonly name = 'Google Gemini';
  readonly browserDirect = true; // plain CORS + x-goog-api-key
  private config: GeminiConfig;
  private baseUrl: string;
  private modelsCache: LLMModel[] | null = null;

  constructor(config: GeminiConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };
    if (this.config.apiKey) headers['x-goog-api-key'] = this.config.apiKey;
    return headers;
  }

  async listModels(): Promise<LLMModel[]> {
    if (this.modelsCache) return this.modelsCache;
    try {
      const response = await fetch(`${this.baseUrl}/models`, { headers: this.getHeaders() });
      if (response.ok) {
        const body = await response.json() as { models?: GeminiModelInfo[] };
        const models = (body.models ?? [])
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .map(m => this.mapModel(m));
        if (models.length > 0) {
          this.modelsCache = models;
          return models;
        }
      }
    } catch {
      // ignore — return empty rather than throw from a discovery call
    }
    return [];
  }

  async getModel(id: string): Promise<LLMModel | null> {
    const models = await this.listModels();
    const target = id.startsWith('gemini/') ? id : `gemini/${id}`;
    return models.find(m => m.id === target) || null;
  }

  private mapModel(m: GeminiModelInfo): LLMModel {
    const bareId = m.name.replace(/^models\//, '');
    return {
      id: `gemini/${bareId}`,
      name: m.displayName || bareId,
      provider: this.id,
      capabilities: STANDARD_CAPABILITIES,
      limits: {
        contextWindow: m.inputTokenLimit ?? 1_000_000,
        maxOutputTokens: m.outputTokenLimit ?? 8192,
      },
    };
  }

  private modelPath(model: string): string {
    const bare = model.startsWith('gemini/') ? model.slice(7) : model;
    return bare.startsWith('models/') ? bare : `models/${bare}`;
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    const body = this.buildRequestBody(request);
    const response = await fetch(`${this.baseUrl}/${this.modelPath(request.model)}:generateContent`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw mapHttpError(response.status, error.error?.message || response.statusText, response.headers);
    }

    const data = await response.json() as GeminiResponse;
    return this.parseResponse(data);
  }

  async *stream(request: NormalizedRequest): AsyncIterable<NormalizedChunk> {
    const body = this.buildRequestBody(request);
    const response = await fetch(`${this.baseUrl}/${this.modelPath(request.model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw mapHttpError(response.status, error.error?.message || response.statusText, response.headers);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const chunk = JSON.parse(data) as GeminiResponse;
            const parts = chunk.candidates?.[0]?.content?.parts ?? [];
            for (const part of parts) {
              if (part.text) {
                yield { type: 'text', content: part.text };
              } else if (part.functionCall) {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: `call_${part.functionCall.name}`,
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args ?? {}),
                    complete: true,
                  },
                };
              }
            }
            if (chunk.usageMetadata) {
              inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
              outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      yield {
        type: 'usage',
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      };
      yield { type: 'done' };
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  async embed(texts: string[], model?: string): Promise<Float32Array[]> {
    const embedModel = this.modelPath(model || 'text-embedding-004');
    const results: Float32Array[] = [];
    for (const text of texts) {
      const response = await fetch(`${this.baseUrl}/${embedModel}:embedContent`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw mapHttpError(response.status, error.error?.message || response.statusText, response.headers);
      }
      const data = await response.json() as { embedding?: { values: number[] } };
      results.push(new Float32Array(data.embedding?.values ?? []));
    }
    return results;
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, { headers: this.getHeaders() });
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildRequestBody(request: NormalizedRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      contents: this.convertMessages(request.messages),
    };

    if (request.systemPrompt) {
      body.systemInstruction = { parts: [{ text: request.systemPrompt }] };
    }

    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens;
    if (request.stopSequences?.length) generationConfig.stopSequences = request.stopSequences;
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

    if (request.tools?.length) {
      body.tools = [{
        functionDeclarations: request.tools.map(t => this.convertTool(t)),
      }];
    }

    return body;
  }

  private convertMessages(messages: Message[]): GeminiContent[] {
    const result: GeminiContent[] = [];
    const toolNames = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role === 'user') {
        result.push({ role: 'user', parts: this.convertContent(msg.content) });
      } else if (msg.role === 'assistant') {
        const parts: GeminiPart[] = [];
        if (typeof msg.content === 'string' && msg.content) {
          parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const p of msg.content) if (p.type === 'text') parts.push({ text: p.text });
        }
        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            toolNames.set(tc.id, tc.name);
            parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
          }
        }
        if (parts.length > 0) result.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const name = msg.toolCallId ? toolNames.get(msg.toolCallId) : undefined;
        result.push({
          role: 'user',
          parts: [{ functionResponse: { name: name || 'tool', response: { result: content } } }],
        });
      }
    }
    return result;
  }

  private convertContent(content: string | ContentPart[]): GeminiPart[] {
    if (typeof content === 'string') return [{ text: content }];
    return content.map(part => {
      if (part.type === 'text') return { text: part.text };
      if (part.type === 'image') {
        const data = part.data.startsWith('data:') ? part.data.split(',')[1] || part.data : part.data;
        return { inlineData: { mimeType: part.mimeType || 'image/png', data } };
      }
      throw new Error(`Unsupported content type: ${(part as ContentPart).type}`);
    });
  }

  private convertTool(tool: ToolDefinition): Record<string, unknown> {
    return { name: tool.name, description: tool.description, parameters: tool.parameters };
  }

  private parseResponse(data: GeminiResponse): NormalizedResponse {
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    let textContent = '';
    const toolCalls: ToolCall[] = [];
    for (const part of parts) {
      if (part.text) textContent += part.text;
      else if (part.functionCall) {
        toolCalls.push({
          id: `call_${toolCalls.length}_${part.functionCall.name}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
        });
      }
    }

    const usage = data.usageMetadata;
    return {
      message: {
        role: 'assistant',
        content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
      },
      finishReason: this.mapFinishReason(candidate?.finishReason),
    };
  }

  private mapFinishReason(reason?: string): NormalizedResponse['finishReason'] {
    switch (reason) {
      case 'STOP': return 'complete';
      case 'MAX_TOKENS': return 'length';
      case 'SAFETY':
      case 'RECITATION': return 'content_filter';
      default: return 'complete';
    }
  }
}

export function createGeminiAdapter(config: GeminiConfig): GeminiAdapter {
  return new GeminiAdapter(config);
}
