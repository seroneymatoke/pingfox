import { useEffect } from 'react';

export function Toast({ message, critical = false, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 2800);
    return () => clearTimeout(timer);
  }, [onClose]);

  return <div className={`toast${critical ? ' critical' : ''}`} role="status"><span className="dot" />{message}</div>;
}
