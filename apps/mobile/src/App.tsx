import { useState, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import ConnectScreen from './components/ConnectScreen';
import ChatScreen from './components/ChatScreen';

const WS_URL_KEY = 'codebook_remote_ws_url';

export default function App() {
  const [wsUrl, setWsUrl] = useState<string | null>(() => {
    return localStorage.getItem(WS_URL_KEY);
  });

  const { connected, send, lastMessage, error } = useWebSocket(wsUrl);

  const handleConnect = useCallback((url: string) => {
    localStorage.setItem(WS_URL_KEY, url);
    setWsUrl(url);
  }, []);

  const handleDisconnect = useCallback(() => {
    localStorage.removeItem(WS_URL_KEY);
    setWsUrl(null);
  }, []);

  // Show connect screen if no URL or if disconnected with no URL
  if (!wsUrl) {
    return (
      <ConnectScreen
        onConnect={handleConnect}
        error={error}
        connecting={false}
      />
    );
  }

  // Show connect screen while trying to connect (with connecting state)
  if (!connected) {
    return (
      <ConnectScreen
        onConnect={handleConnect}
        error={error}
        connecting={true}
      />
    );
  }

  return (
    <ChatScreen
      connected={connected}
      send={send}
      lastMessage={lastMessage}
      onDisconnect={handleDisconnect}
    />
  );
}
