import { describe, expect, it } from 'vitest';
import type { Message, PageAccessOptions, ToolCall } from '@windowllm/types';
import {
  PAGE_TOOL_NAMES,
  PageToolExecutor,
  getPageToolDefinitions,
  runPageToolLoop,
} from './index.js';

class FakeElement {
  readonly ownerDocument: FakeDocument;
  readonly tagName: string;
  id = '';
  className = '';
  textContent = '';
  value = '';
  checked = false;
  disabled = false;
  isConnected = true;
  clicked = false;
  dispatchedEvents: string[] = [];
  private readonly attributes = new Map<string, string>();
  private readonly children = new Set<FakeElement>();
  private readonly matches = new Map<string, FakeElement[]>();

  constructor(document: FakeDocument, tagName: string) {
    this.ownerDocument = document;
    this.tagName = tagName.toUpperCase();
  }

  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  getAttributeNames(): string[] { return [...this.attributes.keys()]; }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  getClientRects(): Array<Record<string, never>> { return [{}]; }
  dispatchEvent(event: Event): boolean { this.dispatchedEvents.push(event.type); return true; }
  click(): void { this.clicked = true; }
  contains(element: FakeElement): boolean {
    return element === this || [...this.children].some(child => child.contains(element));
  }
  add(selector: string, element: FakeElement): void {
    this.children.add(element);
    this.matches.set(selector, [...(this.matches.get(selector) || []), element]);
  }
  remove(element: FakeElement): void { this.children.delete(element); }
  querySelector(selector: string): FakeElement | null { return this.matches.get(selector)?.[0] || null; }
  querySelectorAll(selector: string): FakeElement[] { return [...(this.matches.get(selector) || [])]; }
}

class FakeDocument {
  readonly defaultView = {
    Event,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  };
  private readonly matches = new Map<string, FakeElement[]>();

  add(selector: string, element: FakeElement): void {
    this.matches.set(selector, [...(this.matches.get(selector) || []), element]);
  }

  querySelector(selector: string): FakeElement | null {
    return this.matches.get(selector)?.[0] || null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return [...(this.matches.get(selector) || [])];
  }
}

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: crypto.randomUUID(), name, arguments: args };
}

function executor(access: PageAccessOptions['access']): {
  executor: PageToolExecutor;
  document: FakeDocument;
} {
  const document = new FakeDocument();
  return {
    document,
    executor: new PageToolExecutor({ access }, document as unknown as Document),
  };
}

describe('page tool definitions', () => {
  it('exposes only CSS query tools in read mode', () => {
    expect(getPageToolDefinitions({ access: 'read' }).map(tool => tool.name)).toEqual([
      PAGE_TOOL_NAMES.querySelector,
      PAGE_TOOL_NAMES.querySelectorAll,
    ]);
  });

  it('adds controlled mutation tools in read-write mode', () => {
    const names = getPageToolDefinitions({ access: 'read-write' }).map(tool => tool.name);
    expect(names).toContain(PAGE_TOOL_NAMES.click);
    expect(names).toContain(PAGE_TOOL_NAMES.setValue);
    expect(names).toContain(PAGE_TOOL_NAMES.setAttribute);
  });
});

