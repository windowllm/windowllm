# WindowLLM TODO

## Completed

### API Key Encryption/Decryption Mismatch (FIXED)
- **Status**: ✅ Resolved
- **Symptom**: `invalid x-api-key` error when making API calls
- **Root Cause**: SimpleObfuscation class wasn't properly storing/retrieving the obfuscation key
- **Solution**:
  - Refactored SimpleObfuscation to take StorageAdapter in constructor
  - Key is cached in memory after first retrieval
  - Both popup (storage.ts) and background (background.ts) now use identical obfuscation logic

### Safari vs Chrome Extension Differences
- [ ] Safari MV3 service workers are buggy - using event pages (`"scripts"`) instead of `"service_worker"`
- [ ] Safari may cache extension popup JS/HTML aggressively
- [ ] Safari console may not show all logs or may require specific inspection method
- [ ] Test Chrome extension to verify it works correctly (baseline)

### Popup Console Access in Safari
- Right-click popup → Inspect Element → Console
- Or: Develop → Web Extension Popups → WindowLLM (if available)
- Safari may require developer mode enabled

## General Extension Issues

### Chrome Non-Extension Mode
- **Symptom**: `Session not found or expired` error
- **Context**: Uses vault iframe instead of extension background script
- **Status**: Not yet investigated

## Completed
- [x] Fixed double-encryption bug in `saveProvider()` (storage.ts)
- [x] Changed Safari manifest from `service_worker` to event pages
- [x] Added `waitForReady()` to inject.ts
- [x] Fixed completion response structure (return `result.message` directly)
- [x] Inlined inject.js into content.js for synchronous execution
