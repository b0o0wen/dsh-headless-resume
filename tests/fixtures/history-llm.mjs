import { appendFileSync } from 'node:fs';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';

// The only fake in the integration test: requests come from the real Agent loop.
class HistoryAdapter extends LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: model };
  }

  async *stream(options) {
    appendFileSync(process.env.DSH_TEST_REQUESTS, JSON.stringify(options.messages) + '\n');
    const text = options.messages
      .filter(message => message.role === 'user')
      .map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join(''));
    if (text.at(-1) === 'fail-now') {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TEST_FAILURE', message: 'intentional provider failure' } } };
      return;
    }
    const secret = text.join('\n').match(/remember:([a-f0-9-]+)/)?.[1];
    const reply = text.at(-1) === 'recall' ? `recalled:${secret ?? 'MISSING'}` : 'remembered';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: reply };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } };
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

export const name = 'history-test-llm';
export const inject = ['llm'];
export function apply(ctx) {
  ctx.effect(() => ctx.llm.registerAdapter(['history-test'], new HistoryAdapter()));
}