describe('PageToolExecutor', () => {
  it('exposes definitions matching the executor access mode', () => {
    const setup = executor('read-write');
    expect(setup.executor.definitions.map(tool => tool.name)).toEqual(
      getPageToolDefinitions({ access: 'read-write' }).map(tool => tool.name),
    );
  });

  it('matches CSS selectors and returns stable opaque element refs', async () => {
    const setup = executor('read');
    const button = new FakeElement(setup.document, 'button');
    button.id = 'save';
    button.textContent = 'Save changes';
    button.setAttribute('data-action', 'save');
    setup.document.add('#save', button);

    const first = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: '#save' }));
    const second = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: '#save' }));

    expect(first.success).toBe(true);
    const firstRef = (first.content as { match: { ref: string } }).match.ref;
    const secondRef = (second.content as { match: { ref: string } }).match.ref;
    expect(firstRef).toMatch(/^element_[0-9a-f-]+$/);
    expect(secondRef).toBe(firstRef);
    expect(first.content).toMatchObject({ match: { textContent: 'Save changes' } });
  });

  it('enforces read-only access for mutations', async () => {
    const setup = executor('read');
    const button = new FakeElement(setup.document, 'button');
    setup.document.add('button', button);
    const query = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: 'button' }));
    const ref = (query.content as { match: { ref: string } }).match.ref;

    const result = await setup.executor.execute(call(PAGE_TOOL_NAMES.click, { ref }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('read-only');
    expect(button.clicked).toBe(false);
  });

  it('sets values and permits only application-state attributes', async () => {
    const setup = executor('read-write');
    const input = new FakeElement(setup.document, 'input');
    setup.document.add('#name', input);
    const query = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: '#name' }));
    const ref = (query.content as { match: { ref: string } }).match.ref;

    const setValue = await setup.executor.execute(call(PAGE_TOOL_NAMES.setValue, { ref, value: 'Ada' }));
    const unsafe = await setup.executor.execute(call(PAGE_TOOL_NAMES.setAttribute, {
      ref,
      name: 'href',
      value: 'java\nscript:alert(1)',
    }));
    const safe = await setup.executor.execute(call(PAGE_TOOL_NAMES.setAttribute, {
      ref,
      name: 'data-state',
      value: 'ready',
    }));

    expect(setValue.success).toBe(true);
    expect(input.value).toBe('Ada');
    expect(input.dispatchedEvents).toEqual(['input', 'change']);
    expect(unsafe.success).toBe(false);
    expect(input.getAttribute('href')).toBeNull();
    expect(safe.success).toBe(true);
    expect(input.getAttribute('data-state')).toBe('ready');

    const clearValue = await setup.executor.execute(call(PAGE_TOOL_NAMES.setValue, { ref, value: '' }));
    expect(clearValue.success).toBe(true);
    expect(input.value).toBe('');
  });

  it('executes every supported mutation and removes safe attributes', async () => {
    const setup = executor('read-write');
    const button = new FakeElement(setup.document, 'button');
    const input = new FakeElement(setup.document, 'input');
    const text = new FakeElement(setup.document, 'p');
    text.setAttribute('data-state', 'old');
    setup.document.add('#button', button);
    setup.document.add('#input', input);
    setup.document.add('#text', text);

    const queryRef = async (selector: string): Promise<string> => {
      const result = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector }));
      return (result.content as { match: { ref: string } }).match.ref;
    };
    const buttonRef = await queryRef('#button');
    const inputRef = await queryRef('#input');
    const textRef = await queryRef('#text');

    expect((await setup.executor.execute(call(PAGE_TOOL_NAMES.click, { ref: buttonRef }))).success).toBe(true);
    expect((await setup.executor.execute(call(PAGE_TOOL_NAMES.setValue, {
      ref: inputRef,
      value: 'new value',
    }))).success).toBe(true);
    expect((await setup.executor.execute(call(PAGE_TOOL_NAMES.setTextContent, {
      ref: textRef,
      value: 'new text',
    }))).success).toBe(true);
    expect((await setup.executor.execute(call(PAGE_TOOL_NAMES.setAttribute, {
      ref: textRef,
      name: 'aria-live',
      value: 'polite',
    }))).success).toBe(true);
    expect((await setup.executor.execute(call(PAGE_TOOL_NAMES.removeAttribute, {
      ref: textRef,
      name: 'data-state',
    }))).success).toBe(true);

    expect(button.clicked).toBe(true);
    expect(input.value).toBe('new value');
    expect(input.dispatchedEvents).toEqual(['input', 'change']);
    expect(text.textContent).toBe('new text');
    expect(text.getAttribute('aria-live')).toBe('polite');
    expect(text.getAttribute('data-state')).toBeNull();
  });

  it('rejects malformed, unsafe, and oversized mutation arguments', async () => {
    const setup = executor('read-write');
    const element = new FakeElement(setup.document, 'div');
    setup.document.add('#target', element);
    const query = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: '#target' }));
    const ref = (query.content as { match: { ref: string } }).match.ref;

    const attempts = await Promise.all([
      setup.executor.execute(call(PAGE_TOOL_NAMES.setAttribute, { ref, name: 'onfocus', value: 'alert(1)' })),
      setup.executor.execute(call(PAGE_TOOL_NAMES.setAttribute, { ref, name: 'bad name', value: 'x' })),
      setup.executor.execute(call(PAGE_TOOL_NAMES.removeAttribute, { ref, name: 'style' })),
      setup.executor.execute(call(PAGE_TOOL_NAMES.setAttribute, {
        ref,
        name: 'data-large',
        value: 'x'.repeat(4_001),
      })),
      setup.executor.execute(call(PAGE_TOOL_NAMES.setTextContent, {
        ref,
        value: 'x'.repeat(100_001),
      })),
    ]);

    expect(attempts.every(result => !result.success)).toBe(true);
    expect(element.getAttributeNames()).toEqual([]);
    expect(element.textContent).toBe('');
  });

  it('rejects set_value for non-form elements and unknown tool names', async () => {
    const setup = executor('read-write');
    const element = new FakeElement(setup.document, 'div');
    setup.document.add('#target', element);
    const query = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: '#target' }));
    const ref = (query.content as { match: { ref: string } }).match.ref;

    const wrongElement = await setup.executor.execute(call(PAGE_TOOL_NAMES.setValue, { ref, value: 'x' }));
    const unknownPageTool = await setup.executor.execute(call('windowllm_page_future_tool', {}));
    const unrelatedTool = await setup.executor.execute(call('site_tool', {}));

    expect(wrongElement.success).toBe(false);
    expect(wrongElement.error).toContain('input, textarea, or select');
    expect(unknownPageTool.success).toBe(false);
    expect(unknownPageTool.error).toContain('Unknown page tool');
    expect(unrelatedTool.success).toBe(false);
    expect(unrelatedTool.error).toContain('Unknown page tool');
  });

  it('redacts sensitive control values', async () => {
    const setup = executor('read');
    const password = new FakeElement(setup.document, 'input');
    password.value = 'secret';
    password.setAttribute('type', 'password');
    password.setAttribute('value', 'secret');
    setup.document.add('#password', password);

    const result = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: '#password' }));
    const match = (result.content as { match: { value: string; attributes: Record<string, string> } }).match;

    expect(match.value).toBe('[redacted]');
    expect(match.attributes.value).toBeUndefined();
  });

  it.each([
    ['hidden input', { type: 'hidden' }],
    ['one-time code', { autocomplete: 'one-time-code' }],
    ['current password', { autocomplete: 'section-login current-password' }],
    ['new password', { autocomplete: 'new-password' }],
    ['credit card', { autocomplete: 'cc-number' }],
  ])('redacts and prevents writes to a %s', async (_name, attributes) => {
    const setup = executor('read-write');
    const input = new FakeElement(setup.document, 'input');
    input.value = 'private';
    input.setAttribute('value', 'private');
    for (const [name, value] of Object.entries(attributes)) input.setAttribute(name, value);
    setup.document.add('#sensitive', input);

    const query = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: '#sensitive' }));
    const match = (query.content as { match: { ref: string; value: string; attributes: Record<string, string> } }).match;
    const write = await setup.executor.execute(call(PAGE_TOOL_NAMES.setValue, {
      ref: match.ref,
      value: 'replacement',
    }));

    expect(match.value).toBe('[redacted]');
    expect(match.attributes.value).toBeUndefined();
    expect(write.success).toBe(false);
    expect(input.value).toBe('private');
  });

  it('does not allow a sensitive control to be declassified through attributes', async () => {
    const setup = executor('read-write');
    const password = new FakeElement(setup.document, 'input');
    password.value = 'secret';
    password.setAttribute('type', 'password');
    setup.document.add('#password', password);

    const query = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: '#password' }));
    const ref = (query.content as { match: { ref: string } }).match.ref;
    const changeType = await setup.executor.execute(call(PAGE_TOOL_NAMES.setAttribute, {
      ref,
      name: 'type',
      value: 'text',
    }));
    const removeAutocomplete = await setup.executor.execute(call(PAGE_TOOL_NAMES.removeAttribute, {
      ref,
      name: 'autocomplete',
    }));

    expect(changeType.success).toBe(false);
    expect(removeAutocomplete.success).toBe(false);
    expect(password.getAttribute('type')).toBe('password');
  });

  it('keeps sensitivity sticky after page script removes the sensitive markers', async () => {
    const setup = executor('read-write');
    const password = new FakeElement(setup.document, 'input');
    password.value = 'secret';
    password.setAttribute('type', 'password');
    setup.document.add('#password', password);

    const query = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: '#password' }));
    const ref = (query.content as { match: { ref: string } }).match.ref;
    password.setAttribute('type', 'text');
    const write = await setup.executor.execute(call(PAGE_TOOL_NAMES.setValue, { ref, value: 'exposed' }));

    expect(write.success).toBe(false);
    expect(password.value).toBe('secret');
  });

  it('enforces scope for queries and previously captured references', async () => {
    const document = new FakeDocument();
    const root = new FakeElement(document, 'section');
    const inside = new FakeElement(document, 'p');
    const outside = new FakeElement(document, 'p');
    root.add('.item', inside);
    document.add('#scope', root);
    document.add('.item', outside);
    const scoped = new PageToolExecutor(
      { access: 'read-write', scope: '#scope' },
      document as unknown as Document,
    );

    const query = await scoped.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: '.item' }));
    const match = (query.content as { match: { ref: string } }).match;
    expect(match.ref).toBeTruthy();
    root.remove(inside);
    const write = await scoped.execute(call(PAGE_TOOL_NAMES.setTextContent, {
      ref: match.ref,
      value: 'escaped',
    }));

    expect(write.success).toBe(false);
    expect(write.error).toContain('outside the granted page scope');
    expect(inside.textContent).toBe('');
    expect(outside.textContent).toBe('');
  });

  it('rejects missing scopes, detached elements, cross-document elements, and unknown refs', async () => {
    const missingScope = new PageToolExecutor(
      { access: 'read-write', scope: '#missing' },
      new FakeDocument() as unknown as Document,
    );
    const missing = await missingScope.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: 'p' }));
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('scope did not match');

    for (const invalidation of ['detached', 'cross-document'] as const) {
      const setup = executor('read-write');
      const element = new FakeElement(setup.document, 'div');
      setup.document.add('#target', element);
      const query = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: '#target' }));
      const ref = (query.content as { match: { ref: string } }).match.ref;
      if (invalidation === 'detached') {
        element.isConnected = false;
      } else {
        (element as { ownerDocument: FakeDocument }).ownerDocument = new FakeDocument();
      }
      const result = await setup.executor.execute(call(PAGE_TOOL_NAMES.click, { ref }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('Stale or unknown');
    }

    const setup = executor('read-write');
    const unknown = await setup.executor.execute(call(PAGE_TOOL_NAMES.click, { ref: 'element_unknown' }));
    expect(unknown.success).toBe(false);
    expect(unknown.error).toContain('Stale or unknown');
  });

  it('bounds duplicated identity fields in snapshots', async () => {
    const setup = executor('read');
    const element = new FakeElement(setup.document, 'div');
    element.id = 'x'.repeat(500);
    element.className = 'y'.repeat(2_000);
    setup.document.add('div', element);

    const result = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: 'div' }));
    const match = (result.content as { match: { id: string; className: string } }).match;

    expect(match.id.length).toBeLessThanOrEqual(257);
    expect(match.className.length).toBeLessThanOrEqual(1_001);
  });

  it('clamps query limits and truncates text and attribute snapshots', async () => {
    const setup = executor('read');
    for (let index = 0; index < 55; index += 1) {
      const element = new FakeElement(setup.document, 'div');
      element.textContent = `item ${index} ${'x'.repeat(2_000)}`;
      element.setAttribute('data-long', 'y'.repeat(800));
      setup.document.add('.item', element);
    }

    const result = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelectorAll, {
      selector: '.item',
      limit: 500,
    }));
    const content = result.content as { matches: Array<{ textContent: string; attributes: Record<string, string> }>; truncated: boolean };

    expect(content.matches).toHaveLength(50);
    expect(content.truncated).toBe(true);
    expect(content.matches[0]!.textContent.length).toBeLessThanOrEqual(1_001);
    expect(content.matches[0]!.attributes['data-long']!.length).toBeLessThanOrEqual(501);
  });

  it('rejects empty and oversized selectors and clears refs on destroy', async () => {
    const setup = executor('read-write');
    const element = new FakeElement(setup.document, 'div');
    setup.document.add('#target', element);
    const query = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: '#target' }));
    const ref = (query.content as { match: { ref: string } }).match.ref;

    const empty = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, { selector: '' }));
    const oversized = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, {
      selector: 'x'.repeat(2_001),
    }));
    setup.executor.destroy();
    const stale = await setup.executor.execute(call(PAGE_TOOL_NAMES.click, { ref }));

    expect(empty.success).toBe(false);
    expect(oversized.success).toBe(false);
    expect(stale.success).toBe(false);
  });

  it('caps the number of retained element references', async () => {
    const setup = executor('read');
    for (let index = 0; index <= 1_000; index += 1) {
      setup.document.add(`#element-${index}`, new FakeElement(setup.document, 'div'));
    }
    for (let index = 0; index < 1_000; index += 1) {
      const result = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, {
        selector: `#element-${index}`,
      }));
      expect(result.success).toBe(true);
    }

    const overflow = await setup.executor.execute(call(PAGE_TOOL_NAMES.querySelector, {
      selector: '#element-1000',
    }));
    expect(overflow.success).toBe(false);
    expect(overflow.error).toContain('reference limit of 1000');
  });
});

