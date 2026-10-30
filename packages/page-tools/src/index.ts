import type {
  AgentResult,
  CompletionResult,
  Message,
  PageAccessOptions,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from '@windowllm/types';

export const PAGE_TOOL_PREFIX = 'windowllm_page_';

export const PAGE_TOOL_NAMES = {
  querySelector: `${PAGE_TOOL_PREFIX}query_selector`,
  querySelectorAll: `${PAGE_TOOL_PREFIX}query_selector_all`,
  click: `${PAGE_TOOL_PREFIX}click`,
  setValue: `${PAGE_TOOL_PREFIX}set_value`,
  setTextContent: `${PAGE_TOOL_PREFIX}set_text_content`,
  setAttribute: `${PAGE_TOOL_PREFIX}set_attribute`,
  removeAttribute: `${PAGE_TOOL_PREFIX}remove_attribute`,
} as const;

const SELECTOR_PROPERTY = {
  type: 'string' as const,
  description: 'A CSS selector, with the same matching semantics as document.querySelector().',
};

const REF_PROPERTY = {
  type: 'string' as const,
  description: 'An opaque element reference returned by a page query tool.',
};

const READ_TOOLS: readonly ToolDefinition[] = [
  {
    name: PAGE_TOOL_NAMES.querySelector,
    description: 'Return the first page element matching a CSS selector, or null when there is no match.',
    parameters: {
      type: 'object',
      properties: { selector: SELECTOR_PROPERTY },
      required: ['selector'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: PAGE_TOOL_NAMES.querySelectorAll,
    description: 'Return page elements matching a CSS selector in document order.',
    parameters: {
      type: 'object',
      properties: {
        selector: SELECTOR_PROPERTY,
        limit: {
          type: 'number',
          description: 'Maximum matches to return, from 1 to 50. Defaults to 20.',
          default: 20,
        },
      },
      required: ['selector'],
      additionalProperties: false,
    },
    strict: true,
  },
];

const WRITE_TOOLS: readonly ToolDefinition[] = [
  {
    name: PAGE_TOOL_NAMES.click,
    description: 'Click a previously queried page element.',
    parameters: {
      type: 'object',
      properties: { ref: REF_PROPERTY },
      required: ['ref'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: PAGE_TOOL_NAMES.setValue,
    description: 'Set the value of an input, textarea, or select and dispatch input and change events.',
    parameters: {
      type: 'object',
      properties: {
        ref: REF_PROPERTY,
        value: { type: 'string', description: 'The new form-control value.' },
      },
      required: ['ref', 'value'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: PAGE_TOOL_NAMES.setTextContent,
    description: 'Replace the textContent of a previously queried page element.',
    parameters: {
      type: 'object',
      properties: {
        ref: REF_PROPERTY,
        value: { type: 'string', description: 'The new text content.' },
      },
      required: ['ref', 'value'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: PAGE_TOOL_NAMES.setAttribute,
    description: 'Set a data-*, aria-*, or title attribute on a previously queried page element.',
    parameters: {
      type: 'object',
      properties: {
        ref: REF_PROPERTY,
        name: { type: 'string', description: 'Attribute name. Only data-*, aria-*, and title are allowed.' },
        value: { type: 'string', description: 'Attribute value.' },
      },
      required: ['ref', 'name', 'value'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: PAGE_TOOL_NAMES.removeAttribute,
    description: 'Remove a data-*, aria-*, or title attribute from a previously queried page element.',
    parameters: {
      type: 'object',
      properties: {
        ref: REF_PROPERTY,
        name: { type: 'string', description: 'Attribute name to remove.' },
      },
      required: ['ref', 'name'],
      additionalProperties: false,
    },
    strict: true,
  },
];

export interface PageElementSnapshot {
  ref: string;
  tagName: string;
  id?: string;
  className?: string;
  textContent: string;
  attributes: Record<string, string>;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  visible: boolean;
}

export interface PageToolResult {
  selector?: string;
  match?: PageElementSnapshot | null;
  matches?: PageElementSnapshot[];
  truncated?: boolean;
  element?: PageElementSnapshot;
}

export function getPageToolDefinitions(options: PageAccessOptions): ToolDefinition[] {
  const definitions = options.access === 'read-write'
    ? [...READ_TOOLS, ...WRITE_TOOLS]
    : [...READ_TOOLS];
  return definitions.map(definition => ({
    ...definition,
    parameters: {
      ...definition.parameters,
      properties: { ...definition.parameters.properties },
      required: definition.parameters.required ? [...definition.parameters.required] : undefined,
    },
  }));
}

export function isPageToolName(name: string): boolean {
  return name.startsWith(PAGE_TOOL_PREFIX);
}

export interface PageToolLoopOptions {
  /** Called once with null, then with locally-produced tool messages. */
  complete(toolMessages: Message[] | null): Promise<CompletionResult>;
  execute(call: ToolCall): Promise<ToolResult>;
  /** Commit tool messages to session history before the next provider turn. */
  recordToolMessages?(messages: Message[]): void;
  maxSteps?: number;
  signal?: AbortSignal;
}

function abortError(): Error {
  const error = new Error('The agent run was aborted.');
  error.name = 'AbortError';
  return error;
}

function stoppedToolMessage(call: ToolCall, reason: string): Message {
  return {
    role: 'tool',
    toolCallId: call.id,
    content: JSON.stringify({ error: reason }),
  };
}

/**
 * Run the provider turns for built-in page tools. Site-defined or mixed tool
 * batches are returned to the caller unchanged for the existing manual flow.
 */
export async function runPageToolLoop(options: PageToolLoopOptions): Promise<AgentResult> {
  const requestedSteps = options.maxSteps ?? 8;
  const maxSteps = Number.isFinite(requestedSteps)
    ? Math.max(1, Math.min(32, Math.floor(requestedSteps)))
    : 8;
  const pageToolExecutions: AgentResult['pageToolExecutions'] = [];
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let toolMessages: Message[] | null = null;

  for (let step = 1; step <= maxSteps; step += 1) {
    if (options.signal?.aborted) {
      throw abortError();
    }

    const result = await options.complete(toolMessages);
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.totalTokens += result.usage.totalTokens;
    const calls = result.toolCalls || result.message.toolCalls || [];

    if (result.finishReason !== 'tool_use' || calls.length === 0) {
      return { ...result, usage, steps: step, stopReason: 'complete', pageToolExecutions };
    }
    if (calls.some(call => !isPageToolName(call.name))) {
      return { ...result, usage, steps: step, stopReason: 'custom_tool', pageToolExecutions };
    }
    if (step === maxSteps) {
      options.recordToolMessages?.(calls.map(call => stoppedToolMessage(
        call,
        `Page tool was not executed because the ${maxSteps}-step limit was reached.`,
      )));
      return { ...result, usage, steps: step, stopReason: 'max_steps', pageToolExecutions };
    }

    toolMessages = [];
    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index]!;
      if (options.signal?.aborted) {
        for (const pending of calls.slice(index)) {
          toolMessages.push(stoppedToolMessage(pending, 'Page tool was not executed because the run was aborted.'));
        }
        options.recordToolMessages?.(toolMessages);
        throw abortError();
      }
      const toolResult = await options.execute(call);
      pageToolExecutions.push({ call, result: toolResult });
      toolMessages.push({
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify(toolResult.content),
      });
    }
    options.recordToolMessages?.(toolMessages);
  }

  throw new Error('Unreachable page tool loop state.');
}

function stringArgument(call: ToolCall, name: string, allowEmpty = false, maxLength = 100_000): string {
  const value = call.arguments[name];
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    const requirement = allowEmpty ? 'a' : 'a non-empty';
    throw new Error(`Page tool ${call.name} requires ${requirement} ${name} string.`);
  }
  if (value.length > maxLength) {
    throw new Error(`Page tool ${call.name} ${name} exceeds ${maxLength} characters.`);
  }
  return value;
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(50, Math.floor(value)));
}

function compactText(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
}

function isSensitiveControl(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    if (type === 'password' || type === 'hidden') return true;
  } else if (tag !== 'select' && tag !== 'textarea') {
    return false;
  }
  const autocomplete = (element.getAttribute('autocomplete') || '').toLowerCase();
  return autocomplete.split(/\s+/).some(token =>
    token === 'one-time-code'
    || token === 'current-password'
    || token === 'new-password'
    || token.startsWith('cc-')
  );
}

const SECRET_META_NAME = /csrf|xsrf|token|nonce|secret|session|api[-_]?key/i;

/** Meta elements that conventionally carry anti-forgery tokens or credentials. */
function isSecretMeta(element: Element): boolean {
  if (element.tagName.toLowerCase() !== 'meta') return false;
  return ['name', 'property', 'http-equiv', 'itemprop'].some(name =>
    SECRET_META_NAME.test(element.getAttribute(name) || ''));
}

/** Attributes that are neither returned nor testable by selectors. */
function redactedAttributeNames(element: Element, sensitive: boolean): string[] {
  const names = ['nonce'];
  if (sensitive) names.push('value', 'selected');
  if (isSecretMeta(element)) names.push('content');
  return names;
}

function safeAttributes(element: Element, sensitive: boolean): Record<string, string> {
  const result: Record<string, string> = {};
  const redacted = redactedAttributeNames(element, sensitive);
  for (const name of element.getAttributeNames().slice(0, 40)) {
    const lower = name.toLowerCase();
    if (lower.startsWith('on') || redacted.includes(lower)) continue;
    result[name] = compactText(element.getAttribute(name) || '', 500);
  }
  return result;
}

/** Elements whose text is code, inert markup, or a form value rather than page prose. */
const TEXT_HIDDEN_TAGS = new Set(['script', 'style', 'template', 'noscript']);
const TEXT_HIDDEN_SELECTOR = 'script, style, template, noscript, textarea';
const MAX_TEXT_SCAN = 100_000;

/**
 * textContent without script, style, template, and noscript text, or the
 * initial text of sensitive textareas, anywhere in the subtree.
 */
function readableText(element: Element, isSensitive: (element: Element) => boolean): string {
  if (TEXT_HIDDEN_TAGS.has(element.tagName.toLowerCase()) || isSensitive(element)) return '';
  if (!element.querySelector(TEXT_HIDDEN_SELECTOR)) return element.textContent || '';
  let text = '';
  const pending: Node[] = [...Array.from(element.childNodes)].reverse();
  while (pending.length > 0 && text.length < MAX_TEXT_SCAN) {
    const node = pending.pop()!;
    if (node.nodeType === 3) {
      text += node.textContent || '';
    } else if (node.nodeType === 1) {
      const child = node as Element;
      if (TEXT_HIDDEN_TAGS.has(child.tagName.toLowerCase()) || isSensitive(child)) continue;
      pending.push(...Array.from(child.childNodes).reverse());
    }
  }
  return text;
}

function isVisible(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  if (element.hasAttribute('hidden')) return false;
  return element.getClientRects().length > 0;
}

function dispatchValueEvents(element: Element): void {
  const view = element.ownerDocument.defaultView;
  const EventConstructor = view?.Event || Event;
  element.dispatchEvent(new EventConstructor('input', { bubbles: true }));
  element.dispatchEvent(new EventConstructor('change', { bubbles: true }));
}

function assertMutableAttribute(name: string): void {
  const lower = name.toLowerCase();
  if (!/^[a-zA-Z_:][a-zA-Z0-9:._-]*$/.test(name)) {
    throw new Error(`Invalid attribute name: ${name}`);
  }
  if (lower !== 'title' && !lower.startsWith('data-') && !lower.startsWith('aria-')) {
    throw new Error(`Attribute ${name} is not mutable; only data-*, aria-*, and title are allowed.`);
  }
}

/**
 * Elements whose text the browser interprets as code, markup, or styles.
 * Writing to an empty inline script executes it, and style text can exfiltrate
 * page data through url() requests.
 */
const TEXT_IMMUTABLE_TAGS = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'object',
  'embed',
]);

function assertTextMutable(element: Element): void {
  const tag = element.tagName.toLowerCase();
  if (TEXT_IMMUTABLE_TAGS.has(tag)) {
    throw new Error(`set_text_content cannot write to <${tag}> elements.`);
  }
}

interface StoredElement {
  element: Element;
  sensitive: boolean;
}

const MAX_ELEMENT_REFS = 1_000;

/** Executes built-in page tools against one document and maintains opaque refs. */
export class PageToolExecutor {
  private readonly options: PageAccessOptions;
  private readonly document: Document;
  private readonly elements = new Map<string, StoredElement>();
  private refs = new WeakMap<Element, string>();

  constructor(options: PageAccessOptions, targetDocument: Document = document) {
    this.options = { ...options };
    this.document = targetDocument;
  }

  get definitions(): ToolDefinition[] {
    return getPageToolDefinitions(this.options);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const content = this.executeUnsafe(call);
      return { toolCallId: call.id, content, success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { toolCallId: call.id, content: { error: message }, success: false, error: message };
    }
  }

  destroy(): void {
    this.elements.clear();
    this.refs = new WeakMap<Element, string>();
  }

  private executeUnsafe(call: ToolCall): PageToolResult {
    if (!isPageToolName(call.name)) throw new Error(`Unknown page tool: ${call.name}`);

    switch (call.name) {
      case PAGE_TOOL_NAMES.querySelector:
        return this.querySelector(stringArgument(call, 'selector', false, 2_000));
      case PAGE_TOOL_NAMES.querySelectorAll:
        return this.querySelectorAll(stringArgument(call, 'selector', false, 2_000), clampLimit(call.arguments.limit));
      case PAGE_TOOL_NAMES.click: {
        this.assertWriteAccess();
        const { element } = this.resolve(stringArgument(call, 'ref', false, 100));
        const clickable = element as Element & { click?: () => void };
        if (typeof clickable.click !== 'function') throw new Error('Element does not support click().');
        clickable.click();
        return { element: this.snapshot(element, 2000) };
      }
      case PAGE_TOOL_NAMES.setValue: {
        this.assertWriteAccess();
        const stored = this.resolve(stringArgument(call, 'ref', false, 100));
        const { element } = stored;
        const tag = element.tagName.toLowerCase();
        if (!['input', 'textarea', 'select'].includes(tag)) {
          throw new Error('set_value requires an input, textarea, or select element.');
        }
        stored.sensitive ||= isSensitiveControl(element);
        if (stored.sensitive) throw new Error('Sensitive form controls cannot be written by page tools.');
        (element as Element & { value: string }).value = stringArgument(call, 'value', true);
        dispatchValueEvents(element);
        return { element: this.snapshot(element, 2000) };
      }
      case PAGE_TOOL_NAMES.setTextContent: {
        this.assertWriteAccess();
        const { element } = this.resolve(stringArgument(call, 'ref', false, 100));
        assertTextMutable(element);
        element.textContent = stringArgument(call, 'value', true);
        return { element: this.snapshot(element, 2000) };
      }
      case PAGE_TOOL_NAMES.setAttribute: {
        this.assertWriteAccess();
        const { element } = this.resolve(stringArgument(call, 'ref', false, 100));
        const name = stringArgument(call, 'name', false, 100);
        const value = stringArgument(call, 'value', true, 4_000);
        assertMutableAttribute(name);
        element.setAttribute(name, value);
        return { element: this.snapshot(element, 2000) };
      }
      case PAGE_TOOL_NAMES.removeAttribute: {
        this.assertWriteAccess();
        const { element } = this.resolve(stringArgument(call, 'ref', false, 100));
        const name = stringArgument(call, 'name', false, 100);
        assertMutableAttribute(name);
        element.removeAttribute(name);
        return { element: this.snapshot(element, 2000) };
      }
      default:
        throw new Error(`Unknown page tool: ${call.name}`);
    }
  }

  private root(): ParentNode {
    if (!this.options.scope) return this.document;
    const root = this.document.querySelector(this.options.scope);
    if (!root) throw new Error(`Page tool scope did not match: ${this.options.scope}`);
    return root;
  }

  /** Sensitive controls, including sticky classifications and options of a sensitive select. */
  private isSensitive(element: Element): boolean {
    const ref = this.refs.get(element);
    if ((ref !== undefined && this.elements.get(ref)?.sensitive === true) || isSensitiveControl(element)) {
      return true;
    }
    const tag = element.tagName.toLowerCase();
    if (tag !== 'option' && tag !== 'optgroup') return false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName.toLowerCase() === 'select') return this.isSensitive(parent);
    }
    return false;
  }

  /**
   * Evaluate a model-supplied selector against an inert copy of the granted
   * subtree. The copy has no ancestors or siblings outside the scope, so
   * :has(), :root, and ancestor combinators cannot observe ungranted state, and
   * sensitive controls carry no value for attribute or state selectors to test.
   * The copy has no browsing context, so it runs no scripts, upgrades no custom
   * elements, and loads no resources.
   */
  private queryInert(selector: string): Element[] {
    const scoped = this.root();
    const live = scoped === this.document ? this.document.documentElement : scoped as Element;
    if (!live) return [];
    const inert = this.document.implementation.createHTMLDocument('');
    const copy = inert.importNode(live, true);
    if (inert.documentElement) inert.removeChild(inert.documentElement);
    inert.appendChild(copy);

    const originals = new Map<Element, Element>();
    const pending: Array<[Element, Element]> = [[live, copy]];
    while (pending.length > 0) {
      const [original, copied] = pending.pop()!;
      originals.set(copied, original);
      const sensitive = this.isSensitive(original);
      for (const name of redactedAttributeNames(original, sensitive)) copied.removeAttribute(name);
      if (sensitive && 'value' in copied) (copied as Element & { value: string }).value = '';
      for (let index = 0; index < original.children.length; index += 1) {
        const copiedChild = copied.children[index];
        if (copiedChild) pending.push([original.children[index]!, copiedChild]);
      }
    }

    return Array.from(inert.querySelectorAll(selector))
      .filter(element => scoped === this.document || element !== copy)
      .map(element => originals.get(element))
      .filter((element): element is Element => element !== undefined);
  }

  private querySelector(selector: string): PageToolResult {
    const element = this.queryInert(selector)[0];
    return { selector, match: element ? this.snapshot(element, 4000) : null };
  }

  private querySelectorAll(selector: string, limit: number): PageToolResult {
    const all = this.queryInert(selector);
    return {
      selector,
      matches: all.slice(0, limit).map(element => this.snapshot(element, 1000)),
      truncated: all.length > limit,
    };
  }

  private snapshot(element: Element, textLimit: number): PageElementSnapshot {
    const ref = this.store(element);
    const stored = this.elements.get(ref)!;
    stored.sensitive ||= this.isSensitive(element);
    const tag = element.tagName.toLowerCase();
    const control = element as Element & { value?: unknown; checked?: unknown; disabled?: unknown };
    const snapshot: PageElementSnapshot = {
      ref,
      tagName: element.tagName,
      textContent: compactText(readableText(element, node => this.isSensitive(node)), textLimit),
      attributes: safeAttributes(element, stored.sensitive),
      visible: isVisible(element),
    };
    if (element.id) snapshot.id = compactText(element.id, 256);
    if (typeof element.className === 'string' && element.className) {
      snapshot.className = compactText(element.className, 1_000);
    }
    if (['input', 'textarea', 'select'].includes(tag) && typeof control.value === 'string') {
      snapshot.value = stored.sensitive ? '[redacted]' : compactText(control.value, 2000);
    }
    if (typeof control.checked === 'boolean') snapshot.checked = control.checked;
    if (typeof control.disabled === 'boolean') snapshot.disabled = control.disabled;
    return snapshot;
  }

  private store(element: Element): string {
    const existingRef = this.refs.get(element);
    const existing = existingRef ? this.elements.get(existingRef) : undefined;
    if (existingRef && existing) {
      existing.sensitive ||= isSensitiveControl(element);
      return existingRef;
    }
    if (this.elements.size >= MAX_ELEMENT_REFS) {
      throw new Error(`Page tool element reference limit of ${MAX_ELEMENT_REFS} was reached.`);
    }
    const ref = `element_${crypto.randomUUID()}`;
    this.elements.set(ref, { element, sensitive: isSensitiveControl(element) });
    this.refs.set(element, ref);
    return ref;
  }

  private resolve(ref: string): StoredElement {
    const stored = this.elements.get(ref);
    const element = stored?.element;
    if (!stored || !element || !element.isConnected || element.ownerDocument !== this.document) {
      this.elements.delete(ref);
      throw new Error(`Stale or unknown element reference: ${ref}`);
    }
    const root = this.root();
    if (root !== this.document && element !== root && !(root as Element).contains(element)) {
      throw new Error(`Element reference is outside the granted page scope: ${ref}`);
    }
    stored.sensitive ||= isSensitiveControl(element);
    return stored;
  }

  private assertWriteAccess(): void {
    if (this.options.access !== 'read-write') {
      throw new Error('This session has read-only page access.');
    }
  }
}
