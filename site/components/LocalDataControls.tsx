import { useState } from 'react';
import { clearLocalState } from '../lib/local-state';

export default function LocalDataControls() {
  const [message, setMessage] = useState('');
  return <div className="local-data-controls"><button className="button" type="button" onClick={() => setMessage(clearLocalState() ? 'Search history and saved playback have been cleared from this device.' : 'Browser storage could not be accessed. You can clear this site’s data in your browser settings.')}>Clear history and saved playback</button><p role="status">{message}</p></div>;
}
