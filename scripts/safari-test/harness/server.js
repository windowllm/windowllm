/**
 * Safari Test Harness Server
 *
 * Runs inside the macOS VM and provides an HTTP API for:
 * - VM setup (Safari config, extension install, login items)
 * - Running Safari tests via AppleScript
 * - Managing extension storage
 * - Reporting test results
 *
 * This is the sole control plane for the VM - no SSH required.
 */

const http = require('http');
const { exec, execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RESULTS_FILE = '/tmp/safari-test-results.json';
const PORT = process.env.PORT || 3200;
const SCRIPT_DIR = __dirname;
const HOME_DIR = os.homedir();

/**
 * Execute AppleScript and return result
 */
function runAppleScript(scriptPath, args = []) {
    return new Promise((resolve, reject) => {
        const quotedArgs = args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ');
        const cmd = `osascript "${scriptPath}" ${quotedArgs}`;

        exec(cmd, { timeout: 180000 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(stderr || err.message));
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

/**
 * Execute inline AppleScript code
 */
function runAppleScriptCode(code) {
    return new Promise((resolve, reject) => {
        const cmd = `osascript -e '${code.replace(/'/g, "'\"'\"'")}'`;

        exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(stderr || err.message));
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

/**
 * Wait for a file to exist with timeout
 */
function waitForFile(filePath, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const check = () => {
            if (fs.existsSync(filePath)) {
                resolve(fs.readFileSync(filePath, 'utf8'));
            } else if (Date.now() - startTime > timeoutMs) {
                reject(new Error(`Timeout waiting for ${filePath}`));
            } else {
                setTimeout(check, 1000);
            }
        };
        check();
    });
}

/**
 * Parse request body as JSON
 */
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * Parse raw request body (for file uploads)
 */
function parseRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

/**
 * Execute shell command and return result
 */
function execCommand(cmd, options = {}) {
    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 60000, ...options }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(stderr || err.message));
            } else {
                resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
            }
        });
    });
}

/**
 * Copy directory recursively
 */
function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * HTTP Server
 */
