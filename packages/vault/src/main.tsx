/**
 * @windowllm/vault
 *
 * Vault application entry point
 */

import { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { Settings, Shield, Key, Plus, ExternalLink, Check, X, Loader2, AlertTriangle, LogOut, Download, Upload } from 'lucide-react';

import './globals.css';

import { getVaultEncryption, getVaultStorage, type StoredProviderConfig, type SitePermission, type VaultSettings } from './services/storage.js';
import { getHandler, initializeHandler } from './services/handler.js';
import { getVaultAPI, type VaultAPI } from './services/api.js';

// Expose VaultAPI globally for testing
declare global {
  interface Window {
    vaultAPI?: VaultAPI;
  }
}

// In dev/test mode, expose VaultAPI on window for E2E testing
if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
  window.vaultAPI = getVaultAPI();
}

import { Button } from './components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Badge } from './components/ui/badge';
import { Switch } from './components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
import { Landing } from './Landing';
import { ProviderLogo } from './ProviderLogo';
import { exportConfig, decryptConfig, applyConfig, type ImportMode } from './services/config-transfer';


// Check if we're in iframe mode
const isIframe = window.self !== window.top;

type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'openrouter' | 'gemini' | 'custom';

// browserDirect: works from the vault (iframe) with no extension. Verified live
// 2026-07 — OpenAI/Gemini are now browser-callable; only local (Ollama) and
// arbitrary custom endpoints still depend on the extension / server CORS config.
const PROVIDER_INFO: Record<ProviderType, { name: string; description: string; browserDirect: boolean }> = {
  openai: { name: 'OpenAI', description: 'GPT models', browserDirect: true },
  anthropic: { name: 'Anthropic', description: 'Claude models', browserDirect: true },
  gemini: { name: 'Google Gemini', description: 'Gemini models', browserDirect: true },
  ollama: { name: 'Ollama', description: 'Local models', browserDirect: false },
  openrouter: { name: 'OpenRouter', description: 'Multi-provider gateway', browserDirect: true },
  custom: { name: 'Custom', description: 'OpenAI-compatible API', browserDirect: false },
};

