/**
 * WindowLLM Extension - Content Script
 *
 * Runs in the ISOLATED world. Responsibilities:
 * 1. Bridge messages between inject.js (MAIN world) and background.js
 *
 * Note: inject.js is loaded directly into MAIN world via manifest.json
 * using "world": "MAIN" for Chrome, with fallback injection for Firefox/Safari.
 */

// Firefox/Safari expose a `browser` global; it isn't in @types/chrome.
declare const browser: unknown;

// Fallback injection for browsers that don't support "world": "MAIN"
// Chrome 102+ supports it via manifest, Firefox and Safari need manual injection
// Note: Chrome UA includes "Safari", so we must explicitly exclude Chrome
const isChrome = navigator.userAgent.includes('Chrome');
const isFirefox = typeof browser !== 'undefined';
const isSafari = navigator.userAgent.includes('Safari') && !isChrome;

if (isFirefox || isSafari) {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

// Listen for requests from inject.js (MAIN world)
window.addEventListener('windowllm:request', (async (event: CustomEvent) => {
  const { id, type, payload } = event.detail;

  try {
    let response;

    // Handle local requests that don't need background script
    if (type === 'get_popup_url') {
      // Content script can provide extension URL directly
      const origin = (payload as { origin: string }).origin;
      const encodedOrigin = encodeURIComponent(origin);
      response = { url: chrome.runtime.getURL(`popup.html?consent=true&origin=${encodedOrigin}`) };
    } else if (type === 'get_unlock_url') {
      // Return extension popup URL for vault unlock
      response = { url: chrome.runtime.getURL('popup.html?unlock=true') };
    } else if (type === 'open_popup') {
      // Forward to background script to open the extension popup
      response = await chrome.runtime.sendMessage({
        type: 'open_popup',
        payload,
      });
    } else {
      // Forward to background script
      response = await chrome.runtime.sendMessage({
        type,
        payload,
      });
    }

    // Send response back to inject.js
    window.dispatchEvent(new CustomEvent('windowllm:response', {
      detail: { id, success: true, data: response }
    }));
  } catch (error) {
    console.error('[WindowLLM Content] Background error:', error);
    // Send error back to inject.js
    window.dispatchEvent(new CustomEvent('windowllm:response', {
      detail: {
        id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }));
  }
}) as unknown as EventListener);

// Handle messages from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'stream_chunk') {
    // Forward stream chunk to inject.js
    window.dispatchEvent(new CustomEvent('windowllm:stream', {
      detail: {
        sessionId: message.sessionId,
        chunk: message.chunk,
      }
    }));
  } else if (message.type === 'popup_result') {
    // Forward popup result to inject.js
    window.dispatchEvent(new CustomEvent('windowllm:popup_result', {
      detail: {
        mode: message.mode,
        result: message.result,
        origin: message.origin,
      }
    }));
  }
  return false;
});
