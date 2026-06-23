import { ILLMService, LLMProvider, ChatRequest, StreamChunk } from '../types';
import { prepareOpenAIPayload } from '../openai/payloadBuilder';
import { authService } from '../../authService';

const getProxyBaseUrl = (apiBaseUrl?: string) =>
  (apiBaseUrl || (import.meta as any).env?.VITE_WORKER_API_BASE_URL || '').trim().replace(/\/$/, '');

export class ProxyLLMService implements ILLMService {
  readonly provider: LLMProvider = 'proxy';

  async getAvailableModels(_apiKey: string, apiBaseUrl?: string): Promise<string[]> {
    const baseUrl = getProxyBaseUrl(apiBaseUrl);
    if (!baseUrl) return [];

    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        method: 'GET',
        headers: authService.getProxyAuthorizationHeaders(),
      });

      if (!response.ok) {
        console.error(`Failed to fetch models from Worker proxy, status: ${response.status}`);
        return [];
      }

      const data = await response.json();
      if (!Array.isArray(data?.data)) return [];

      return data.data
        .map((model: any) => model?.id)
        .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0);
    } catch (error) {
      console.error('Error fetching Worker proxy models:', error);
      return [];
    }
  }

  async *generateContentStream(request: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    const { model, persona, config, apiBaseUrl, showThoughts } = request;
    const baseUrl = getProxyBaseUrl(apiBaseUrl);

    if (!baseUrl) {
      yield { type: 'error', payload: 'Worker proxy URL is not configured.' };
      yield { type: 'end', payload: '' };
      return;
    }

    const payload = {
      model,
      messages: prepareOpenAIPayload(request.messages, persona),
      temperature: config.temperature,
      max_tokens: Math.min(config.maxOutputTokens, 65536),
      stream: true,
      kchat: {
        showThoughts,
        enableSearch: request.enableSearch,
      },
    };

    let streamEnded = false;

    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authService.getProxyAuthorizationHeaders(),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let errorMessage = `Worker proxy error (${response.status})`;
        try {
          const errorBody = await response.json();
          errorMessage = errorBody.error?.message || errorBody.message || response.statusText;
        } catch {
          errorMessage = response.statusText;
        }
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable.');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const data = line.substring(6);
          if (data.trim() === '[DONE]') {
            streamEnded = true;
            break;
          }

          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            const delta = choice?.delta;

            if (delta?.reasoning_content && showThoughts) {
              yield { type: 'thought', payload: delta.reasoning_content };
            }
            if (delta?.content) {
              yield { type: 'content', payload: delta.content };
            }
            if (choice?.finish_reason) {
              streamEnded = true;
            }
          } catch {
            console.error('Failed to parse Worker proxy SSE chunk:', data);
          }
        }

        if (streamEnded) break;
      }
    } catch (error: any) {
      console.error('Error in Worker proxy stream:', error);
      yield {
        type: 'error',
        payload: error.message || 'An unknown error occurred in the Worker proxy service.',
      };
    } finally {
      yield { type: 'end', payload: '' };
    }
  }
}
