/**
 * WindowLLM landing surface (windowllm.org).
 *
 * Shown as the standalone page for first-time / locked visitors: explains what
 * WindowLLM is and how to use it WITHOUT the extension, then hands off to the
 * vault setup/unlock card (passed as `children`) in the #setup section.
 */

import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { ProviderLogo } from './ProviderLogo';

const PROVIDERS = [
  { type: 'anthropic', name: 'Anthropic' },
  { type: 'openai', name: 'OpenAI' },
  { type: 'gemini', name: 'Gemini' },
  { type: 'ollama', name: 'Ollama' },
  { type: 'openrouter', name: 'OpenRouter' },
];

const GITHUB = 'https://github.com/windowllm/windowllm';

interface Point {
  readonly x: number;
  readonly y: number;
}

interface WindowSize {
  readonly width: number;
  readonly height: number;
}

interface PointerGesture {
  readonly pointerId: number;
  readonly start: Point;
  readonly origin: Point;
}

const HOME_POSITION: Point = { x: 0, y: 0 };
const RESIZE_STEP = 12;

function HeroWindow() {
  const windowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<PointerGesture | null>(null);
  const resizeRef = useRef<PointerGesture & { readonly size: WindowSize } | null>(null);
  const [isAlive, setIsAlive] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [position, setPosition] = useState<Point>(HOME_POSITION);
  const [size, setSize] = useState<WindowSize | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const wake = () => {
    if (!isAlive) setAnnouncement('Demo window awake. Drag the toolbar to move it, or use the corner handle to resize it.');
    setIsAlive(true);
  };

  const snapHome = () => {
    dragRef.current = null;
    resizeRef.current = null;
    setPosition(HOME_POSITION);
    setSize(null);
    setIsCollapsed(false);
    setIsAlive(false);
    setAnnouncement('Demo window snapped home and dimmed.');
  };

  const toggleCollapsed = () => {
    const nextCollapsed = !isCollapsed;
    setIsAlive(true);
    setIsCollapsed(nextCollapsed);
    setAnnouncement(nextCollapsed ? 'Demo window collapsed.' : 'Demo window expanded.');
  };

  const constrainPosition = (next: Point, current: Point) => {
    const rect = windowRef.current?.getBoundingClientRect();
    if (!rect) return next;

    const visibleEdge = 72;
    const deltaX = next.x - current.x;
    const deltaY = next.y - current.y;
    const left = Math.min(window.innerWidth - visibleEdge, Math.max(visibleEdge - rect.width, rect.left + deltaX));
    const top = Math.min(window.innerHeight - visibleEdge, Math.max(0, rect.top + deltaY));

    return {
      x: current.x + left - rect.left,
      y: current.y + top - rect.top,
    };
  };

  const moveWindow = (next: Point) => {
    setPosition((current) => constrainPosition(next, current));
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isAlive || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: position,
    };
  };

  const dragWindow = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    moveWindow({
      x: drag.origin.x + event.clientX - drag.start.x,
      y: drag.origin.y + event.clientY - drag.start.y,
    });
  };

  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const moveWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isAlive) return;
    const step = event.shiftKey ? 2 : RESIZE_STEP;
    const movement: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const delta = movement[event.key];
    if (delta) {
      event.preventDefault();
      moveWindow({ x: position.x + delta.x, y: position.y + delta.y });
    } else if (event.key === 'Escape') {
      snapHome();
    }
  };

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    wake();
    const rect = windowRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: HOME_POSITION,
      size: { width: rect.width, height: rect.height },
    };
  };

  const resizeWindow = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const maxWidth = Math.max(280, window.innerWidth - 32);
    const maxHeight = Math.max(190, window.innerHeight - 32);
    setSize({
      width: Math.min(maxWidth, Math.max(280, resize.size.width + event.clientX - resize.start.x)),
      height: Math.min(maxHeight, Math.max(190, resize.size.height + event.clientY - resize.start.y)),
    });
  };

  const stopResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null;
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const rect = windowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const step = event.shiftKey ? 2 : RESIZE_STEP;
    const deltas: Record<string, WindowSize> = {
      ArrowLeft: { width: -step, height: 0 },
      ArrowRight: { width: step, height: 0 },
      ArrowUp: { width: 0, height: -step },
      ArrowDown: { width: 0, height: step },
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    const maxWidth = Math.max(280, window.innerWidth - 32);
    const maxHeight = Math.max(190, window.innerHeight - 32);
    setSize({
      width: Math.min(maxWidth, Math.max(280, rect.width + delta.width)),
      height: Math.min(maxHeight, Math.max(190, rect.height + delta.height)),
    });
  };

  const style: CSSProperties = {
    transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
    ...(size && !isCollapsed ? { width: size.width, height: size.height } : {}),
  };

  return (
    <div className="wl-window-stage">
      <div
        ref={windowRef}
        className={`wl-window wl-rise${isAlive ? ' is-alive' : ''}${isCollapsed ? ' is-collapsed' : ''}`}
        style={{ ...style, animationDelay: '0.3s' }}
      >
        <div
          className="wl-chrome"
          tabIndex={isAlive ? 0 : -1}
          role={isAlive ? 'group' : undefined}
          aria-label={isAlive ? 'Movable demo window. Use arrow keys to move it, or press Escape to snap it home.' : undefined}
          onPointerDown={startDrag}
          onPointerMove={dragWindow}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onKeyDown={moveWithKeyboard}
        >
          <div className="wl-dots">
            <button type="button" className="wl-dot wl-dot-close" onClick={snapHome} aria-label="Snap window home and dim it" title="Snap home" />
            <button
              type="button"
              className="wl-dot wl-dot-collapse"
              onClick={toggleCollapsed}
              aria-expanded={!isCollapsed}
              aria-controls="wl-live-window-content"
              aria-label={isCollapsed ? 'Expand demo window' : 'Collapse demo window'}
              title={isCollapsed ? 'Expand' : 'Collapse'}
            />
            <button
              type="button"
              className="wl-dot wl-dot-wake"
              onClick={wake}
              aria-label={isAlive ? 'Demo window is alive' : 'Wake demo window'}
              title={isAlive ? 'Alive' : 'Wake window'}
            />
          </div>
          <div className="wl-addr">yoursite.com</div>
        </div>
        <div id="wl-live-window-content" className="wl-window-content" aria-hidden={isCollapsed}>
          <div className="wl-window-content-inner">
            <pre className="wl-code"><span className="c">// any page, no keys of its own</span>{'\n'}
<span className="k">const</span> s = <span className="k">await</span> window.llm{'\n'}  .requestSession();{'\n'}
<span className="k">const</span> r = <span className="k">await</span> s.complete({'\n'}  <span className="s">"Draft a friendly reply"</span>{'\n'});
<span className="out"><span className="c">// streamed from your model</span>{'\n'}Of course. Here is a warm,<br />concise draft you can send<span className="wl-cursor" /></span></pre>
          </div>
        </div>
        {isAlive && !isCollapsed && (
          <button
            type="button"
            className="wl-resize-handle"
            aria-label="Resize demo window. Use arrow keys for precise resizing."
            title="Resize"
            onPointerDown={startResize}
            onPointerMove={resizeWindow}
            onPointerUp={stopResize}
            onPointerCancel={stopResize}
            onKeyDown={resizeWithKeyboard}
          />
        )}
        <span className="wl-sr-only" role="status" aria-live="polite">
          {announcement}
        </span>
      </div>
    </div>
  );
}