function App({ onExit }: { onExit?: () => void }) {
  const [providers, setProviders] = useState<StoredProviderConfig[]>([]);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const api = getVaultAPI();

  const loadProviders = useCallback(async () => {
    const loaded = await api.providers.list();
    setProviders(loaded);
  }, [api]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const handleAddProvider = useCallback(async (config: Omit<StoredProviderConfig, 'id' | 'createdAt' | 'updatedAt'>) => {
    await api.providers.create(config);
    await loadProviders();
    setShowAddProvider(false);
    getHandler()?.refreshAdapters();
  }, [api, loadProviders]);

  const handleUpdateProvider = useCallback(async (provider: StoredProviderConfig) => {
    await api.providers.update(provider.id, provider);
    await loadProviders();
    getHandler()?.refreshAdapters();
  }, [api, loadProviders]);

  const handleDeleteProvider = useCallback(async (id: string) => {
    if (confirm('Are you sure you want to delete this provider?')) {
      await api.providers.delete(id);
      await loadProviders();
      getHandler()?.refreshAdapters();
    }
  }, [api, loadProviders]);

  const handleTestProvider = useCallback(async (id: string): Promise<boolean> => {
    return api.providers.test(id);
  }, [api]);

  const isConfigured = providers.some(p => p.enabled);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-amber-600 rounded-lg flex items-center justify-center font-bold text-xl text-neutral-900">
                W
              </div>
              <div>
                <h1 className="text-xl font-bold">WindowLLM</h1>
                <p className="text-sm text-muted-foreground">Your AI, Your Rules</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Badge variant={isConfigured ? 'success' : 'secondary'}>
                {isConfigured ? 'Ready' : 'Setup Required'}
              </Badge>
              {onExit && (
                <Button variant="ghost" size="sm" onClick={onExit} title="Lock and return to home" className="gap-1.5">
                  <LogOut className="h-4 w-4" />
                  Exit
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-4xl mx-auto px-6 py-8">
        <Tabs defaultValue="providers" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="providers" className="gap-2">
              <Key className="h-4 w-4" />
              Providers
            </TabsTrigger>
            <TabsTrigger value="permissions" className="gap-2">
              <Shield className="h-4 w-4" />
              Permissions
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2">
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="providers" className="space-y-6">
            {!isConfigured && (
              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardHeader>
                  <CardTitle className="text-amber-400">Welcome to WindowLLM!</CardTitle>
                  <CardDescription>
                    Add a provider below to start using AI on any website. Your API keys are stored
                    locally in your browser and never leave your device. Set a passphrase to encrypt
                    them at rest with AES-256.
                  </CardDescription>
                </CardHeader>
              </Card>
            )}

            {/* Provider list */}
            <div className="space-y-4">
              {providers.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onUpdate={handleUpdateProvider}
                  onDelete={handleDeleteProvider}
                  onTest={handleTestProvider}
                />
              ))}
            </div>

            {/* Add provider */}
            {showAddProvider ? (
              <AddProviderCard
                onAdd={handleAddProvider}
                onCancel={() => setShowAddProvider(false)}
              />
            ) : (
              <Button
                variant="outline"
                className="w-full h-24 border-dashed"
                onClick={() => setShowAddProvider(true)}
              >
                <Plus className="mr-2 h-5 w-5" />
                Add Provider
              </Button>
            )}
          </TabsContent>

          <TabsContent value="permissions">
            <PermissionsTab />
          </TabsContent>

          <TabsContent value="settings">
            <SettingsTab />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t mt-auto">
        <div className="container max-w-4xl mx-auto px-6 py-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>WindowLLM v1.0.0</span>
          <a
            href="https://github.com/windowllm/windowllm"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </footer>
    </div>
  );
}

interface ProviderCardProps {
  provider: StoredProviderConfig;
  onUpdate: (provider: StoredProviderConfig) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => Promise<boolean>;
}

