/**
 * @windowllm/vault
 *
 * Vault application entry point
 */

import { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { Settings, Shield, Key, Plus, ExternalLink, Check, X, Loader2, AlertTriangle, Lock } from 'lucide-react';

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


// Check if we're in iframe mode
const isIframe = window.self !== window.top;

type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'openrouter' | 'custom';

const PROVIDER_INFO: Record<ProviderType, { name: string; description: string; icon: string }> = {
  openai: { name: 'OpenAI', description: 'GPT-4, GPT-4o, and more', icon: '🤖' },
  anthropic: { name: 'Anthropic', description: 'Claude 3.5, Claude 4', icon: '🧠' },
  ollama: { name: 'Ollama', description: 'Local models', icon: '🦙' },
  openrouter: { name: 'OpenRouter', description: 'Multi-provider gateway', icon: '🔀' },
  custom: { name: 'Custom', description: 'OpenAI-compatible API', icon: '⚙️' },
};

function App({ onLock }: { onLock?: () => void }) {
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
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center font-bold text-xl text-white">
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
              {onLock && (
                <Button variant="ghost" size="sm" onClick={onLock} title="Lock vault">
                  <Lock className="h-4 w-4" />
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
              <Card className="border-blue-500/30 bg-blue-500/5">
                <CardHeader>
                  <CardTitle className="text-blue-400">Welcome to WindowLLM!</CardTitle>
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
            <span className="text-2xl">{info.icon}</span>
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
          {provider.type === 'openai' && (
            <div className="flex gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-yellow-500">CORS Not Supported</p>
                <p className="text-muted-foreground mt-1">
                  OpenAI requires the browser extension. Consider using OpenRouter for iframe mode.
                </p>
              </div>
            </div>
          )}

          {provider.type === 'ollama' && (
            <div className="flex gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-yellow-500">Extension Required</p>
                <p className="text-muted-foreground mt-1">
                  Local models require the browser extension to bypass CORS.
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
              <span className="text-xl">{PROVIDER_INFO[key].icon}</span>
              <span className="text-xs">{PROVIDER_INFO[key].name}</span>
            </Button>
          ))}
        </div>

        {type === 'openai' && (
          <div className="flex gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
            <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-yellow-500">CORS Not Supported</p>
              <p className="text-muted-foreground mt-1">
                OpenAI does not support browser CORS requests. This provider will only work with the
                browser extension installed. For iframe mode, use <strong>OpenRouter</strong> instead
                (which provides access to OpenAI models) or <strong>Anthropic</strong>.
              </p>
            </div>
          </div>
        )}

        {type === 'ollama' && (
          <div className="flex gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
            <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-yellow-500">Extension Required</p>
              <p className="text-muted-foreground mt-1">
                Local models like Ollama require the browser extension to bypass CORS restrictions.
                Without the extension, requests to localhost will be blocked.
              </p>
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
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center font-bold text-3xl text-white mx-auto mb-4">
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
function VaultApp() {
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

  // If vault is unlocked, show main app with lock capability
  if (isUnlocked) {
    return <App onLock={handleLock} />;
  }

  // Show unlock UI
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center font-bold text-3xl text-white mx-auto mb-4">
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
      // Grant permission with default capabilities
      await api.permissions.grant({
        origin,
        capabilities: ['chat', 'streaming'],
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
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center font-bold text-3xl text-white mx-auto mb-4">
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

// Check URL parameters for popup modes
const urlParams = new URLSearchParams(window.location.search);
const returnTo = urlParams.get('returnTo');
const consentOrigin = urlParams.get('origin');
const isUnlockPopup = window.location.pathname === '/unlock' && returnTo !== null;
const isConsentPopup = urlParams.get('consent') === 'true' && consentOrigin !== null;

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
    // Use VaultApp wrapper which handles encryption state
    ReactDOM.createRoot(root).render(<VaultApp />);
  }
}
