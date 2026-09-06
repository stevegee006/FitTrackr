'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { getServerConfig, setServerUrl, resetServerUrl, isNativeShell } from '@/lib/native';
import { Server, AlertTriangle } from 'lucide-react';

/**
 * Which self-hosted FitTrackr the native iOS app points at.
 *
 * **Renders nothing outside the native shell** — in a browser or the installed
 * PWA the address bar already determines the server, so the control would be a lie.
 *
 * The native side stores the value in UserDefaults and hands it to Capacitor
 * before the webview loads, so it is still an ordinary `server.url` and the
 * plugins keep working. There is also a native prompt on first launch and
 * whenever the configured host cannot be reached — this card is for changing
 * it deliberately, not for recovering from a typo, because a broken host means
 * there is no web app left to render this.
 */
export function ServerSettingsCard() {
  const [native, setNative] = useState(false);
  const [current, setCurrent] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // isNativeShell() reads a global the shell injects, so it can only be
  // consulted after mount — during SSR and first paint there is no window.
  useEffect(() => {
    if (!isNativeShell()) return;
    setNative(true);
    void getServerConfig().then((cfg) => {
      if (!cfg) return;
      setCurrent(cfg.url);
      setDraft(cfg.url);
    });
  }, []);

  if (!native) return null;

  const MESSAGES: Record<string, string> = {
    invalid: 'That address was rejected. Use https, or a local network address.',
    // Distinguished deliberately: "rejected" sent someone hunting a URL
    // problem when the real fault was that the app had no bridge at all.
    unavailable:
      'This build has no server plugin — rebuild the app in Xcode to change the server.',
  };

  async function save() {
    setBusy(true);
    setError(null);
    const result = await setServerUrl(draft);
    setBusy(false);
    if (result !== 'ok') setError(MESSAGES[result]);
    // On success the app reloads onto the new host, so nothing after this runs.
  }

  async function reset() {
    setBusy(true);
    setError(null);
    const result = await resetServerUrl();
    setBusy(false);
    if (result !== 'ok') setError(MESSAGES[result]);
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <Server className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        <p className="text-sm font-semibold flex-1">Server</p>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        The FitTrackr instance this app connects to. Changing it reloads the app.
      </p>

      <input
        type="url"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="https://fittrackr.example.com"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
      />

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-red-500">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || !draft.trim() || draft.trim() === current}
          className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-40"
        >
          Connect
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300 disabled:opacity-40"
        >
          Use default
        </button>
      </div>

      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Signed in sessions belong to a server — you will need to sign in again
        after switching.
      </p>
    </Card>
  );
}
