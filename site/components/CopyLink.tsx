import { useEffect, useState } from 'react';
import Icon from './Icon';

export default function CopyLink({ href, label = 'Copy link' }: { href: string; label?: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'denied'>('idle');
  const [url, setUrl] = useState('');
  useEffect(() => { setStatus('idle'); setUrl(''); }, [href]);
  async function copy() {
    const absolute = new URL(href, window.location.origin).href;
    setUrl(absolute);
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(absolute);
      setStatus('copied');
    } catch { setStatus('denied'); }
  }
  return <div className="copy-link">
    <button className="button button-secondary" type="button" onClick={copy}><Icon name={status === 'copied' ? 'check' : 'copy'} />{label}</button>
    <span className="copy-status" role="status">{status === 'copied' ? 'Link copied.' : status === 'denied' ? 'Clipboard access is unavailable. Select and copy the link below.' : ''}</span>
    {status === 'denied' && <label className="manual-copy">Share link<input type="text" value={url} readOnly onFocus={(event) => event.target.select()} /></label>}
  </div>;
}
