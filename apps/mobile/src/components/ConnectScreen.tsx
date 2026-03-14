import { useState, useCallback, useEffect } from 'react';

interface ConnectScreenProps {
  onConnect: (url: string) => void;
  error: string | null;
  connecting: boolean;
}

const STORAGE_KEY = 'codebook_remote_address';

export default function ConnectScreen({ onConnect, error, connecting }: ConnectScreenProps) {
  const [address, setAddress] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || '';
  });

  useEffect(() => {
    if (address) {
      localStorage.setItem(STORAGE_KEY, address);
    }
  }, [address]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim() || connecting) return;

    const addr = address.trim();
    const wsUrl = addr.startsWith('ws://') || addr.startsWith('wss://')
      ? addr
      : `ws://${addr}`;

    onConnect(wsUrl);
  }, [address, connecting, onConnect]);

  return (
    <div className="connect-screen">
      <div className="connect-logo">
        <div className="prefix">&gt; codebook</div>
        <div className="title">remote</div>
        <div className="subtitle">mobile access</div>
      </div>

      <form className="connect-form" onSubmit={handleSubmit}>
        <label className="connect-label" htmlFor="address">
          desktop address:
        </label>
        <input
          id="address"
          className="connect-input"
          type="text"
          placeholder="192.168.1.x:19876"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
        />

        <button
          className="connect-btn"
          type="submit"
          disabled={!address.trim() || connecting}
        >
          {connecting ? 'connecting...' : 'connect'}
        </button>

        {error && <div className="connect-error">{error}</div>}

        <div className="connect-divider">
          or scan QR code from desktop app
        </div>
      </form>
    </div>
  );
}
