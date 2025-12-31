/**
 * Extension Entry Point
 *
 * Renders the vault UI for browser extension popup/options pages.
 * Does NOT initialize the postMessage handler (extension uses background script).
 */

import { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { Settings, Shield, Key, Plus, Check, Loader2 } from 'lucide-react';

// Build timestamp injected by Vite
declare const __BUILD_TIME__: string;
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'dev';

import './globals.css';

import { getVaultStorage, type StoredProviderConfig, type SitePermission, type VaultSettings } from './services/storage.js';

import { Button } from './components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Badge } from './components/ui/badge';
import { Switch } from './components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';

type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'openrouter' | 'custom';

const PROVIDER_INFO: Record<ProviderType, { name: string; description: string; icon: string }> = {
  openai: { name: 'OpenAI', description: 'GPT-4, GPT-4o, and more', icon: '🤖' },
  anthropic: { name: 'Anthropic', description: 'Claude 3.5, Claude 4', icon: '🧠' },
  ollama: { name: 'Ollama', description: 'Local models', icon: '🦙' },
  openrouter: { name: 'OpenRouter', description: 'Multi-provider gateway', icon: '🔀' },
  custom: { name: 'Custom', description: 'OpenAI-compatible API', icon: '⚙️' },
};

function ExtensionApp() {
  const [providers, setProviders] = useState<StoredProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const storage = getVaultStorage();

  const loadProviders = useCallback(async () => {
    const loaded = await storage.getProviders();
    setProviders(loaded);
    setLoading(false);
  }, [storage]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const handleAddProvider = useCallback(async (config: Omit<StoredProviderConfig, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newProvider: StoredProviderConfig = {
      ...config,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await storage.saveProvider(newProvider);
    await loadProviders();
    setShowAddProvider(false);
  }, [storage, loadProviders]);

  const handleUpdateProvider = useCallback(async (provider: StoredProviderConfig) => {
    await storage.saveProvider(provider);
    await loadProviders();
  }, [storage, loadProviders]);

  const handleDeleteProvider = useCallback(async (id: string) => {
    if (confirm('Are you sure you want to delete this provider?')) {
      await storage.deleteProvider(id);
      await loadProviders();
    }
  }, [storage, loadProviders]);

  const isConfigured = providers.some(p => p.enabled);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 z-10 bg-background/95 backdrop-blur">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center font-bold text-sm text-white">
                W
              </div>
              <div>
                <h1 className="text-base font-bold">WindowLLM</h1>
              </div>
            </div>
            <Badge variant={isConfigured ? 'success' : 'secondary'} className="text-xs">
              {isConfigured ? 'Ready' : 'Setup'}
            </Badge>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-4">
        <Tabs defaultValue="providers" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="providers" className="gap-1 text-xs">
              <Key className="h-3 w-3" />
              Providers
            </TabsTrigger>
            <TabsTrigger value="permissions" className="gap-1 text-xs">
              <Shield className="h-3 w-3" />
              Sites
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1 text-xs">
              <Settings className="h-3 w-3" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="providers" className="space-y-3">
            {!isConfigured && (
              <Card className="border-blue-500/30 bg-blue-500/5">
                <CardContent className="p-3">
                  <p className="text-sm text-muted-foreground">
                    Add a provider to start using AI on any website.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Provider list */}
            <div className="space-y-2">
              {providers.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onUpdate={handleUpdateProvider}
                  onDelete={handleDeleteProvider}
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
                className="w-full h-16 border-dashed text-sm"
                onClick={() => setShowAddProvider(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
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

      {/* Footer with build info */}
      <footer className="border-t px-4 py-2 text-center">
        <p className="text-[10px] text-muted-foreground font-mono">
          Build: {new Date(BUILD_TIME).toLocaleString()}
        </p>
      </footer>
    </div>
  );
}

interface ProviderCardProps {
  provider: StoredProviderConfig;
  onUpdate: (provider: StoredProviderConfig) => void;
  onDelete: (id: string) => void;
}

function ProviderCard({ provider, onUpdate, onDelete }: ProviderCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editedApiKey, setEditedApiKey] = useState(provider.apiKey || '');
  const [editedBaseUrl, setEditedBaseUrl] = useState(provider.baseUrl || '');

  const info = PROVIDER_INFO[provider.type as ProviderType] || PROVIDER_INFO.custom;

  const handleSave = () => {
    onUpdate({
      ...provider,
      apiKey: editedApiKey,
      baseUrl: editedBaseUrl || undefined,
    });
    setExpanded(false);
  };

  return (
    <Card className={provider.enabled ? 'border-green-500/30' : ''}>
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{info.icon}</span>
            <div>
              <CardTitle className="text-sm">{provider.name}</CardTitle>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={provider.enabled}
              onCheckedChange={(checked) => onUpdate({ ...provider, enabled: checked })}
            />
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Close' : 'Edit'}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-3 pt-0 space-y-3 border-t">
          {provider.type !== 'ollama' && (
            <div className="space-y-1">
              <Label className="text-xs">API Key</Label>
              <Input
                type="password"
                value={editedApiKey}
                onChange={(e) => setEditedApiKey(e.target.value)}
                placeholder="sk-..."
                className="h-8 text-sm"
              />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Base URL (optional)</Label>
            <Input
              value={editedBaseUrl}
              onChange={(e) => setEditedBaseUrl(e.target.value)}
              placeholder={provider.type === 'ollama' ? 'http://localhost:11434' : 'Default'}
              className="h-8 text-sm"
            />
          </div>

          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={handleSave}>Save</Button>
            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => onDelete(provider.id)}>
              Delete
            </Button>
          </div>
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
  const [type, setType] = useState<ProviderType>('anthropic');
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
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-sm">Add Provider</CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        <div className="grid grid-cols-5 gap-1">
          {(Object.keys(PROVIDER_INFO) as ProviderType[]).map((key) => (
            <Button
              key={key}
              variant={type === key ? 'default' : 'outline'}
              className="flex-col h-14 gap-0.5 p-1"
              onClick={() => setType(key)}
            >
              <span className="text-base">{PROVIDER_INFO[key].icon}</span>
              <span className="text-[10px]">{PROVIDER_INFO[key].name}</span>
            </Button>
          ))}
        </div>

        {type !== 'ollama' && (
          <div className="space-y-1">
            <Label className="text-xs">API Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              className="h-8 text-sm"
            />
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs">Base URL (optional)</Label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={type === 'ollama' ? 'http://localhost:11434' : 'Leave empty for default'}
            className="h-8 text-sm"
          />
        </div>
      </CardContent>
      <CardFooter className="p-3 pt-0 flex justify-end gap-2">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="h-7 text-xs" onClick={handleSubmit}>Add</Button>
      </CardFooter>
    </Card>
  );
}

function PermissionsTab() {
  const [permissions, setPermissions] = useState<SitePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const storage = getVaultStorage();

  const loadPermissions = useCallback(async () => {
    const loaded = await storage.getPermissions();
    setPermissions(loaded);
    setLoading(false);
  }, [storage]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  const handleRevoke = async (origin: string) => {
    if (confirm(`Revoke permissions for ${origin}?`)) {
      await storage.revokePermission(origin);
      await loadPermissions();
    }
  };

  if (loading) {
    return <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-sm">Site Permissions</CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {permissions.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">
            <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No sites have been granted access.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {permissions.map((p) => (
              <div
                key={p.origin}
                className="flex items-center justify-between p-2 rounded-lg border text-sm"
              >
                <span className="font-mono text-xs truncate max-w-[180px]">{p.origin}</span>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-6 text-xs"
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
  );
}

function SettingsTab() {
  const [settings, setSettings] = useState<VaultSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [vaultStatus, setVaultStatus] = useState<{ isSetUp: boolean; isLocked: boolean } | null>(null);
  const [locking, setLocking] = useState(false);
  const [showSetupForm, setShowSetupForm] = useState(false);
  const [setupPassphrase, setSetupPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const storage = getVaultStorage();
  const encryption = getVaultEncryption();

  const refreshVaultStatus = useCallback(() => {
    // Check vault status via background script
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'vault_status' }).then((result: unknown) => {
        const status = result as { isSetUp?: boolean; isLocked?: boolean };
        if (status && typeof status.isSetUp === 'boolean') {
          setVaultStatus({ isSetUp: status.isSetUp, isLocked: status.isLocked ?? false });
        }
      }).catch(() => {
        // Ignore errors - vault status not available
      });
    }
  }, []);

  useEffect(() => {
    storage.getSettings().then(setSettings);
    refreshVaultStatus();
  }, [storage, refreshVaultStatus]);

  const handleSave = async () => {
    if (!settings) return;
    await storage.saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleLockVault = async () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      setLocking(true);
      try {
        await chrome.runtime.sendMessage({ type: 'lock_vault' });
        setVaultStatus(prev => prev ? { ...prev, isLocked: true } : null);
      } catch (error) {
        console.error('Failed to lock vault:', error);
      }
      setLocking(false);
    }
  };

  const handleSetupEncryption = async () => {
    setSetupError(null);

    if (setupPassphrase.length < 8) {
      setSetupError('Passphrase must be at least 8 characters');
      return;
    }

    if (setupPassphrase !== confirmPassphrase) {
      setSetupError('Passphrases do not match');
      return;
    }

    setSetupLoading(true);
    try {
      const success = await encryption.setup(setupPassphrase);
      if (success) {
        setShowSetupForm(false);
        setSetupPassphrase('');
        setConfirmPassphrase('');
        refreshVaultStatus();
      } else {
        setSetupError('Failed to set up encryption');
      }
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Failed to set up encryption');
    }
    setSetupLoading(false);
  };

  if (!settings) {
    return <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      {/* Vault Security Card */}
      <Card>
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Key className="h-4 w-4" />
            Vault Security
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {vaultStatus?.isSetUp ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium">
                  {vaultStatus.isLocked ? 'Vault is locked' : 'Vault is unlocked'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {vaultStatus.isLocked
                    ? 'Enter passphrase to access API keys'
                    : 'Your API keys are protected with AES-256 encryption'
                  }
                </p>
              </div>
              {!vaultStatus.isLocked && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleLockVault}
                  disabled={locking}
                >
                  {locking ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Lock'}
                </Button>
              )}
            </div>
          ) : showSetupForm ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Create Passphrase</Label>
                <Input
                  type="password"
                  value={setupPassphrase}
                  onChange={(e) => setSetupPassphrase(e.target.value)}
                  placeholder="At least 8 characters"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Confirm Passphrase</Label>
                <Input
                  type="password"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="Confirm passphrase"
                  className="h-8 text-sm"
                />
              </div>
              {setupError && (
                <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive">
                  {setupError}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setShowSetupForm(false);
                    setSetupPassphrase('');
                    setConfirmPassphrase('');
                    setSetupError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleSetupEncryption}
                  disabled={setupLoading || setupPassphrase.length < 8}
                >
                  {setupLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Enable'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium">Basic protection</p>
                <p className="text-xs text-muted-foreground">
                  Enable passphrase for AES-256 encryption
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setShowSetupForm(true)}
              >
                Set Up
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-sm">Security</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Require approval for new sites</Label>
            <Switch
              checked={settings.requireApproval}
              onCheckedChange={(checked) => setSettings({ ...settings, requireApproval: checked })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-sm">Rate Limits</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          <div className="space-y-1">
            <Label className="text-xs">Requests per minute</Label>
            <Input
              type="number"
              value={settings.globalRateLimit.requestsPerMinute}
              onChange={(e) => setSettings({
                ...settings,
                globalRateLimit: {
                  ...settings.globalRateLimit,
                  requestsPerMinute: parseInt(e.target.value) || 60,
                },
              })}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tokens per day</Label>
            <Input
              type="number"
              value={settings.globalRateLimit.tokensPerDay}
              onChange={(e) => setSettings({
                ...settings,
                globalRateLimit: {
                  ...settings.globalRateLimit,
                  tokensPerDay: parseInt(e.target.value) || 100000,
                },
              })}
              className="h-8 text-sm"
            />
          </div>
        </CardContent>
        <CardFooter className="p-3 pt-0">
          <Button size="sm" className="h-7 text-xs" onClick={handleSave}>
            {saved ? <><Check className="mr-1 h-3 w-3" /> Saved!</> : 'Save Settings'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

/**
 * Consent Popup Component
 * Shown when opened with ?consent=true&origin=...
 */
function ConsentPopup({ origin, onApprove, onDeny }: { origin: string; onApprove: () => void; onDeny: () => void }) {
  const displayOrigin = origin.replace(/^https?:\/\//, '');

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center font-bold text-sm text-white">
            W
          </div>
          <div>
            <h1 className="text-base font-bold">WindowLLM</h1>
            <p className="text-xs text-muted-foreground">Permission Request</p>
          </div>
        </div>

        {/* Main content */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-500" />
              Site wants to access AI
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2 space-y-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm font-medium break-all">{displayOrigin}</p>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p>This site is requesting access to:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Chat with AI models</li>
                <li>Stream responses</li>
              </ul>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-9"
                onClick={onDeny}
              >
                Deny
              </Button>
              <Button
                className="flex-1 h-9"
                onClick={onApprove}
              >
                Allow
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-center text-muted-foreground">
          You can manage permissions in the Sites tab.
        </p>
      </div>
    </div>
  );
}

/**
 * Unlock Popup Component
 * Shown when opened with ?unlock=true
 */
import { getVaultEncryption } from './services/crypto.js';
import { CardDescription } from './components/ui/card';

function UnlockPopup({ onUnlock, onCancel }: { onUnlock: () => void; onCancel: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSetUp, setIsSetUp] = useState<boolean | null>(null);
  const encryption = getVaultEncryption();

  useEffect(() => {
    encryption.isSetUp().then(setIsSetUp);
  }, [encryption]);

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
        onUnlock();
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

  if (isSetUp === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 flex items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center p-4 pb-2">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center font-bold text-xl text-white mx-auto mb-2">
            W
          </div>
          <CardTitle className="text-lg">
            {isSetUp ? 'Unlock Vault' : 'Set Up Vault'}
          </CardTitle>
          <CardDescription className="text-xs">
            {isSetUp
              ? 'Enter your passphrase to continue'
              : 'Create a passphrase to protect your API keys'
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="passphrase" className="text-xs">
              {isSetUp ? 'Passphrase' : 'Create Passphrase'}
            </Label>
            <Input
              id="passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={isSetUp ? 'Enter passphrase' : 'At least 8 characters'}
              autoFocus
              className="h-9"
            />
          </div>

          {error && (
            <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 h-9"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 h-9"
              onClick={handleUnlock}
              disabled={loading || passphrase.length < 8}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                isSetUp ? 'Unlock' : 'Create'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Pending popup request from background script
 */
interface PendingPopupRequest {
  type: 'consent' | 'unlock';
  origin?: string;
  tabId: number;
  timestamp: number;
}

/**
 * Root component that checks for pending popup requests
 */
function ExtensionRoot() {
  const [pendingRequest, setPendingRequest] = useState<PendingPopupRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for pending popup request from background script
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'get_pending_popup' })
        .then((response: unknown) => {
          const result = response as { pending?: PendingPopupRequest };
          if (result?.pending) {
            setPendingRequest(result.pending);
          }
          setLoading(false);
        })
        .catch(() => {
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);

  // Send result back to background script
  const sendPopupResult = useCallback(async (result: boolean) => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      await chrome.runtime.sendMessage({
        type: 'popup_result',
        payload: { result }
      });
    }
  }, []);

  // Handle consent approval
  const handleConsentApprove = useCallback(async () => {
    if (pendingRequest?.origin) {
      // Grant permission via background script
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        await chrome.runtime.sendMessage({
          type: 'grant_permission',
          payload: { origin: pendingRequest.origin }
        });
      }
    }
    await sendPopupResult(true);
    setPendingRequest(null);
  }, [pendingRequest, sendPopupResult]);

  // Handle consent denial
  const handleConsentDeny = useCallback(async () => {
    await sendPopupResult(false);
    setPendingRequest(null);
  }, [sendPopupResult]);

  // Handle vault unlock success
  const handleUnlockSuccess = useCallback(async () => {
    await sendPopupResult(true);
    setPendingRequest(null);
  }, [sendPopupResult]);

  // Handle vault unlock cancel
  const handleUnlockCancel = useCallback(async () => {
    await sendPopupResult(false);
    setPendingRequest(null);
  }, [sendPopupResult]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show consent popup if pending consent request
  if (pendingRequest?.type === 'consent' && pendingRequest.origin) {
    return (
      <ConsentPopup
        origin={pendingRequest.origin}
        onApprove={handleConsentApprove}
        onDeny={handleConsentDeny}
      />
    );
  }

  // Show unlock popup if pending unlock request
  if (pendingRequest?.type === 'unlock') {
    return (
      <UnlockPopup
        onUnlock={handleUnlockSuccess}
        onCancel={handleUnlockCancel}
      />
    );
  }

  // Default: show main extension app
  return <ExtensionApp />;
}

// Check for special modes (legacy URL-based mode for backwards compatibility)
const urlParams = new URLSearchParams(window.location.search);
const isConsentMode = urlParams.get('consent') === 'true';
const consentOrigin = urlParams.get('origin');
const isUnlockMode = urlParams.get('unlock') === 'true';

// Mount the app
const root = document.getElementById('root');
if (root) {
  if (isConsentMode && consentOrigin) {
    // Legacy: Render consent popup (URL-based mode)
    const handleApprove = async () => {
      // Grant permission via background script
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        await chrome.runtime.sendMessage({
          type: 'grant_permission',
          payload: { origin: consentOrigin }
        });
      }
      // Post back to opener (legacy mode)
      if (window.opener) {
        window.opener.postMessage({ type: 'consent_granted', origin: consentOrigin }, '*');
      }
      window.close();
    };

    const handleDeny = () => {
      if (window.opener) {
        window.opener.postMessage({ type: 'consent_denied', origin: consentOrigin }, '*');
      }
      window.close();
    };

    ReactDOM.createRoot(root).render(
      <ConsentPopup origin={consentOrigin} onApprove={handleApprove} onDeny={handleDeny} />
    );
  } else if (isUnlockMode) {
    // Legacy: Render unlock popup (URL-based mode)
    const handleUnlock = () => {
      // Post back to opener (legacy mode)
      if (window.opener) {
        window.opener.postMessage({ type: 'vault_unlocked' }, '*');
      }
      window.close();
    };

    const handleCancel = () => {
      if (window.opener) {
        window.opener.postMessage({ type: 'vault_unlock_cancelled' }, '*');
      }
      window.close();
    };

    ReactDOM.createRoot(root).render(
      <UnlockPopup onUnlock={handleUnlock} onCancel={handleCancel} />
    );
  } else {
    // New: Use ExtensionRoot which checks for pending popup requests
    ReactDOM.createRoot(root).render(<ExtensionRoot />);
  }
}
