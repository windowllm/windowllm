/**
 * Vault Frame Entry Point
 *
 * This is the iframe endpoint that handles postMessage communication.
 * It's loaded as a hidden iframe on client sites.
 */

import { initializeHandler } from './services/handler.js';

// Initialize the message handler immediately
// Storage access check happens inside the handler per-request
initializeHandler();

// Signal that the frame is ready (for debugging)
console.log('WindowLLM Vault Frame: Ready');

// Note: We don't broadcast frame_ready to parent via postMessage
// The client uses iframe.onload to detect when the frame is ready
// This avoids exposing vault presence to arbitrary origins