// Hand-tokenized so the code block is syntax-highlighted (no highlighter dep).
const DEV_SNIPPET_HTML = [
  '<span class="t">&lt;script</span> <span class="a">src</span>=<span class="s">"https://windowllm.org/llm.js"</span><span class="t">&gt;&lt;/script&gt;</span>',
  '',
  '<span class="k">const</span> session = <span class="k">await</span> window.llm.requestSession();',
  '<span class="k">const</span> reply = <span class="k">await</span> session.complete(',
  '  <span class="s">"Explain WindowLLM in one line."</span>',
  ');',
].join('\n');

export function Landing({ onOpenVault }: { onOpenVault: () => void }) {
  return (
    <div className="wl">
      <nav className="wl-shell wl-nav">
        <div className="wl-brand">
          <span className="wl-mark">W</span>
          WindowLLM
        </div>
        <div className="wl-nav-links">
          <a href="#how">How it works</a>
          <a href="#extension">Extension</a>
          <a href="/demo/">Demo</a>
          <a href="/docs/">Docs</a>
          <a href="/spec/">Spec</a>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>
          <button type="button" onClick={onOpenVault} className="wl-nav-cta wl-btn wl-btn-gold" style={{ padding: '0.5rem 1rem' }}>Open vault</button>
        </div>
      </nav>

      {/* Hero */}
      <header className="wl-shell wl-hero">
        <div>
          <span className="wl-kicker wl-rise" style={{ animationDelay: '0.02s' }}>window.llm</span>
          <h1 className="wl-h1 wl-rise" style={{ animationDelay: '0.08s' }}>
            Bring your own AI to <em>every website</em>.
          </h1>
          <p className="wl-lede wl-rise" style={{ animationDelay: '0.16s' }}>
            Configure your models once, here. Any site can call <code>window.llm</code> to
            use them, while your API keys stay sealed inside windowllm.org. No extension required.
          </p>
          <div className="wl-cta-row wl-rise" style={{ animationDelay: '0.24s' }}>
            <button type="button" onClick={onOpenVault} className="wl-btn wl-btn-gold">Set up your vault</button>
            <a href="#developers" className="wl-btn wl-btn-ghost">For developers</a>
          </div>
        </div>

        <HeroWindow />
      </header>

      {/* Value claims */}
      <div className="wl-shell">
        <div className="wl-values">
          <div className="wl-value">
            <span className="num">01</span>
            <h3>Your keys never leave</h3>
            <p>API keys are encrypted locally and used only from windowllm.org. Sites you visit receive answers, never your secrets.</p>
          </div>
          <div className="wl-value">
            <span className="num">02</span>
            <h3>No install to start</h3>
            <p>Chrome, Firefox, and Edge work through a sealed iframe, nothing to download. Safari and local models use the optional extension.</p>
          </div>
          <div className="wl-value">
            <span className="num">03</span>
            <h3>One API, any model</h3>
            <p>Sites request capabilities, not a specific vendor. You decide which model answers, and can switch it any time.</p>
          </div>
        </div>
      </div>

      {/* How it works */}
      <section id="how" className="wl-shell wl-section">
        <div className="wl-section-head">
          <span className="wl-eyebrow">How it works</span>
          <h2 className="wl-h2">Your AI on any site, <em>without an extension</em>.</h2>
          <p>The vault holds your keys at this origin. A site includes one script, opens a hidden windowllm.org frame, and talks to it over postMessage.</p>
        </div>
        <div className="wl-flow">
          <div className="wl-step">
            <h3>You configure providers here</h3>
            <p>Add your API keys at windowllm.org. They are encrypted with your passphrase and stored only in <b>this origin&rsquo;s</b> local storage.</p>
          </div>
          <div className="wl-step">
            <h3>A site loads llm.js</h3>
            <p>It opens a hidden windowllm.org frame and asks for a session. You <b>approve access per site</b>, once, and can revoke it later.</p>
          </div>
          <div className="wl-step">
            <h3>The frame calls your model</h3>
            <p>Requests run with your keys <b>inside the vault</b> and stream back. The site receives text, never your keys.</p>
          </div>
        </div>
      </section>

      {/* Extension */}
      <section id="extension" className="wl-shell wl-section" style={{ paddingTop: 0 }}>
        <div className="wl-ext">
          <div className="wl-ext-head">
            <span className="wl-eyebrow">Browser extension</span>
            <h2 className="wl-h2">Go further with the <em>extension</em>.</h2>
            <p>
              Everything above works with no install. The optional extension adds local models and
              lifts CORS limits, and on <strong>Safari it is required</strong>.
            </p>
            <a className="wl-btn wl-btn-gold" href={GITHUB} target="_blank" rel="noopener noreferrer">
              Get the extension
            </a>
          </div>
          <div className="wl-ext-points">
            <div className="wl-ext-point">
              <h3>Local models</h3>
              <p>Run Ollama and LM Studio from any site, with no per-origin CORS setup.</p>
            </div>
            <div className="wl-ext-point">
              <h3>No CORS limits</h3>
              <p>Reach providers that don&rsquo;t send CORS headers, straight from the page.</p>
            </div>
            <div className="wl-ext-point wl-ext-safari">
              <h3>Required on Safari</h3>
              <p>
                Safari partitions storage, so the vault iframe can&rsquo;t hold your keys there.
                The extension injects <code>window.llm</code> directly instead.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Providers */}
      <section id="providers" className="wl-shell wl-section" style={{ paddingTop: 0 }}>
        <div className="wl-section-head">
          <span className="wl-eyebrow">Providers</span>
          <h2 className="wl-h2">Bring the model you already pay for.</h2>
        </div>
        <div className="wl-providers">
          {PROVIDERS.map((p) => (
            <span className="wl-chip" key={p.name}><ProviderLogo type={p.type} size={18} /><span>{p.name}</span></span>
          ))}
        </div>
        <p style={{ marginTop: '1.2rem', color: 'var(--wl-faint)', fontSize: '0.9rem', maxWidth: '52ch' }}>
          Browser-direct where the provider allows it. Local models (Ollama, LM Studio) run through the optional extension.
        </p>
      </section>

      {/* Developers */}
      <section id="developers" className="wl-shell wl-section" style={{ paddingTop: 0 }}>
        <div className="wl-devgrid">
          <div className="wl-section-head" style={{ marginBottom: 0 }}>
            <span className="wl-eyebrow">For developers</span>
            <h2 className="wl-h2">Two lines to give your users AI.</h2>
            <p>No API keys in your frontend. No backend proxy. Your users bring their own model through WindowLLM, and you just call the API.</p>
            <div className="wl-cta-row" style={{ marginTop: '1.4rem' }}>
              <a href="/docs/" className="wl-btn wl-btn-gold">Read the developer guide</a>
              <a href="/spec/" className="wl-btn wl-btn-ghost">Read the spec</a>
            </div>
          </div>
          <div className="wl-snippet">
            <div className="wl-snippet-head">your site</div>
            <pre dangerouslySetInnerHTML={{ __html: DEV_SNIPPET_HTML }} />
          </div>
        </div>
      </section>

      {/* Setup CTA — opens the vault at /vault */}
      <section id="setup" className="wl-setup">
        <div className="wl-shell wl-setup-inner">
          <div className="wl-section-head" style={{ marginBottom: 0 }}>
            <span className="wl-eyebrow">Get started</span>
            <h2 className="wl-h2">Set up your vault.</h2>
            <p>Create a passphrase to encrypt your keys, then add a provider. It takes a minute, and everything stays on your device.</p>
          </div>
          <div>
            <button
              type="button"
              onClick={onOpenVault}
              className="wl-btn wl-btn-gold"
              style={{ fontSize: '1.02rem', padding: '0.85rem 1.5rem' }}
            >
              Set up your vault
            </button>
            <p style={{ marginTop: '1rem', color: 'var(--wl-faint)', fontSize: '0.9rem' }}>
              Opens your vault at windowllm.org/vault. You can return here any time.
            </p>
          </div>
        </div>
      </section>

      <footer className="wl-shell wl-footer">
        <div className="wl-footer-row">
          <span>WindowLLM &middot; your AI, your rules</span>
          <span style={{ display: 'flex', gap: '1.4rem' }}>
            <a href="/docs/">Docs</a>
            <a href="/spec/">Spec</a>
            <a href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>
            <span style={{ color: 'var(--wl-faint)' }}>This page makes no third-party requests.</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
