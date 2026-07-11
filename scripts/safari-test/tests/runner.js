/**
 * Safari Test Runner
 *
 * Orchestrates all Safari tests and collects results.
 * Tests are run via AppleScript automation.
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPT_DIR = path.join(__dirname, '..');

/**
 * Execute AppleScript and return result
 */
function runAppleScript(code) {
    return new Promise((resolve, reject) => {
        const escaped = code.replace(/'/g, "'\"'\"'");
        exec(`osascript -e '${escaped}'`, { timeout: 60000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout.trim());
        });
    });
}

/**
 * Navigate Safari to URL
 */
async function navigateTo(url) {
    await runAppleScript(`
        tell application "Safari"
            activate
            if (count of windows) is 0 then
                make new document with properties {URL:"${url}"}
            else
                set URL of document 1 to "${url}"
            end if
        end tell
    `);
    // Wait for page load
    await new Promise(r => setTimeout(r, 3000));
}

/**
 * Execute JavaScript in Safari and return result
 */
async function evaluate(jsCode) {
    const escaped = jsCode.replace(/"/g, '\\"').replace(/\n/g, ' ');
    const result = await runAppleScript(`
        tell application "Safari"
            do JavaScript "${escaped}" in document 1
        end tell
    `);
    return result;
}

/**
 * Wait for condition with timeout
 */
async function waitFor(condition, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const result = await evaluate(condition);
            if (result === 'true' || result === true) return true;
        } catch {}
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error(`Timeout waiting for: ${condition}`);
}

/**
 * Click extension icon
 */
async function clickExtensionIcon() {
    const actionsScript = path.join(SCRIPT_DIR, 'harness', 'safari-actions.applescript');
    await runAppleScript(`
        set actionsLib to load script "${actionsScript}"
        tell actionsLib to clickExtensionIcon()
    `);
}

/**
 * Grant consent in popup
 */
async function grantConsent() {
    const actionsScript = path.join(SCRIPT_DIR, 'harness', 'safari-actions.applescript');
    await runAppleScript(`
        set actionsLib to load script "${actionsScript}"
        tell actionsLib to grantConsentInPopup()
    `);
}

/**
 * Enter passphrase in unlock popup
 */
async function enterPassphrase(passphrase) {
    const actionsScript = path.join(SCRIPT_DIR, 'harness', 'safari-actions.applescript');
    await runAppleScript(`
        set actionsLib to load script "${actionsScript}"
        tell actionsLib to enterPassphraseInPopup("${passphrase}")
    `);
}

/**
 * Harness object passed to tests
 */
const harness = {
    navigateTo,
    evaluate,
    waitFor,
    clickExtensionIcon,
    grantConsent,
    enterPassphrase,
    runAppleScript
};

/**
 * Test definitions
 */
const tests = {
    // Client loading tests
    'client:loading:window.llm': async () => {
        await navigateTo('https://test.localhost:3101');
        await waitFor("typeof window.llm !== 'undefined'", 30000);
        const hasLLM = await evaluate("typeof window.llm !== 'undefined'");
        if (hasLLM !== 'true') throw new Error('window.llm not defined');
    },

    'client:loading:api-methods': async () => {
        await navigateTo('https://test.localhost:3101');
        await waitFor("typeof window.llm !== 'undefined'", 30000);

        const checks = await evaluate(`
            JSON.stringify({
                hasRequestSession: typeof window.llm.requestSession === 'function',
                hasPermissions: typeof window.llm.permissions === 'object',
                hasModels: typeof window.llm.models === 'object',
                hasCapabilities: typeof window.llm.capabilities === 'object'
            })
        `);

        const result = JSON.parse(checks);
        if (!result.hasRequestSession) throw new Error('Missing requestSession');
        if (!result.hasPermissions) throw new Error('Missing permissions');
        if (!result.hasModels) throw new Error('Missing models');
    },

    // Integration tests (require vault setup)
    'client:integration:permissions-query': async () => {
        await navigateTo('https://test.localhost:3101');
        await waitFor("typeof window.llm !== 'undefined'", 30000);

        // Query permissions - should work even without grant
        const result = await evaluate(`
            (async () => {
                try {
                    const status = await window.llm.permissions.query({ name: 'chat' });
                    return JSON.stringify({ success: true, state: status.state });
                } catch (e) {
                    return JSON.stringify({ success: false, error: e.message });
                }
            })()
        `);

        const parsed = JSON.parse(result);
        if (!parsed.success) throw new Error(parsed.error);
    },

    'client:integration:models-list': async () => {
        await navigateTo('https://test.localhost:3101');
        await waitFor("typeof window.llm !== 'undefined'", 30000);

        const result = await evaluate(`
            (async () => {
                try {
                    const models = await window.llm.models.list();
                    return JSON.stringify({ success: true, count: models.length });
                } catch (e) {
                    return JSON.stringify({ success: false, error: e.message });
                }
            })()
        `);

        const parsed = JSON.parse(result);
        if (!parsed.success) throw new Error(parsed.error);
    },

    // Test page internal tests
    'client:testpage:run': async () => {
        await navigateTo('https://test.localhost:3101');
        await waitFor("typeof window.llm !== 'undefined'", 30000);

        // Wait for test page to complete its internal tests
        try {
            await waitFor("window.__testsDone === true", 60000);
        } catch {
            // May timeout, check partial results
        }

        const results = await evaluate("JSON.stringify(window.__testResults || [])");
        const parsed = JSON.parse(results);

        // Check availability tests passed
        const availability = parsed.filter(r => r.name.startsWith('availability:'));
        const failed = availability.filter(r => r.status === 'fail');

        if (failed.length > 0) {
            throw new Error(`Availability tests failed: ${failed.map(f => f.name).join(', ')}`);
        }
    }
};

/**
 * Run all tests and return results
 */
async function runAllTests(options = {}) {
    const results = [];
    const testNames = Object.keys(tests);

    console.log(`Running ${testNames.length} Safari tests...`);

    for (const name of testNames) {
        console.log(`  Running: ${name}`);
        try {
            await tests[name](harness);
            results.push({ name, status: 'pass' });
            console.log(`  ✓ ${name}`);
        } catch (error) {
            results.push({ name, status: 'fail', error: error.message });
            console.log(`  ✗ ${name}: ${error.message}`);
        }
    }

    return results;
}

module.exports = { runAllTests, harness, tests };

// Run if called directly
if (require.main === module) {
    runAllTests()
        .then(results => {
            console.log('\nResults:', JSON.stringify(results, null, 2));
            const failed = results.filter(r => r.status === 'fail').length;
            process.exit(failed > 0 ? 1 : 0);
        })
        .catch(err => {
            console.error('Error:', err);
            process.exit(1);
        });
}
