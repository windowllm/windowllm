/**
 * WindowLLM landing surface (windowllm.org).
 *
 * Shown as the standalone page for first-time / locked visitors: explains what
 * WindowLLM is and how to use it WITHOUT the extension, then hands off to the
 * vault setup/unlock card (passed as `children`) in the #setup section.
 */

import type { ReactNode } from 'react';

const PROVIDERS = [
  { icon: '🧠', name: 'Anthropic' },
  { icon: '🤖', name: 'OpenAI' },
  { icon: '✨', name: 'Gemini' },
  { icon: '🦙', name: 'Ollama' },
  { icon: '🔀', name: 'OpenRouter' },
];

const GITHUB = 'https://github.com/windowllm/windowllm';

export function Landing({ children }: { children?: ReactNode }) {
  return (
    <div className="wl">
      <nav className="wl-shell wl-nav">
        <div className="wl-brand">
          <span className="wl-mark">W</span>
          WindowLLM
        </div>
        <div className="wl-nav-links">
          <a href="#how">How it works</a>
          <a href="#providers">Providers</a>
          <a href="#developers">Developers</a>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="#setup" className="wl-nav-cta wl-btn wl-btn-gold" style={{ padding: '0.5rem 1rem' }}>Set up</a>
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
            <a href="#setup" className="wl-btn wl-btn-gold">Set up your vault</a>
            <a href="#developers" className="wl-btn wl-btn-ghost">For developers</a>
          </div>
        </div>

        <div className="wl-window wl-rise" style={{ animationDelay: '0.3s' }} aria-hidden="true">
          <div className="wl-chrome">
            <div className="wl-dots"><i /><i /><i /></div>
            <div className="wl-addr">yoursite.com</div>
          </div>
          <pre className="wl-code"><span className="c">// any page, no keys of its own</span>{'\n'}
<span className="k">const</span> s = <span className="k">await</span> window.llm{'\n'}  .requestSession();{'\n'}
<span className="k">const</span> r = <span className="k">await</span> s.complete({'\n'}  <span className="s">"Draft a friendly reply"</span>{'\n'});
<span className="out"><span className="c">// streamed from your model</span>{'\n'}Of course. Here is a warm,<br />concise draft you can send<span className="wl-cursor" /></span></pre>
        </div>
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
            <h3>Nothing to install</h3>
            <p>It works through a sealed iframe and postMessage. The optional extension only adds local models and removes CORS limits.</p>
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

      {/* Providers */}
      <section id="providers" className="wl-shell wl-section" style={{ paddingTop: 0 }}>
        <div className="wl-section-head">
          <span className="wl-eyebrow">Providers</span>
          <h2 className="wl-h2">Bring the model you already pay for.</h2>
        </div>
        <div className="wl-providers">
          {PROVIDERS.map((p) => (
            <span className="wl-chip" key={p.name}><span>{p.icon}</span><span>{p.name}</span></span>
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
          </div>
          <div className="wl-snippet">
            <div className="wl-snippet-head">your site</div>
            <pre>{`<script src="https://windowllm.org/llm.js"></script>

const session = await window.llm.requestSession();
const reply = await session.complete(
  "Explain WindowLLM in one line."
);`}</pre>
          </div>
        </div>
      </section>

      {/* Setup — the vault card lives here */}
      <section id="setup" className="wl-setup">
        <div className="wl-shell wl-setup-inner">
          <div className="wl-section-head" style={{ marginBottom: 0 }}>
            <span className="wl-eyebrow">Get started</span>
            <h2 className="wl-h2">Set up your vault.</h2>
            <p>Create a passphrase to encrypt your keys, then add a provider. It takes a minute, and everything stays on your device.</p>
          </div>
          <div>{children}</div>
        </div>
      </section>

      <footer className="wl-shell wl-footer">
        <div className="wl-footer-row">
          <span>WindowLLM &middot; your AI, your rules</span>
          <span style={{ display: 'flex', gap: '1.4rem' }}>
            <a href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="#how">How it works</a>
            <span style={{ color: 'var(--wl-faint)' }}>This page makes no third-party requests.</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
