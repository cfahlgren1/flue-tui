import {
  createFlueClient,
  type AgentConversationObserveOptions,
  type AgentPromptResponse,
  type AgentSendResult,
  type AgentWaitOptions,
} from "@flue/sdk";

export interface ConnectionOptions {
  url: string;
  agent: string;
  id: string;
  token?: string;
  headers?: Record<string, string>;
}

export function createConnection(options: ConnectionOptions) {
  const client = createFlueClient({
    baseUrl: options.url,
    token: options.token,
    headers: options.headers,
  });

  return {
    send(message: string, sendOptions: { signal?: AbortSignal } = {}) {
      return client.agents.send(options.agent, options.id, {
        message,
        signal: sendOptions.signal,
      });
    },
    wait(
      admission: AgentSendResult,
      waitOptions: AgentWaitOptions = {},
    ): Promise<AgentPromptResponse> {
      return client.agents.wait(admission, waitOptions);
    },
    observe(observeOptions: AgentConversationObserveOptions = {}) {
      return client.agents.observe(
        options.agent,
        options.id,
        observeOptions,
      );
    },
    abort() {
      return client.agents.abort(options.agent, options.id);
    },
  };
}

export type FlueConnection = ReturnType<typeof createConnection>;
