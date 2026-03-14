import { useCallback, useEffect, useRef, useState } from 'react';

export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

interface UseWebSocketReturn {
  connected: boolean;
  send: (data: Record<string, unknown>) => void;
  lastMessage: WebSocketMessage | null;
  error: string | null;
}

export function useWebSocket(url: string | null): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlRef = useRef(url);

  urlRef.current = url;

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    const currentUrl = urlRef.current;
    if (!currentUrl) return;

    cleanup();
    setError(null);

    try {
      const ws = new WebSocket(currentUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WebSocketMessage;
          setLastMessage(data);
        } catch {
          // Ignore non-JSON messages
        }
      };

      ws.onerror = () => {
        setError('Connection failed');
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;

        // Auto-reconnect after 3 seconds if URL is still set
        if (urlRef.current) {
          reconnectTimer.current = setTimeout(() => {
            if (urlRef.current) {
              connect();
            }
          }, 3000);
        }
      };
    } catch {
      setError('Invalid WebSocket URL');
      setConnected(false);
    }
  }, [cleanup]);

  useEffect(() => {
    if (url) {
      connect();
    } else {
      cleanup();
      setConnected(false);
      setLastMessage(null);
    }

    return cleanup;
  }, [url, connect, cleanup]);

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { connected, send, lastMessage, error };
}
