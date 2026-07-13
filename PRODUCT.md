# Product

## Register

product

## Users

People who want to use their own AI providers across websites, including developers integrating `window.llm` and browser users configuring providers, permissions, encryption, and local-model access. They need to understand what is configured, what each site can access, and whether their keys remain protected.

## Product Purpose

WindowLLM gives users a provider-agnostic browser LLM API while keeping API keys and consent under the user's control. The Vault is the configuration and trust surface: it should make provider setup, encryption, site permissions, portability, and operational status clear without exposing the implementation complexity behind the web and extension runtimes.

## Brand Personality

Sovereign, precise, warm. The interface should feel technically credible and calm, with confidence coming from clear states and familiar controls rather than decoration.

## Anti-references

Avoid generic AI-SaaS styling, purple-to-blue gradients, neon-on-black, decorative glassmorphism, walls of identical cards, novelty controls, and external assets that undermine the product's self-contained privacy story. Do not let the web and extension Vaults drift into visibly different products.

## Design Principles

1. One Vault, regardless of runtime. Web and extension surfaces should share the same concepts, copy, components, and interaction patterns.
2. Make trust inspectable. Clearly communicate where keys live, when the Vault is locked, which providers are active, and which sites have access.
3. Keep the user's task primary. Use familiar product controls and responsive layouts so setup and maintenance remain quick at both popup and full-page sizes.
4. Practice sovereignty in the interface. Keep the UI self-contained, dependency-light, and free of third-party asset requests.
5. Prefer shared behavior over parallel implementations. Platform-specific code should be limited to storage, messaging, and browser integration boundaries.

## Accessibility & Inclusion

No formal WCAG conformance target is currently documented. Preserve semantic controls, keyboard operation, visible focus, readable contrast, reduced-motion preferences, and status communication that does not rely on color alone across both web and extension layouts.
