/**
 * Browser extension entry point.
 *
 * The dashboard itself is shared with the web Vault. This file owns only the
 * extension-specific consent, unlock, and background-message integration.
 */

import { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Check, Loader2, Shield } from 'lucide-react';

import './globals.css';

import { VaultDashboard } from './main.js';
import { Button } from './components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { getVaultEncryption } from './services/crypto.js';

interface PendingPopupRequest {
  type: 'consent' | 'unlock';
  origin?: string;
  tabId: number;
  timestamp: number;
}

interface VaultStatus {
  isSetUp: boolean;
  isLocked: boolean;
}

interface ConsentPopupProps {
  readonly origin: string;
  readonly onApprove: () => void;
  readonly onDeny: () => void;
}

function BrandMark({ size = 'large' }: { readonly size?: 'small' | 'large' }) {
  const dimensions = size === 'large' ? 'w-16 h-16 text-3xl rounded-2xl' : 'w-10 h-10 text-xl rounded-lg';
  return (
    <div className={`${dimensions} bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center font-bold text-neutral-900`}>
      W
    </div>
  );
}

function ConsentPopup({ origin, onApprove, onDeny }: ConsentPopupProps) {
  let displayOrigin = origin;
  try {
    displayOrigin = new URL(origin).hostname;
  } catch {
    // Keep the original value when it is not a complete URL.
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4"><BrandMark /></div>
          <CardTitle className="text-2xl">Permission Request</CardTitle>
          <CardDescription>A website is requesting access to your AI providers</CardDescription>
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

          <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <Shield className="h-5 w-5 flex-none text-amber-400" />
            <p className="text-muted-foreground">
              Your API keys stay inside WindowLLM. The website receives responses, never your keys.
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onDeny}>Deny</Button>
          <Button className="flex-1" onClick={onApprove}>Allow Access</Button>
        </CardFooter>
      </Card>
    </div>
  );
}

interface UnlockPopupProps {
  readonly onUnlock: () => void;
  readonly onCancel: () => void;
}

function UnlockPopup({ onUnlock, onCancel }: UnlockPopupProps) {
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
      const success = isSetUp
        ? await encryption.unlock(passphrase)
        : await encryption.setup(passphrase);

      if (success) {
        onUnlock();
      } else {
        setError('Incorrect passphrase. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock vault');
    } finally {
      setLoading(false);
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
    <div className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4"><BrandMark /></div>
          <CardTitle className="text-2xl">
            {isSetUp ? 'Unlock Your Vault' : 'Set Up Your Vault'}
          </CardTitle>
          <CardDescription>
            {isSetUp
              ? 'Enter your passphrase to access your API keys'
              : 'Create a passphrase to encrypt your API keys locally'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="extension-vault-passphrase">
              {isSetUp ? 'Passphrase' : 'Create Passphrase'}
            </Label>
            <Input
              id="extension-vault-passphrase"
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && passphrase.length >= 8) void handleUnlock();
              }}
              placeholder={isSetUp ? 'Enter your passphrase' : 'At least 8 characters'}
              autoFocus
            />
            {!isSetUp && (
              <p className="text-xs text-muted-foreground">
                If you forget this passphrase, you will need to enter your API keys again.
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button
            className="flex-1"
            onClick={() => void handleUnlock()}
            disabled={loading || passphrase.length < 8}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (isSetUp ? 'Unlock' : 'Create Vault')}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

async function sendRuntimeMessage<T>(message: unknown): Promise<T | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function ExtensionRoot() {
  const [pendingRequest, setPendingRequest] = useState<PendingPopupRequest | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);

  useEffect(() => {
    Promise.all([
      sendRuntimeMessage<{ pending?: PendingPopupRequest }>({ type: 'get_pending_popup' }),
      sendRuntimeMessage<VaultStatus>({ type: 'vault_status' }),
    ]).then(([pendingResult, status]) => {
      setPendingRequest(pendingResult?.pending ?? null);
      setVaultStatus(status ?? { isSetUp: false, isLocked: false });
    });
  }, []);

  const sendPopupResult = useCallback(async (result: boolean) => {
    await sendRuntimeMessage({ type: 'popup_result', payload: { result } });
  }, []);

  const handleConsentApprove = useCallback(async () => {
    if (pendingRequest?.origin) {
      await sendRuntimeMessage({
        type: 'grant_permission',
        payload: { origin: pendingRequest.origin },
      });
    }
    await sendPopupResult(true);
    window.close();
  }, [pendingRequest, sendPopupResult]);

  const handlePendingCancel = useCallback(async () => {
    await sendPopupResult(false);
    window.close();
  }, [sendPopupResult]);

  const handleUnlockSuccess = useCallback(async () => {
    setVaultStatus({ isSetUp: true, isLocked: false });
    if (pendingRequest?.type === 'unlock') {
      await sendPopupResult(true);
      window.close();
    }
  }, [pendingRequest, sendPopupResult]);

  const handleLock = useCallback(async () => {
    await sendRuntimeMessage({ type: 'lock_vault' });
    setVaultStatus({ isSetUp: true, isLocked: true });
  }, []);

  if (!vaultStatus) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (pendingRequest?.type === 'consent' && pendingRequest.origin) {
    return (
      <ConsentPopup
        origin={pendingRequest.origin}
        onApprove={() => void handleConsentApprove()}
        onDeny={() => void handlePendingCancel()}
      />
    );
  }

  if (pendingRequest?.type === 'unlock' || !vaultStatus.isSetUp || vaultStatus.isLocked) {
    return (
      <UnlockPopup
        onUnlock={() => void handleUnlockSuccess()}
        onCancel={() => {
          if (pendingRequest) void handlePendingCancel();
          else window.close();
        }}
      />
    );
  }

  return (
    <VaultDashboard
      runtime="extension"
      onNavigateHome={() => window.open('https://windowllm.org', '_blank', 'noopener,noreferrer')}
      onSignOut={() => void handleLock()}
    />
  );
}

const urlParams = new URLSearchParams(window.location.search);
const isConsentMode = urlParams.get('consent') === 'true';
const consentOrigin = urlParams.get('origin');
const isUnlockMode = urlParams.get('unlock') === 'true';

const root = document.getElementById('root');
if (root) {
  if (isConsentMode && consentOrigin) {
    const handleApprove = async () => {
      await sendRuntimeMessage({ type: 'grant_permission', payload: { origin: consentOrigin } });
      window.opener?.postMessage({ type: 'consent_granted', origin: consentOrigin }, '*');
      window.close();
    };
    const handleDeny = () => {
      window.opener?.postMessage({ type: 'consent_denied', origin: consentOrigin }, '*');
      window.close();
    };
    ReactDOM.createRoot(root).render(
      <ConsentPopup origin={consentOrigin} onApprove={() => void handleApprove()} onDeny={handleDeny} />,
    );
  } else if (isUnlockMode) {
    ReactDOM.createRoot(root).render(
      <UnlockPopup
        onUnlock={() => {
          window.opener?.postMessage({ type: 'vault_unlocked' }, '*');
          window.close();
        }}
        onCancel={() => {
          window.opener?.postMessage({ type: 'vault_unlock_cancelled' }, '*');
          window.close();
        }}
      />,
    );
  } else {
    ReactDOM.createRoot(root).render(<ExtensionRoot />);
  }
}