describe('runPageToolLoop', () => {
  it('executes page tool calls until the model returns a final response', async () => {
    let turn = 0;
    const result = await runPageToolLoop({
      async complete(toolMessages) {
        turn += 1;
        if (turn === 1) {
          expect(toolMessages).toBeNull();
          return {
            message: {
              role: 'assistant',
              content: '',
              toolCalls: [call(PAGE_TOOL_NAMES.querySelector, { selector: '#title' })],
            },
            finishReason: 'tool_use',
            toolCalls: [call(PAGE_TOOL_NAMES.querySelector, { selector: '#title' })],
            usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
          };
        }
        expect(toolMessages?.[0]?.role).toBe('tool');
        return {
          message: { role: 'assistant', content: 'Finished' },
          finishReason: 'complete',
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        };
      },
      async execute(toolCall) {
        return { toolCallId: toolCall.id, content: { match: null }, success: true };
      },
    });

    expect(result.message.content).toBe('Finished');
    expect(result.steps).toBe(2);
    expect(result.stopReason).toBe('complete');
    expect(result.pageToolExecutions).toHaveLength(1);
    expect(result.usage.totalTokens).toBe(8);
  });

  it('returns site-defined tools without executing a partial batch', async () => {
    let executions = 0;
    const customCall = call('site_tool', {});
    const result = await runPageToolLoop({
      async complete() {
        return {
          message: { role: 'assistant', content: '', toolCalls: [customCall] },
          finishReason: 'tool_use',
          toolCalls: [customCall],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async execute(toolCall) {
        executions += 1;
        return { toolCallId: toolCall.id, content: {}, success: true };
      },
    });

    expect(result.toolCalls).toEqual([customCall]);
    expect(result.stopReason).toBe('custom_tool');
    expect(executions).toBe(0);
  });

  it('does not execute tool calls when the model-turn limit is exhausted', async () => {
    let executions = 0;
    const recorded: unknown[] = [];
    const pending = call(PAGE_TOOL_NAMES.click, { ref: 'element_unknown' });
    const result = await runPageToolLoop({
      maxSteps: 1,
      async complete() {
        return {
          message: { role: 'assistant', content: '', toolCalls: [pending] },
          finishReason: 'tool_use',
          toolCalls: [pending],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async execute(toolCall) {
        executions += 1;
        return { toolCallId: toolCall.id, content: {}, success: true };
      },
      recordToolMessages(messages) {
        recorded.push(...messages);
      },
    });

    expect(result.stopReason).toBe('max_steps');
    expect(result.pageToolExecutions).toEqual([]);
    expect(executions).toBe(0);
    expect(recorded).toMatchObject([{ role: 'tool', toolCallId: pending.id }]);
  });

  it('aborts before requesting another provider turn', async () => {
    const controller = new AbortController();
    controller.abort();
    let completions = 0;

    await expect(runPageToolLoop({
      signal: controller.signal,
      async complete() {
        completions += 1;
        throw new Error('must not run');
      },
      async execute(toolCall) {
        return { toolCallId: toolCall.id, content: {}, success: true };
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(completions).toBe(0);
  });

  it('records stopped results for the remainder of a batch when aborted', async () => {
    const controller = new AbortController();
    const first = call(PAGE_TOOL_NAMES.querySelector, { selector: '#first' });
    const second = call(PAGE_TOOL_NAMES.click, { ref: 'element_second' });
    const recorded: Message[][] = [];

    await expect(runPageToolLoop({
      signal: controller.signal,
      async complete() {
        return {
          message: { role: 'assistant', content: '', toolCalls: [first, second] },
          finishReason: 'tool_use',
          toolCalls: [first, second],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async execute(toolCall) {
        controller.abort();
        return { toolCallId: toolCall.id, content: { match: null }, success: true };
      },
      recordToolMessages(messages) {
        recorded.push(messages);
      },
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toHaveLength(2);
    expect(recorded[0]?.[0]).toMatchObject({ role: 'tool', toolCallId: first.id });
    expect(recorded[0]?.[1]?.content).toContain('run was aborted');
  });

  it('preserves completed tool history when the next provider turn fails', async () => {
    const pending = call(PAGE_TOOL_NAMES.querySelector, { selector: '#target' });
    const recorded: Message[][] = [];
    let turn = 0;

    await expect(runPageToolLoop({
      async complete() {
        turn += 1;
        if (turn === 2) throw new Error('provider unavailable');
        return {
          message: { role: 'assistant', content: '', toolCalls: [pending] },
          finishReason: 'tool_use',
          toolCalls: [pending],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async execute(toolCall) {
        return { toolCallId: toolCall.id, content: { match: null }, success: true };
      },
      recordToolMessages(messages) {
        recorded.push(messages);
      },
    })).rejects.toThrow('provider unavailable');

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.[0]).toMatchObject({ role: 'tool', toolCallId: pending.id });
  });
});