function ProviderCard({ provider, onUpdate, onDelete, onTest }: ProviderCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [editedApiKey, setEditedApiKey] = useState(provider.apiKey || '');
  const [editedBaseUrl, setEditedBaseUrl] = useState(provider.baseUrl || '');
  const [editedDefaultModel, setEditedDefaultModel] = useState(provider.defaultModel || '');

  const info = PROVIDER_INFO[provider.type as ProviderType] || PROVIDER_INFO.custom;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTest(provider.id);
      setTestResult(result);
    } catch {
      setTestResult(false);
    }
    setTesting(false);
  };

  const handleSave = () => {
    onUpdate({
      ...provider,
      apiKey: editedApiKey,
      baseUrl: editedBaseUrl || undefined,
      defaultModel: editedDefaultModel || undefined,
    });
    setExpanded(false);
  };

  return (
    <Card className={provider.enabled ? 'border-green-500/30' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ProviderLogo type={provider.type} size={28} />
            <div>
              <CardTitle className="text-lg">{provider.name}</CardTitle>
              <CardDescription>{info.description}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={provider.enabled ? 'success' : 'secondary'}>
              {provider.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Close' : 'Configure'}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 border-t pt-4">
          {provider.type === 'ollama' && (
            <div className="flex gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-yellow-500">Local provider</p>
                <p className="text-muted-foreground mt-1">
                  Ollama runs on your machine. In iframe mode the vault can only reach it if you set
                  <code className="mx-1">OLLAMA_ORIGINS</code>; otherwise install the browser extension.
                </p>
              </div>
            </div>
          )}

          {provider.type !== 'ollama' && (
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                type="password"
                value={editedApiKey}
                onChange={(e) => setEditedApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="base-url">
              Base URL {provider.type === 'ollama' ? '(default: http://localhost:11434)' : '(optional)'}
            </Label>
            <Input
              id="base-url"
              value={editedBaseUrl}
              onChange={(e) => setEditedBaseUrl(e.target.value)}
              placeholder={provider.type === 'ollama' ? 'http://localhost:11434' : 'Leave empty for default'}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="default-model">Default Model (optional)</Label>
            <Input
              id="default-model"
              value={editedDefaultModel}
              onChange={(e) => setEditedDefaultModel(e.target.value)}
              placeholder="e.g., gpt-4o-mini, claude-3-haiku, llama3.2"
            />
          </div>

          <CardFooter className="flex items-center justify-between p-0 pt-4">
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={handleTest} disabled={testing}>
                {testing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test Connection'
                )}
              </Button>
              {testResult !== null && (
                <span className={testResult ? 'text-green-400' : 'text-destructive'}>
                  {testResult ? <Check className="h-5 w-5" /> : <X className="h-5 w-5" />}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 mr-4">
                <Switch
                  checked={provider.enabled}
                  onCheckedChange={(checked) => onUpdate({ ...provider, enabled: checked })}
                />
                <Label className="text-sm">Enabled</Label>
              </div>
              <Button variant="destructive" size="sm" onClick={() => onDelete(provider.id)}>
                Delete
              </Button>
              <Button onClick={handleSave}>Save</Button>
            </div>
          </CardFooter>
        </CardContent>
      )}
    </Card>
  );
}

interface AddProviderCardProps {
  onAdd: (config: Omit<StoredProviderConfig, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
}

function AddProviderCard({ onAdd, onCancel }: AddProviderCardProps) {
  const [type, setType] = useState<ProviderType>('openai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  const info = PROVIDER_INFO[type];

  const handleSubmit = () => {
    onAdd({
      type,
      name: info.name,
      apiKey: type !== 'ollama' ? apiKey : undefined,
      baseUrl: baseUrl || undefined,
      enabled: true,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Provider</CardTitle>
        <CardDescription>Connect to an AI provider</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-5 gap-2">
          {(Object.keys(PROVIDER_INFO) as ProviderType[]).map((key) => (
            <Button
              key={key}
              variant={type === key ? 'default' : 'outline'}
              className="flex-col h-20 gap-1"
              onClick={() => setType(key)}
            >
              <ProviderLogo type={key} size={24} />
              <span className="text-xs">{PROVIDER_INFO[key].name}</span>
            </Button>
          ))}
        </div>

        {info.browserDirect ? (
          <div className="flex gap-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <Check className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-emerald-500">Works without the extension</p>
              <p className="text-muted-foreground mt-1">
                {info.name} supports browser-direct calls, so it runs from the vault with no
                extension needed. The extension is still optional for extra capabilities.
              </p>
            </div>
          </div>
        ) : type === 'ollama' ? (
          <div className="flex gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
            <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-yellow-500">Local provider</p>
              <p className="text-muted-foreground mt-1">
                Ollama runs on your machine. In iframe mode the vault can only reach it if you set
                <code className="mx-1">OLLAMA_ORIGINS</code>, or with the browser extension installed.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex gap-3 p-4 rounded-lg bg-muted/40 border">
            <AlertTriangle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground">
              Custom endpoints work from the browser only if your server sends the right CORS
              headers. If it does not, use the browser extension.
            </div>
          </div>
        )}

        {type !== 'ollama' && (
          <div className="space-y-2">
            <Label htmlFor="new-api-key">API Key</Label>
            <Input
              id="new-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="new-base-url">Base URL (optional)</Label>
          <Input
            id="new-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={type === 'ollama' ? 'http://localhost:11434' : 'Leave empty for default'}
          />
        </div>
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleSubmit}>Add Provider</Button>
      </CardFooter>
    </Card>
  );
}

function PermissionsTab() {
  const [permissions, setPermissions] = useState<SitePermission[]>([]);
  const api = getVaultAPI();

  const loadPermissions = useCallback(async () => {
    const loaded = await api.permissions.list();
    setPermissions(loaded);
  }, [api]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  const handleRevoke = async (origin: string) => {
    if (confirm(`Revoke permissions for ${origin}?`)) {
      await api.permissions.revoke(origin);
      // Terminate any live sessions for this origin so a site can't keep
      // completing requests against a permission the user just revoked.
      getHandler()?.invalidateSessionsForOrigin(origin);
      await loadPermissions();
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Site Permissions</CardTitle>
          <CardDescription>
            Manage which websites can access your AI providers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {permissions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No sites have been granted permissions yet.</p>
              <p className="text-sm mt-1">
                When you use WindowLLM on a website, you'll be asked to grant permission.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {permissions.map((p) => (
                <div
                  key={p.origin}
                  className="flex items-center justify-between p-4 rounded-lg border"
                >
                  <div>
                    <h3 className="font-medium">{p.origin}</h3>
                    <p className="text-sm text-muted-foreground">
                      {p.capabilities.join(', ')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Granted: {new Date(p.grantedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRevoke(p.origin)}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsTab() {
  const [settings, setSettings] = useState<VaultSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const api = getVaultAPI();

  useEffect(() => {
    api.settings.get().then(setSettings);
  }, [api]);

  const handleSave = async () => {
    if (!settings) return;
    await api.settings.update(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Backup & transfer (encrypted export / import)
  const [exportPw, setExportPw] = useState('');
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPw, setImportPw] = useState('');
  const [importMode, setImportMode] = useState<ImportMode>('additive');
  const [importMsg, setImportMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setExportMsg(null);
    try {
      const blob = await exportConfig(exportPw);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `windowllm-vault-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportMsg('Downloaded. Keep it (and the password) somewhere safe.');
    } catch (err) {
      setExportMsg(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImportMsg(null);
    setBusy(true);
    try {
      const bundle = await decryptConfig(await importFile.text(), importPw);
      const res = await applyConfig(bundle, importMode);
      getHandler()?.refreshAdapters();
      setImportMsg({ text: `Imported ${res.providers} provider(s) and ${res.permissions} permission(s). Reloading…`, error: false });
      setTimeout(() => window.location.reload(), 1100);
    } catch (err) {
      setImportMsg({ text: err instanceof Error ? err.message : 'Import failed.', error: true });
      setBusy(false);
    }
  };

  if (!settings) return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>Configure access controls</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Require approval for new sites</Label>
              <p className="text-sm text-muted-foreground">
                Ask before granting AI access to new websites
              </p>
            </div>
            <Switch
              checked={settings.requireApproval}
              onCheckedChange={(checked) => setSettings({ ...settings, requireApproval: checked })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rate Limits</CardTitle>
          <CardDescription>Control usage across all sites</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="requests-per-minute">Requests per minute</Label>
              <Input
                id="requests-per-minute"
                type="number"
                value={settings.globalRateLimit.requestsPerMinute}
                onChange={(e) => setSettings({
                  ...settings,
                  globalRateLimit: {
                    ...settings.globalRateLimit,
                    requestsPerMinute: parseInt(e.target.value) || 60,
                  },
                })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tokens-per-day">Tokens per day</Label>
              <Input
                id="tokens-per-day"
                type="number"
                value={settings.globalRateLimit.tokensPerDay}
                onChange={(e) => setSettings({
                  ...settings,
                  globalRateLimit: {
                    ...settings.globalRateLimit,
                    tokensPerDay: parseInt(e.target.value) || 100000,
                  },
                })}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleSave}>
            {saved ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Saved!
              </>
            ) : (
              'Save Settings'
            )}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backup &amp; Transfer</CardTitle>
          <CardDescription>
            Export your providers, settings, and permissions to an encrypted file, or import one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Export */}
          <div className="space-y-2">
            <Label htmlFor="export-pw">Export</Label>
            <div className="flex gap-2">
              <Input
                id="export-pw"
                type="password"
                value={exportPw}
                onChange={(e) => setExportPw(e.target.value)}
                placeholder="Password to protect the file (min 8)"
              />
              <Button onClick={handleExport} disabled={exportPw.length < 8} className="shrink-0">
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The file is encrypted with AES-256; your API keys are never written in plaintext.
              You&rsquo;ll need this password to import it.
            </p>
            {exportMsg && <p className="text-xs text-green-500">{exportMsg}</p>}
          </div>

          <div className="border-t" />

          {/* Import */}
          <div className="space-y-3">
            <Label htmlFor="import-file">Import</Label>
            <input
              id="import-file"
              type="file"
              accept="application/json,.json"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
            />
            <Input
              type="password"
              value={importPw}
              onChange={(e) => setImportPw(e.target.value)}
              placeholder="File password"
            />
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="import-mode" className="accent-primary"
                  checked={importMode === 'additive'} onChange={() => setImportMode('additive')} />
                <span><span className="font-medium">Merge</span>: add on top of what&rsquo;s here</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="import-mode" className="accent-primary"
                  checked={importMode === 'fresh'} onChange={() => setImportMode('fresh')} />
                <span><span className="font-medium">Replace</span>: clear providers first</span>
              </label>
            </div>
            <Button variant="outline" onClick={handleImport} disabled={!importFile || importPw.length < 1 || busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Import
            </Button>
            {importMsg && (
              <p className={`text-sm ${importMsg.error ? 'text-destructive' : 'text-green-500'}`}>{importMsg.text}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Unlock Popup Component
 * Shown when vault is locked and user needs to enter passphrase
 */
function UnlockPopup({ returnTo }: { returnTo: string }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSetUp, setIsSetUp] = useState<boolean | null>(null);
  const encryption = getVaultEncryption();

  useEffect(() => {
    encryption.isSetUp().then(setIsSetUp);
  }, [encryption]);

  // Show loading state while checking setup status
  if (isSetUp === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleUnlock = async () => {
    setLoading(true);
    setError(null);

    try {
      let success: boolean;
      if (isSetUp) {
        success = await encryption.unlock(passphrase);
      } else {
        success = await encryption.setup(passphrase);
      }

      if (success) {
        // Upgrade any legacy-obfuscated keys to AES now that we're unlocked.
        await getVaultStorage().migrateProvidersToEncryption();
        // Notify the opener window that vault is unlocked
        if (window.opener) {
          window.opener.postMessage({ type: 'vault_unlocked' }, returnTo);
        }
        // Close the popup
        window.close();
      } else {
        setError('Incorrect passphrase. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock vault');
    }

    setLoading(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && passphrase.length >= 8) {
      handleUnlock();
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center font-bold text-3xl text-neutral-900 mx-auto mb-4">
            W
          </div>
          <CardTitle className="text-2xl">
            {isSetUp ? 'Unlock Your Vault' : 'Set Up Your Vault'}
          </CardTitle>
          <CardDescription>
            {isSetUp
              ? 'Enter your passphrase to access your API keys'
              : 'Create a passphrase to protect your API keys'
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="passphrase">
              {isSetUp ? 'Passphrase' : 'Create Passphrase'}
            </Label>
            <Input
              id="passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={isSetUp ? 'Enter your passphrase' : 'At least 8 characters'}
              autoFocus
            />
            {!isSetUp && (
              <p className="text-xs text-muted-foreground">
                This passphrase encrypts your API keys. Choose something memorable - if you forget it, you'll need to re-enter your API keys.
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            onClick={handleUnlock}
            disabled={loading || passphrase.length < 8}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isSetUp ? 'Unlocking...' : 'Setting up...'}
              </>
            ) : (
              isSetUp ? 'Unlock Vault' : 'Create Vault'
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

/**
 * Vault App Wrapper
 * Handles encryption state - shows unlock UI if vault is locked
 */
function VaultApp({ onExit }: { onExit?: () => void }) {
  const encryption = getVaultEncryption();
  const [checking, setChecking] = useState(true);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isSetUp, setIsSetUp] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Check for restored session on mount
  useEffect(() => {
    const checkSession = async () => {
      // Check if encryption is set up
      const setUp = await encryption.isSetUp();
      setIsSetUp(setUp);

      // Give the encryption module time to restore from IndexedDB
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if already unlocked (restored from IndexedDB)
      if (!encryption.locked) {
        setIsUnlocked(true);
        getHandler()?.refreshAdapters();
      }
      setChecking(false);
    };

    checkSession();
  }, []);

  const handleUnlock = async () => {
    setLoading(true);
    setError(null);

    try {
      let success: boolean;
      if (isSetUp) {
        success = await encryption.unlock(passphrase);
      } else {
        success = await encryption.setup(passphrase);
      }

      if (success) {
        // Upgrade any legacy-obfuscated keys to AES now that we're unlocked.
        await getVaultStorage().migrateProvidersToEncryption();
        setIsUnlocked(true);
        // Refresh the handler to use decrypted keys
        getHandler()?.refreshAdapters();
      } else {
        setError('Incorrect passphrase. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock vault');
    }

    setLoading(false);
  };

  const handleLock = async () => {
    await encryption.lock();
    setIsUnlocked(false);
    setPassphrase('');
  };

  const handleExit = async () => {
    await handleLock();
    onExit?.();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && passphrase.length >= 8) {
      handleUnlock();
    }
  };

  // Show loading while checking for restored session
  if (checking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If vault is unlocked, show main app with exit-to-home capability
  if (isUnlocked) {
    return <App onExit={handleExit} />;
  }

  // Not unlocked. First-time visitors get the full landing with the create-vault
  // card slotted in; returning visitors who only need to unlock get a compact prompt.
  const vaultCard = (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center font-bold text-3xl text-neutral-900 mx-auto mb-4">
            W
          </div>
          <CardTitle className="text-2xl">
            {isSetUp ? 'Unlock Your Vault' : 'Set Up Your Vault'}
          </CardTitle>
          <CardDescription>
            {isSetUp
              ? 'Enter your passphrase to access your API keys'
              : 'Create a passphrase to protect your API keys. This encrypts your keys locally.'
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vault-passphrase">
              {isSetUp ? 'Passphrase' : 'Create Passphrase'}
            </Label>
            <Input
              id="vault-passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={isSetUp ? 'Enter your passphrase' : 'At least 8 characters'}
              autoFocus
            />
            {!isSetUp && (
              <p className="text-xs text-muted-foreground">
                This passphrase encrypts your API keys locally. Choose something memorable - if you forget it, you'll need to re-enter your API keys.
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            onClick={handleUnlock}
            disabled={loading || passphrase.length < 8}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isSetUp ? 'Unlocking...' : 'Setting up...'}
              </>
            ) : (
              isSetUp ? 'Unlock Vault' : 'Create Vault'
            )}
          </Button>
        </CardFooter>
      </Card>
  );

  // Locked (first-time setup or returning unlock): centered card, with a way home.
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md mb-4">
        {onExit && (
          <button
            onClick={onExit}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to home
          </button>
        )}
      </div>
      {vaultCard}
    </div>
  );
}

/**
 * Consent Popup Component
 * Shown when a site requests permission to use WindowLLM
 */
function ConsentPopup({ origin }: { origin: string }) {
  const [loading, setLoading] = useState(false);
  const api = getVaultAPI();

  const handleGrant = async () => {
    setLoading(true);
    try {
      // Grant permission for the full capability set — consent is binary:
      // allowing a site lets it use any capability the chosen model supports.
      await api.permissions.grant({
        origin,
        capabilities: ['chat', 'streaming', 'vision', 'tools', 'embeddings', 'jsonMode', 'systemPrompt', 'multiTurn'],
        grantedAt: Date.now(),
      });

      // Notify opener
      if (window.opener) {
        window.opener.postMessage({ type: 'consent_result', granted: true }, origin);
      }
      window.close();
    } catch (error) {
      console.error('Failed to grant permission:', error);
      setLoading(false);
    }
  };

  const handleDeny = () => {
    if (window.opener) {
      window.opener.postMessage({ type: 'consent_result', granted: false }, origin);
    }
    window.close();
  };

  // Parse origin for display
  let displayOrigin = origin;
  try {
    const url = new URL(origin);
    displayOrigin = url.hostname;
  } catch {
    // Keep original if parsing fails
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center font-bold text-3xl text-neutral-900 mx-auto mb-4">
            W
          </div>
          <CardTitle className="text-2xl">Permission Request</CardTitle>
          <CardDescription>
            A website is requesting access to your AI providers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 rounded-lg bg-muted">
            <p className="text-sm text-muted-foreground mb-1">Requesting site:</p>
            <p className="font-mono font-medium text-lg break-all">{displayOrigin}</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">This site will be able to:</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-500" />
                Send messages to AI models
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-500" />
                Use streaming responses
              </li>
            </ul>
          </div>

          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm">
            <p className="text-yellow-600 dark:text-yellow-500">
              <strong>Note:</strong> Your API keys are never shared with the website.
              All requests are proxied through WindowLLM.
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleDeny}
            disabled={loading}
          >
            Deny
          </Button>
          <Button
            className="flex-1"
            onClick={handleGrant}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Granting...
              </>
            ) : (
              'Allow Access'
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

// crypto.subtle (used to encrypt vault keys) only exists in a secure context.
// If the page loaded over plain HTTP on a real host, upgrade to HTTPS before
// doing anything, so key setup can't fail with a cryptic "reading 'importKey'".
if (!window.isSecureContext && window.location.protocol === 'http:') {
  window.location.replace(window.location.href.replace(/^http:/, 'https:'));
}

// Check URL parameters for popup modes
const urlParams = new URLSearchParams(window.location.search);
const returnTo = urlParams.get('returnTo');
const consentOrigin = urlParams.get('origin');
const isUnlockPopup = window.location.pathname === '/unlock' && returnTo !== null;
const isConsentPopup = urlParams.get('consent') === 'true' && consentOrigin !== null;

// Standalone site: the marketing home (Landing) lives at "/", and the vault
// (setup / unlock / dashboard) lives at "/vault". Home stays reachable at all
// times; the vault's "Exit" returns here. Deep loads of /vault are served by the
// SPA fallback (404.html) on GitHub Pages.
function Site() {
  const inVault = () => {
    const p = window.location.pathname.replace(/\/+$/, '');
    return p === '/vault' || p.endsWith('/vault');
  };
  const [view, setView] = useState<'home' | 'vault'>(() => (inVault() ? 'vault' : 'home'));

  useEffect(() => {
    const onPop = () => setView(inVault() ? 'vault' : 'home');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openVault = () => {
    window.history.pushState({}, '', '/vault');
    setView('vault');
    window.scrollTo(0, 0);
  };
  const exitVault = () => {
    window.history.pushState({}, '', '/');
    setView('home');
    window.scrollTo(0, 0);
  };

  return view === 'vault'
    ? <VaultApp onExit={exitVault} />
    : <Landing onOpenVault={openVault} />;
}

// Mount the app
const root = document.getElementById('root');
if (root) {
  if (isIframe) {
    initializeHandler();
    console.log('WindowLLM Vault: Running in iframe mode');
  } else if (isConsentPopup && consentOrigin) {
    // Consent popup mode (opened by client for permission request)
    ReactDOM.createRoot(root).render(<ConsentPopup origin={consentOrigin} />);
  } else if (isUnlockPopup && returnTo) {
    // Unlock popup mode (opened by client for iframe unlock)
    ReactDOM.createRoot(root).render(<UnlockPopup returnTo={returnTo} />);
  } else {
    initializeHandler();
    ReactDOM.createRoot(root).render(<Site />);
  }
}