const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    try {
        // Health check
        if (req.method === 'GET' && req.url === '/health') {
            res.end(JSON.stringify({ status: 'ok', pid: process.pid }));
            return;
        }

        // ========================================
        // SETUP ENDPOINTS (for VM configuration)
        // ========================================

        // Configure Safari settings via defaults
        if (req.method === 'POST' && req.url === '/setup/safari') {
            try {
                // Enable Safari Developer menu
                await execCommand('defaults write com.apple.Safari IncludeDevelopMenu -bool true');
                await execCommand('defaults write com.apple.Safari WebKitDeveloperExtrasEnabledPreferenceKey -bool true');
                await execCommand('defaults write com.apple.Safari "WebKitPreferences.developerExtrasEnabled" -bool true');

                // Allow unsigned extensions
                await execCommand('defaults write com.apple.Safari DeveloperAllowUnsignedExtensions -bool true');

                // Disable first-run dialogs
                await execCommand('defaults write com.apple.Safari SuppressSearchSuggestions -bool true');
                await execCommand('defaults write com.apple.Safari UniversalSearchEnabled -bool false');

                // Launch Safari once to initialize, then quit
                await execCommand('open -a Safari');
                await new Promise(r => setTimeout(r, 5000));
                await runAppleScriptCode('tell application "Safari" to quit');
                await new Promise(r => setTimeout(r, 2000));

                res.end(JSON.stringify({ success: true, message: 'Safari configured' }));
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // Install extension from shared directory path
        if (req.method === 'POST' && req.url === '/setup/extension') {
            const { appPath, enableExtension } = await parseBody(req);

            if (!appPath) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'appPath is required' }));
                return;
            }

            try {
                // Copy extension app to home directory if it's from shared folder
                const destPath = path.join(HOME_DIR, 'WindowLLM.app');
                if (appPath !== destPath) {
                    if (fs.existsSync(destPath)) {
                        await execCommand(`rm -rf "${destPath}"`);
                    }
                    copyDir(appPath, destPath);
                }

                // Launch the extension app to register with Safari
                await execCommand(`open "${destPath}"`);
                await new Promise(r => setTimeout(r, 5000));

                // Launch Safari to detect extension
                await execCommand('open -a Safari');
                await new Promise(r => setTimeout(r, 3000));

                // Enable extension via AppleScript if requested
                if (enableExtension !== false) {
                    const enableScript = path.join(SCRIPT_DIR, 'enable-extension.applescript');
                    if (fs.existsSync(enableScript)) {
                        try {
                            await runAppleScript(enableScript);
                        } catch (e) {
                            console.log('Extension enable script note:', e.message);
                        }
                    }
                }

                // Quit Safari
                await runAppleScriptCode('tell application "Safari" to quit');
                await new Promise(r => setTimeout(r, 2000));

                res.end(JSON.stringify({ success: true, message: 'Extension installed' }));
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // Add harness to login items (self-bootstrapping)
        if (req.method === 'POST' && req.url === '/setup/login-item') {
            try {
                // Create LaunchAgent plist
                const launchAgentsDir = path.join(HOME_DIR, 'Library', 'LaunchAgents');
                fs.mkdirSync(launchAgentsDir, { recursive: true });

                const plistPath = path.join(launchAgentsDir, 'org.windowllm.safari-test-harness.plist');
                const harnessPath = path.join(HOME_DIR, 'safari-test-harness');

                const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>org.windowllm.safari-test-harness</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>${harnessPath}/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${harnessPath}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/safari-harness.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/safari-harness.err</string>
</dict>
</plist>`;

                fs.writeFileSync(plistPath, plistContent);

                // Load the LaunchAgent
                await execCommand(`launchctl load "${plistPath}"`).catch(() => {});

                res.end(JSON.stringify({ success: true, message: 'Harness added to login items', plistPath }));
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // Copy harness to home directory and set up
        if (req.method === 'POST' && req.url === '/setup/harness') {
            const { sourcePath } = await parseBody(req);

            if (!sourcePath) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'sourcePath is required' }));
                return;
            }

            try {
                const destPath = path.join(HOME_DIR, 'safari-test-harness');
                if (fs.existsSync(destPath)) {
                    await execCommand(`rm -rf "${destPath}"`);
                }
                copyDir(sourcePath, destPath);

                res.end(JSON.stringify({ success: true, message: 'Harness installed', path: destPath }));
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // Copy enable-extension script
        if (req.method === 'POST' && req.url === '/setup/enable-script') {
            const { sourcePath } = await parseBody(req);

            if (!sourcePath) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'sourcePath is required' }));
                return;
            }

            try {
                const destPath = path.join(HOME_DIR, 'safari-test-harness', 'enable-extension.applescript');
                fs.copyFileSync(sourcePath, destPath);

                res.end(JSON.stringify({ success: true, message: 'Enable script installed', path: destPath }));
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // Execute arbitrary shell command (for flexibility)
        if (req.method === 'POST' && req.url === '/exec') {
            const { command, timeout } = await parseBody(req);

            if (!command) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'command is required' }));
                return;
            }

            try {
                const result = await execCommand(command, { timeout: timeout || 60000 });
                res.end(JSON.stringify({ success: true, ...result }));
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // ========================================
        // TEST ENDPOINTS
        // ========================================

        // Run tests
        if (req.method === 'POST' && req.url === '/run-tests') {
            const { testUrl } = await parseBody(req);

            if (!testUrl) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'testUrl is required' }));
                return;
            }

            // Clear previous results
            try {
                fs.unlinkSync(RESULTS_FILE);
            } catch {}

            // Run Safari test script
            const testScript = path.join(SCRIPT_DIR, 'safari-test.applescript');
            try {
                await runAppleScript(testScript, [testUrl]);
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({
                    error: 'AppleScript execution failed',
                    details: err.message
                }));
                return;
            }

            // Wait for results file
            try {
                const results = await waitForFile(RESULTS_FILE, 120000);
                res.end(results);
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({
                    error: 'Timeout waiting for test results',
                    details: err.message
                }));
            }
            return;
        }

        // Run specific test suite
        if (req.method === 'POST' && req.url === '/run-suite') {
            const { suite, testUrl } = await parseBody(req);

            // Run tests from our test directory
            const testRunner = path.join(SCRIPT_DIR, '..', 'tests', 'runner.js');
            if (fs.existsSync(testRunner)) {
                try {
                    const { runAllTests } = require(testRunner);
                    const results = await runAllTests({
                        testUrl: testUrl || 'https://test.localhost:3101',
                        suite
                    });
                    res.end(JSON.stringify(results));
                } catch (err) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: err.message }));
                }
            } else {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'Test runner not found' }));
            }
            return;
        }

        // Execute JavaScript in Safari
        if (req.method === 'POST' && req.url === '/execute-js') {
            const { code } = await parseBody(req);

            if (!code) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'code is required' }));
                return;
            }

            try {
                const result = await runAppleScriptCode(
                    `tell application "Safari" to do JavaScript "${code.replace(/"/g, '\\"')}" in document 1`
                );
                res.end(JSON.stringify({ result }));
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // Run arbitrary AppleScript IN THE GUI (Aqua) session. The harness is a
        // LaunchAgent in the logged-in session, so this can drive Safari and
        // System Events UI scripting — which `tart exec` cannot (it runs outside
        // the session and every GUI AppleEvent times out with -1712).
        if (req.method === 'POST' && req.url === '/run-osascript') {
            const { script } = await parseBody(req);
            if (!script) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'script is required' }));
                return;
            }
            const tmp = path.join(os.tmpdir(), `wllm-osa-${Date.now()}.applescript`);
            try {
                fs.writeFileSync(tmp, script);
                const result = await runAppleScript(tmp);
                res.end(JSON.stringify({ result }));
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            } finally {
                try { fs.unlinkSync(tmp); } catch {}
            }
            return;
        }

        // Navigate Safari to URL
        if (req.method === 'POST' && req.url === '/navigate') {
            const { url } = await parseBody(req);

            if (!url) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'url is required' }));
                return;
            }

            try {
                await runAppleScriptCode(
                    `tell application "Safari" to set URL of document 1 to "${url}"`
                );
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // Click extension icon
        if (req.method === 'POST' && req.url === '/click-extension') {
            const actionsScript = path.join(SCRIPT_DIR, 'safari-actions.applescript');
            try {
                await runAppleScript(actionsScript);
                // Call specific handler
                await runAppleScriptCode(`
                    set actionsLib to load script "${actionsScript}"
                    tell actionsLib to clickExtensionIcon()
                `);
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // Grant consent in popup
        if (req.method === 'POST' && req.url === '/grant-consent') {
            const actionsScript = path.join(SCRIPT_DIR, 'safari-actions.applescript');
            try {
                await runAppleScriptCode(`
                    set actionsLib to load script "${actionsScript}"
                    tell actionsLib to grantConsentInPopup()
                `);
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // Enter passphrase in unlock popup
        if (req.method === 'POST' && req.url === '/unlock') {
            const { passphrase } = await parseBody(req);
            const actionsScript = path.join(SCRIPT_DIR, 'safari-actions.applescript');
            try {
                await runAppleScriptCode(`
                    set actionsLib to load script "${actionsScript}"
                    tell actionsLib to enterPassphraseInPopup("${passphrase}")
                `);
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // Setup vault configuration (write to extension storage)
        if (req.method === 'POST' && req.url === '/setup-vault') {
            const config = await parseBody(req);

            // Store config for use by tests
            fs.writeFileSync('/tmp/vault-config.json', JSON.stringify(config));
            res.end(JSON.stringify({ success: true }));
            return;
        }

        // 404 for unknown routes
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));

    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
});

server.listen(PORT, () => {
    console.log(`Safari test harness listening on port ${PORT}`);
    console.log(`Process ID: ${process.pid}`);
});

// Handle shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down harness server...');
    server.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Interrupted, shutting down...');
    server.close();
    process.exit(0);
});
