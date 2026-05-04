'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { todayString, addDays } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { TimezoneCombobox } from '@/components/ui/TimezoneCombobox';
import { getBrowserTimezone, formatTimezoneLabel } from '@/lib/timezones';
import { ACTIVITY_LABELS, TRAINING_GOAL_LABELS } from '@fittrackr/shared';
import type { UserProfile, UserSettings, AiProvider } from '@fittrackr/shared';
import Link from 'next/link';
import { startRegistration } from '@simplewebauthn/browser';
import { Activity, Camera, GraduationCap, HelpCircle, MessageSquare, Ruler, Shield, Settings, Trash2, ExternalLink, User, X } from 'lucide-react';
import { compressImage } from '@/lib/image-utils';
import { getApiUrl, getAccessToken } from '@/lib/api-client';
import type { BodyMeasurement, ProgressPhotoMeta } from '@fittrackr/shared';

type Tab = 'biometrics' | 'security' | 'settings' | 'photos';

// Conversion helpers
const CM_PER_INCH = 2.54;
const KG_PER_LB = 0.453592;
const LB_PER_KG = 2.20462;
const IN_PER_CM = 1 / CM_PER_INCH;

function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cm * IN_PER_CM;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return { feet, inches };
}

function feetInchesToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * CM_PER_INCH;
}

function kgToLbs(kg: number): number {
  return Math.round(kg * LB_PER_KG * 10) / 10;
}

function lbsToKg(lbs: number): number {
  return Math.round(lbs * KG_PER_LB * 100) / 100;
}

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('biometrics');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Profile</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{user?.email}</p>
        </div>
        {user?.isAdmin && (
          <Link href="/admin" className="text-sm text-purple-600 hover:underline">
            Admin
          </Link>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 overflow-x-auto scrollbar-none" data-tutorial="profile-tab-bar">
        {([
          { key: 'biometrics' as Tab, label: 'Bio', icon: Activity },
          { key: 'photos' as Tab, label: 'Photos', icon: Camera },
          { key: 'security' as Tab, label: 'Security', icon: Shield },
          { key: 'settings' as Tab, label: 'Settings', icon: Settings },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-1 rounded-md py-2 px-2 text-xs font-medium transition-colors shrink-0 ${
              tab === key
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label}</span>
          </button>
        ))}
      </div>

      {tab === 'biometrics' && <BiometricsTab />}
      {tab === 'photos' && <PhotosTab />}
      {tab === 'security' && <SecurityTab />}
      {tab === 'settings' && <SettingsTab />}

      <Button variant="outline" onClick={logout} className="w-full">
        Sign Out
      </Button>
    </div>
  );
}

// ─── Biometrics Tab ────────────────────────────────────────────

function BiometricsTab() {
  const [bioTab, setBioTab] = useState<'profile' | 'measurements'>('profile');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiFetch<{ data: UserProfile }>('/users/me/profile'),
  });

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ data: UserSettings }>('/users/me/settings'),
  });

  const isImperial = settingsData?.data?.preferredUnits === 'IMPERIAL';

  const [form, setForm] = useState({
    heightCm: '',
    weightKg: '',
    feet: '',
    inches: '',
    weightLbs: '',
    age: '',
    birthDate: '' as string,
    useBirthDate: false,
    sex: '' as string,
    activityLevel: '' as string,
    goal: '' as string,
  });

  useEffect(() => {
    if (data?.data) {
      const p = data.data;
      const heightCm = p.heightCm ?? 0;
      const weightKg = p.weightKg ?? 0;
      const { feet, inches } = cmToFeetInches(heightCm);

      setForm({
        heightCm: p.heightCm?.toString() || '',
        weightKg: p.weightKg?.toString() || '',
        feet: heightCm ? feet.toString() : '',
        inches: heightCm ? inches.toString() : '',
        weightLbs: weightKg ? kgToLbs(weightKg).toString() : '',
        age: p.age?.toString() || '',
        birthDate: p.birthDate ? p.birthDate.slice(0, 10) : '',
        useBirthDate: !!p.birthDate,
        sex: p.sex || '',
        activityLevel: p.activityLevel || '',
        goal: p.goal || '',
      });
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/users/me/profile', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile'] }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    let heightCm: number | null = null;

    if (isImperial) {
      const feet = form.feet ? parseInt(form.feet) : 0;
      const inches = form.inches ? parseInt(form.inches) : 0;
      if (feet || inches) {
        heightCm = Math.round(feetInchesToCm(feet, inches) * 10) / 10;
      }
    } else {
      heightCm = form.heightCm ? parseFloat(form.heightCm) : null;
    }

    const body: Record<string, unknown> = {
      heightCm,
      sex: form.sex || null,
      activityLevel: form.activityLevel || null,
      goal: form.goal || null,
    };

    if (form.useBirthDate && form.birthDate) {
      body.birthDate = form.birthDate;
      body.age = null;
    } else {
      body.age = form.age ? parseInt(form.age) : null;
      body.birthDate = null;
    }

    mutation.mutate(body);
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1" data-tutorial="bio-sub-tabs">
        {([
          { key: 'profile' as const, label: 'Profile', icon: User },
          { key: 'measurements' as const, label: 'Measurements', icon: Ruler },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setBioTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 px-3 text-xs font-medium transition-colors ${
              bioTab === key
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {bioTab === 'measurements' && <MeasurementsTab />}

      {bioTab === 'profile' && (
      <div className="lg:grid lg:grid-cols-2 lg:gap-6 space-y-6 lg:space-y-0">
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {isImperial ? (
              <>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Height</label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Input
                        label=""
                        type="number"
                        placeholder="ft"
                        value={form.feet}
                        onChange={(e) => setForm({ ...form, feet: e.target.value })}
                      />
                      <span className="text-xs text-gray-500 dark:text-gray-400">feet</span>
                    </div>
                    <div className="flex-1">
                      <Input
                        label=""
                        type="number"
                        placeholder="in"
                        value={form.inches}
                        onChange={(e) => setForm({ ...form, inches: e.target.value })}
                      />
                      <span className="text-xs text-gray-500 dark:text-gray-400">inches</span>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Weight (lbs)</label>
                  <p className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
                    {form.weightLbs ? `${form.weightLbs}` : '—'}
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Log via Measurements tab</p>
                </div>
              </>
            ) : (
              <>
                <Input
                  label="Height (cm)"
                  type="number"
                  value={form.heightCm}
                  onChange={(e) => setForm({ ...form, heightCm: e.target.value })}
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Weight (kg)</label>
                  <p className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
                    {form.weightKg ? `${form.weightKg}` : '—'}
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Log via Measurements tab</p>
                </div>
              </>
            )}
            {form.useBirthDate ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Birthday</label>
                <input
                  type="date"
                  value={form.birthDate}
                  max={todayString()}
                  onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 appearance-none [-webkit-appearance:none] [&::-webkit-date-and-time-value]:text-left"
                />
                {form.birthDate && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Age: {Math.floor((Date.now() - new Date(form.birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setForm({ ...form, useBirthDate: false, birthDate: '' })}
                  className="mt-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  Use manual age instead
                </button>
              </div>
            ) : (
              <div>
                <Input
                  label="Age"
                  type="number"
                  value={form.age}
                  onChange={(e) => setForm({ ...form, age: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, useBirthDate: true, age: '' })}
                  className="mt-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  Use birthday instead
                </button>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sex</label>
              <select
                value={form.sex}
                onChange={(e) => setForm({ ...form, sex: e.target.value })}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
              >
                <option value="">Select</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Activity Level</label>
            <select
              value={form.activityLevel}
              onChange={(e) => setForm({ ...form, activityLevel: e.target.value })}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
            >
              <option value="">Select</option>
              {Object.entries(ACTIVITY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Training Goal</label>
            <select
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
            >
              <option value="">Select</option>
              {Object.entries(TRAINING_GOAL_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <Button type="submit" isLoading={mutation.isPending} className="w-full">
            Save Profile
          </Button>

          {mutation.isSuccess && (
            <p className="text-sm text-indigo-600 text-center">Profile saved!</p>
          )}
        </form>
      </Card>

      </div>
      )}
    </div>
  );
}

// ─── Security Tab ──────────────────────────────────────────────

function SecurityTab() {
  return (
    <div className="space-y-6">
      <PasskeyCard />
      <ChangePasswordCard />
    </div>
  );
}

interface PasskeyInfo {
  id: string;
  friendlyName: string | null;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

function PasskeyCard() {
  const queryClient = useQueryClient();
  const [friendlyName, setFriendlyName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { data: passkeysData, isLoading } = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => apiFetch<{ data: PasskeyInfo[] }>('/auth/passkey/list'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/auth/passkey/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['passkeys'] }),
  });

  async function handleRegister() {
    setError('');
    setSuccess('');
    setRegistering(true);
    try {
      const optionsRes = await apiFetch<{ data: any }>('/auth/passkey/register/options', {
        method: 'POST',
      });
      const regResponse = await startRegistration({ optionsJSON: optionsRes.data });
      await apiFetch('/auth/passkey/register/verify', {
        method: 'POST',
        body: JSON.stringify({
          response: regResponse,
          friendlyName: friendlyName.trim() || undefined,
        }),
      });

      setSuccess('Passkey registered successfully!');
      setFriendlyName('');
      queryClient.invalidateQueries({ queryKey: ['passkeys'] });
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Passkey registration was cancelled');
      } else {
        setError(err.message || 'Failed to register passkey');
      }
    } finally {
      setRegistering(false);
    }
  }

  const passkeys = passkeysData?.data ?? [];

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-semibold">Passkeys</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Sign in without a password using Face ID, Touch ID, or a security key.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : passkeys.length > 0 ? (
        <div className="space-y-2">
          {passkeys.map((pk) => (
            <div key={pk.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {pk.friendlyName || 'Passkey'}
                  {pk.deviceType && (
                    <span className="ml-1 text-xs text-gray-400">({pk.deviceType})</span>
                  )}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Added {new Date(pk.createdAt).toLocaleDateString()}
                  {pk.lastUsedAt && ` · Last used ${new Date(pk.lastUsedAt).toLocaleDateString()}`}
                </p>
              </div>
              <button
                onClick={() => deleteMutation.mutate(pk.id)}
                disabled={deleteMutation.isPending}
                className="ml-2 p-2 text-gray-400 hover:text-red-500 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400 dark:text-gray-500">No passkeys registered yet.</p>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="Passkey name (optional)"
          value={friendlyName}
          onChange={(e) => setFriendlyName(e.target.value)}
          className="flex-1"
        />
        <Button
          onClick={handleRegister}
          isLoading={registering}
          size="sm"
          className="whitespace-nowrap"
        >
          Add Passkey
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-indigo-600">{success}</p>}
    </Card>
  );
}

function ChangePasswordCard() {
  const { user } = useAuth();

  // Only show for LOCAL auth users
  if (user?.authProvider !== 'LOCAL') return null;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const mutation = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setSuccess('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to change password');
      setSuccess('');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    mutation.mutate({ currentPassword, newPassword });
  }

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-semibold">Change Password</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Update your account password.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          label="Current Password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <Input
          label="New Password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        <Input
          label="Confirm New Password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
        <Button type="submit" isLoading={mutation.isPending} className="w-full">
          Change Password
        </Button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-indigo-600">{success}</p>}
    </Card>
  );
}

// ─── Settings Tab ──────────────────────────────────────────────

const AI_PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: 'OPENAI', label: 'OpenAI' },
  { value: 'ANTHROPIC', label: 'Anthropic' },
  { value: 'GEMINI', label: 'Google Gemini' },
];

const AI_KEY_LINKS: { provider: string; url: string; label: string }[] = [
  { provider: 'OpenAI', url: 'https://platform.openai.com/api-keys', label: 'Get OpenAI API key' },
  { provider: 'Anthropic', url: 'https://console.anthropic.com/settings/keys', label: 'Get Anthropic API key' },
  { provider: 'Google Gemini', url: 'https://aistudio.google.com/apikey', label: 'Get Gemini API key' },
];

function AiProviderInfoPopover() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        aria-label="How to get API keys"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Popover */}
          <div className="absolute left-0 top-8 z-50 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
              AI features require your own API key (BYOAI). Get one from your preferred provider:
            </p>
            <div className="space-y-1.5">
              {AI_KEY_LINKS.map(({ provider, url, label }) => (
                <a
                  key={provider}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-gray-700 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  {label}
                </a>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              Keys are encrypted with AES-256-GCM and stored securely on the server.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function SettingsTab() {
  const queryClient = useQueryClient();
  const { isDark, toggle } = useTheme();

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ data: UserSettings }>('/users/me/settings'),
  });

  const [aiProvider, setAiProvider] = useState<AiProvider>('OPENAI');
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [preferredUnits, setPreferredUnits] = useState('METRIC');
  const [timezone, setTimezone] = useState<string | null>(null);
  const [location, setLocation] = useState('');
  const [tzAutoDetected, setTzAutoDetected] = useState(false);

  useEffect(() => {
    if (data?.data) {
      setPreferredUnits(data.data.preferredUnits);
      setTimezone(data.data.timezone);
      setLocation(data.data.location ?? '');
      setAiProvider(data.data.aiProvider ?? 'OPENAI');
    }
  }, [data]);

  // Auto-detect timezone on first load if not set
  useEffect(() => {
    if (data?.data && data.data.timezone === null && !tzAutoDetected) {
      const detected = getBrowserTimezone();
      setTimezone(detected);
      setTzAutoDetected(true);
      mutation.mutate({ timezone: detected });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tzAutoDetected]);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/users/me/settings', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const darkModeMutation = useMutation({
    mutationFn: (dark: boolean) =>
      apiFetch('/users/me/settings', { method: 'PUT', body: JSON.stringify({ darkMode: dark }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  function handleSaveAiKey(provider: AiProvider, key: string) {
    if (!key.trim()) return;
    const keyMap: Record<AiProvider, string> = {
      OPENAI: 'openaiApiKey',
      ANTHROPIC: 'anthropicApiKey',
      GEMINI: 'geminiApiKey',
    };
    mutation.mutate({ [keyMap[provider]]: key.trim() });
    if (provider === 'OPENAI') setOpenaiKey('');
    if (provider === 'ANTHROPIC') setAnthropicKey('');
    if (provider === 'GEMINI') setGeminiKey('');
  }

  function handleSwitchProvider(provider: AiProvider) {
    setAiProvider(provider);
    mutation.mutate({ aiProvider: provider });
  }

  function handleSaveUnits() {
    mutation.mutate({ preferredUnits });
  }

  function handleToggleDarkMode() {
    const newDark = !isDark;
    toggle();
    darkModeMutation.mutate(newDark);
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }

  return (
    <div className="space-y-6 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0">
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Dark Mode</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Switch between light and dark theme</p>
          </div>
          <button
            onClick={handleToggleDarkMode}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              isDark ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                isDark ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </Card>

      <Card className="space-y-4 lg:col-span-2">
        <div className="flex items-center gap-1.5">
          <h2 className="font-semibold">AI Provider</h2>
          <AiProviderInfoPopover />
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Choose your AI provider for macro plans, meal plans, and label scanning. Bring your own API key (BYOAI).
        </p>

        <div className="flex gap-1.5 flex-wrap">
          {AI_PROVIDERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handleSwitchProvider(value)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                aiProvider === value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {/* OpenAI */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">OpenAI</span>
              {data?.data.hasOpenaiKey && <span className="text-xs text-indigo-600 bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.5 rounded">Configured</span>}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleSaveAiKey('OPENAI', openaiKey); }} className="flex gap-2">
              <Input
                placeholder={data?.data.hasOpenaiKey ? 'Enter new key to replace' : 'sk-...'}
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" size="sm" isLoading={mutation.isPending} disabled={!openaiKey.trim()}>
                Save
              </Button>
            </form>
          </div>

          {/* Anthropic */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Anthropic</span>
              {data?.data.hasAnthropicKey && <span className="text-xs text-indigo-600 bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.5 rounded">Configured</span>}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleSaveAiKey('ANTHROPIC', anthropicKey); }} className="flex gap-2">
              <Input
                placeholder={data?.data.hasAnthropicKey ? 'Enter new key to replace' : 'sk-ant-...'}
                type="password"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" size="sm" isLoading={mutation.isPending} disabled={!anthropicKey.trim()}>
                Save
              </Button>
            </form>
          </div>

          {/* Gemini */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Google Gemini</span>
              {data?.data.hasGeminiKey && <span className="text-xs text-indigo-600 bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.5 rounded">Configured</span>}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleSaveAiKey('GEMINI', geminiKey); }} className="flex gap-2">
              <Input
                placeholder={data?.data.hasGeminiKey ? 'Enter new key to replace' : 'AI...'}
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" size="sm" isLoading={mutation.isPending} disabled={!geminiKey.trim()}>
                Save
              </Button>
            </form>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">Units</h2>
        <div className="flex gap-2">
          {(['METRIC', 'IMPERIAL'] as const).map((unit) => (
            <button
              key={unit}
              onClick={() => setPreferredUnits(unit)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                preferredUnits === unit
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {unit === 'METRIC' ? 'Metric (kg, cm)' : 'Imperial (lbs, in)'}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={handleSaveUnits}>
          Save Units
        </Button>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">Timezone & Location</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Set your timezone for accurate date handling. Location is optional.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Timezone
            </label>
            <TimezoneCombobox value={timezone} onChange={setTimezone} />
            {timezone && (
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Current: {formatTimezoneLabel(timezone)}
              </p>
            )}
          </div>
          <Input
            label="Location"
            placeholder="e.g. New York, NY"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const body: Record<string, unknown> = {};
            if (timezone) body.timezone = timezone;
            body.location = location.trim() || null;
            mutation.mutate(body);
          }}
        >
          Save Timezone & Location
        </Button>
      </Card>


      {mutation.isSuccess && (
        <p className="text-sm text-indigo-600 text-center lg:col-span-2">Settings saved!</p>
      )}

      <div className="lg:col-span-2">
        <ExportCard />
      </div>

      <div className="lg:col-span-2">
        <ImportCard />
      </div>

      <div className="lg:col-span-2">
        <RestartTutorialCard />
      </div>

      <div className="lg:col-span-2">
        <FeedbackCard />
      </div>
    </div>
  );
}

// ─── Measurements Tab ─────────────────────────────────────────

const MEASUREMENT_FIELDS = [
  { key: 'waist', label: 'Waist' },
  { key: 'hip', label: 'Hip' },
  { key: 'abdomen', label: 'Abdomen' },
  { key: 'chest', label: 'Chest' },
  { key: 'thighR', label: 'Thigh (R)' },
  { key: 'thighL', label: 'Thigh (L)' },
  { key: 'bicepR', label: 'Bicep (R)' },
  { key: 'bicepL', label: 'Bicep (L)' },
  { key: 'neck', label: 'Neck' },
  { key: 'calfR', label: 'Calf (R)' },
  { key: 'calfL', label: 'Calf (L)' },
  { key: 'shoulder', label: 'Shoulder' },
] as const;

// Fields that aren't length-based (need different unit handling)
const EXTRA_FIELDS = [
  { key: 'weightKg', label: 'Weight', unitMetric: 'kg', unitImperial: 'lbs' },
  { key: 'bodyFatPct', label: 'Body Fat', unit: '%' },
  { key: 'leanMassKg', label: 'Lean Mass', unitMetric: 'kg', unitImperial: 'lbs' },
] as const;

function MeasurementsTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ data: { preferredUnits: string } }>('/users/me/settings'),
  });

  const isImperial = settingsData?.data?.preferredUnits === 'IMPERIAL';
  const unitLabel = isImperial ? 'in' : 'cm';

  const { data, isLoading } = useQuery({
    queryKey: ['measurements', page],
    queryFn: () =>
      apiFetch<{ data: BodyMeasurement[]; meta: { page: number; totalPages: number } }>(
        `/measurements?page=${page}&limit=10`,
      ),
  });

  const [measuredAt, setMeasuredAt] = useState(todayString());
  const [notes, setNotes] = useState('');
  const allFieldKeys = [...MEASUREMENT_FIELDS.map(f => f.key), ...EXTRA_FIELDS.map(f => f.key)];
  const emptyFields = () => Object.fromEntries(allFieldKeys.map((k) => [k, '']));
  const [fields, setFields] = useState<Record<string, string>>(emptyFields);

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/measurements', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['measurements'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setFields(emptyFields());
      setNotes('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/measurements/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['measurements'] }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { measuredAt };
    if (notes.trim()) body.notes = notes.trim();

    // Length-based fields: convert inches → cm when imperial
    for (const { key } of MEASUREMENT_FIELDS) {
      const val = fields[key];
      if (val) {
        const num = parseFloat(val);
        body[key] = isImperial ? Math.round(num * CM_PER_INCH * 100) / 100 : num;
      }
    }

    // Weight: convert lbs → kg when imperial
    if (fields.weightKg) {
      const num = parseFloat(fields.weightKg);
      body.weightKg = isImperial ? lbsToKg(num) : num;
    }

    // Body fat % — no conversion needed
    if (fields.bodyFatPct) body.bodyFatPct = parseFloat(fields.bodyFatPct);

    // Lean mass: convert lbs → kg when imperial
    if (fields.leanMassKg) {
      const num = parseFloat(fields.leanMassKg);
      body.leanMassKg = isImperial ? lbsToKg(num) : num;
    }

    createMutation.mutate(body);
  }

  // Convert cm values for display when imperial
  function displayVal(cmVal: number | null): string {
    if (cmVal == null) return '-';
    if (isImperial) return (cmVal * IN_PER_CM).toFixed(1);
    return cmVal.toFixed(1);
  }

  const measurements = data?.data ?? [];
  const latest = measurements[0];
  const totalPages = data?.meta?.totalPages ?? 1;

  // Ratios from latest measurement
  const waistToHip =
    latest?.waist && latest?.hip ? (latest.waist / latest.hip).toFixed(2) : null;
  const chestToHip =
    latest?.chest && latest?.hip ? (latest.chest / latest.hip).toFixed(2) : null;
  const waistToChest =
    latest?.waist && latest?.chest ? (latest.waist / latest.chest).toFixed(2) : null;

  if (isLoading) {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Add measurement form */}
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <h3 className="font-semibold">New Measurement</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
            <input
              type="date"
              value={measuredAt}
              max={todayString()}
              onChange={(e) => setMeasuredAt(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 appearance-none [-webkit-appearance:none] [&::-webkit-date-and-time-value]:text-left"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {MEASUREMENT_FIELDS.map(({ key, label }) => (
              <Input
                key={key}
                label={`${label} (${unitLabel})`}
                type="number"
                step="0.1"
                value={fields[key]}
                onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input
              label={`Weight (${isImperial ? 'lbs' : 'kg'})`}
              type="number"
              step="0.1"
              value={fields.weightKg}
              onChange={(e) => setFields({ ...fields, weightKg: e.target.value })}
            />
            <Input
              label="Body Fat (%)"
              type="number"
              step="0.1"
              value={fields.bodyFatPct}
              onChange={(e) => setFields({ ...fields, bodyFatPct: e.target.value })}
            />
            <Input
              label={`Lean Mass (${isImperial ? 'lbs' : 'kg'})`}
              type="number"
              step="0.1"
              value={fields.leanMassKg}
              onChange={(e) => setFields({ ...fields, leanMassKg: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              rows={2}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
            />
          </div>
          <Button type="submit" isLoading={createMutation.isPending} className="w-full">
            Save Measurement
          </Button>
          {createMutation.isSuccess && (
            <p className="text-sm text-indigo-600 text-center">Measurement saved!</p>
          )}
          {createMutation.isError && (
            <p className="text-sm text-red-600 text-center">
              {(createMutation.error as any)?.message || 'Failed to save measurement'}
            </p>
          )}
        </form>
      </Card>

      {/* Ratios card */}
      {(waistToHip || chestToHip || waistToChest) && (
        <Card>
          <h3 className="font-semibold mb-3">Body Ratios (latest)</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            {waistToHip && (
              <div>
                <p className="text-gray-500 dark:text-gray-400">Waist : Hip</p>
                <p className="font-medium text-lg">{waistToHip}</p>
              </div>
            )}
            {chestToHip && (
              <div>
                <p className="text-gray-500 dark:text-gray-400">Chest : Hip</p>
                <p className="font-medium text-lg">{chestToHip}</p>
              </div>
            )}
            {waistToChest && (
              <div>
                <p className="text-gray-500 dark:text-gray-400">Waist : Chest</p>
                <p className="font-medium text-lg">{waistToChest}</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* History */}
      {measurements.length > 0 ? (
        <Card>
          <h3 className="font-semibold mb-3">History</h3>
          <div className="space-y-3">
            {measurements.map((m) => (
              <div
                key={m.id}
                className="flex items-start justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {new Date(m.measuredAt).toLocaleDateString()}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {m.waist != null && <span>Waist: {displayVal(m.waist)}{unitLabel}</span>}
                    {m.hip != null && <span>Hip: {displayVal(m.hip)}{unitLabel}</span>}
                    {m.chest != null && <span>Chest: {displayVal(m.chest)}{unitLabel}</span>}
                    {m.neck != null && <span>Neck: {displayVal(m.neck)}{unitLabel}</span>}
                    {m.shoulder != null && <span>Shoulder: {displayVal(m.shoulder)}{unitLabel}</span>}
                    {m.weightKg != null && <span className="font-medium">Wt: {isImperial ? kgToLbs(m.weightKg).toFixed(1) + 'lbs' : m.weightKg.toFixed(1) + 'kg'}</span>}
                    {m.bodyFatPct != null && <span>BF: {m.bodyFatPct.toFixed(1)}%</span>}
                    {m.leanMassKg != null && <span>Lean: {isImperial ? kgToLbs(m.leanMassKg).toFixed(1) + 'lbs' : m.leanMassKg.toFixed(1) + 'kg'}</span>}
                  </div>
                  {m.notes && (
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 italic">{m.notes}</p>
                  )}
                </div>
                <button
                  onClick={() => deleteMutation.mutate(m.id)}
                  disabled={deleteMutation.isPending}
                  className="ml-2 p-2 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Prev
              </Button>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
            No measurements recorded yet. Add your first one above!
          </p>
        </Card>
      )}
    </div>
  );
}

// ─── Photos Tab ───────────────────────────────────────────────

function PhotoCard({ photo, onDelete, onView }: { photo: ProgressPhotoMeta; onDelete: (id: string) => void; onView: (url: string, photo: ProgressPhotoMeta) => void }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadImage() {
      try {
        const res = await fetch(getApiUrl() + '/progress-photos/' + photo.id + '/image', {
          headers: { Authorization: 'Bearer ' + getAccessToken() },
        });
        if (!res.ok) throw new Error('Failed to load image');
        const blob = await res.blob();
        if (!cancelled) {
          setImageUrl(URL.createObjectURL(blob));
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadImage();
    return () => {
      cancelled = true;
    };
  }, [photo.id]);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        type="button"
        onClick={() => imageUrl && onView(imageUrl, photo)}
        className="aspect-square w-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center cursor-pointer"
        disabled={!imageUrl}
      >
        {loading ? (
          <Spinner />
        ) : imageUrl ? (
          <img src={imageUrl} alt="Progress" className="w-full h-full object-cover" />
        ) : (
          <p className="text-xs text-gray-400">Failed to load</p>
        )}
      </button>
      <div className="p-2">
        <p className="text-xs font-medium">{new Date(photo.takenAt).toLocaleDateString()}</p>
        {photo.notes && (
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{photo.notes}</p>
        )}
        {confirmDelete ? (
          <div className="flex gap-1 mt-1">
            <button
              onClick={() => onDelete(photo.id)}
              className="text-xs text-red-600 hover:underline"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-gray-500 hover:underline"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="mt-1 p-1 text-gray-400 hover:text-red-500 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function PhotosTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [takenAt, setTakenAt] = useState(todayString());
  const [photoNotes, setPhotoNotes] = useState('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; photo: ProgressPhotoMeta } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['progress-photos', page],
    queryFn: () =>
      apiFetch<{ data: ProgressPhotoMeta[]; meta: { page: number; totalPages: number } }>(
        `/progress-photos?page=${page}&limit=12`,
      ),
  });

  const uploadMutation = useMutation({
    mutationFn: (body: { takenAt: string; notes?: string; image: string }) =>
      apiFetch('/progress-photos', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['progress-photos'] });
      setImageBase64(null);
      setPhotoNotes('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/progress-photos/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['progress-photos'] }),
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressing(true);
    try {
      const base64 = await compressImage(file);
      setImageBase64(base64);
    } catch {
      // ignore
    } finally {
      setCompressing(false);
    }
  }

  function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!imageBase64) return;
    const body: { takenAt: string; notes?: string; image: string } = {
      takenAt,
      image: imageBase64,
    };
    if (photoNotes.trim()) body.notes = photoNotes.trim();
    uploadMutation.mutate(body);
  }

  const photos = data?.data ?? [];
  const totalPages = data?.meta?.totalPages ?? 1;

  if (isLoading) {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Upload form */}
      <Card>
        <form onSubmit={handleUpload} className="space-y-4">
          <h3 className="font-semibold">Upload Progress Photo</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Photo</label>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 dark:file:bg-indigo-950 dark:file:text-indigo-300"
            />
            {compressing && <p className="text-xs text-gray-400 mt-1">Compressing image...</p>}
            {imageBase64 && !compressing && (
              <img src={imageBase64} alt="Preview" className="mt-2 h-32 rounded-lg object-cover" />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
            <input
              type="date"
              value={takenAt}
              max={todayString()}
              onChange={(e) => setTakenAt(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 appearance-none [-webkit-appearance:none] [&::-webkit-date-and-time-value]:text-left"
            />
          </div>
          <Input
            label="Notes (optional)"
            value={photoNotes}
            onChange={(e) => setPhotoNotes(e.target.value)}
            placeholder="e.g. Front pose, morning"
          />
          <Button
            type="submit"
            isLoading={uploadMutation.isPending}
            disabled={!imageBase64 || compressing}
            className="w-full"
          >
            Upload Photo
          </Button>
          {uploadMutation.isSuccess && (
            <p className="text-sm text-indigo-600 text-center">Photo uploaded!</p>
          )}
          {uploadMutation.isError && (
            <p className="text-sm text-red-600 text-center">
              {(uploadMutation.error as any)?.message || 'Failed to upload photo'}
            </p>
          )}
        </form>
      </Card>

      {/* Gallery */}
      {photos.length > 0 ? (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                onDelete={(id) => deleteMutation.mutate(id)}
                onView={(url, p) => setLightbox({ url, photo: p })}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Prev
              </Button>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Card>
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
            No progress photos yet. Upload your first one above!
          </p>
        </Card>
      )}

      {/* Lightbox modal */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white z-10"
          >
            <X className="h-6 w-6" />
          </button>
          <div
            className="relative max-w-3xl max-h-[90vh] w-full flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightbox.url}
              alt="Progress photo"
              className="max-h-[80vh] w-auto rounded-lg object-contain"
            />
            <div className="mt-3 text-center text-sm text-white/80">
              <p className="font-medium">{new Date(lightbox.photo.takenAt).toLocaleDateString()}</p>
              {lightbox.photo.notes && <p className="text-white/60">{lightbox.photo.notes}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Import Card ───────────────────────────────────────────────

function ImportCard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ workoutsCreated: number; setsCreated: number; exercisesCreated: number; skipped: number } | null>(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setSummary(null);
    setError('');
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target?.result as string);
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!csvText) return;
    setImporting(true);
    setError('');
    try {
      const res = await apiFetch<{ data: { workoutsCreated: number; setsCreated: number; exercisesCreated: number; skipped: number } }>(
        '/workouts/import-csv',
        { method: 'POST', body: JSON.stringify({ csv: csvText }) },
      );
      setSummary(res.data);
      setCsvText(null);
      setFileName(null);
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card className="space-y-4">
      <h3 className="font-semibold">Import Workouts</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Upload a CSV export from your previous fitness app to import your workout history.
      </p>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 px-4 py-4 text-sm transition-colors hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/20"
      >
        <span className="font-medium text-gray-700 dark:text-gray-300">
          {fileName ? fileName : 'Click to select a CSV file'}
        </span>
      </button>
      <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
      {csvText && (
        <Button variant="outline" onClick={handleImport} isLoading={importing} className="w-full">
          Import Workouts
        </Button>
      )}
      {summary && (
        <p className="text-sm text-green-600 dark:text-green-400">
          Imported {summary.workoutsCreated} workout{summary.workoutsCreated !== 1 ? 's' : ''},{' '}
          {summary.setsCreated} sets
          {summary.skipped > 0 ? ` (${summary.skipped} sessions skipped — already imported)` : ''}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Card>
  );
}

// ─── Export Card ───────────────────────────────────────────────

function ExportCard() {
  const [from, setFrom] = useState(addDays(todayString(), -30));
  const [to, setTo] = useState(todayString());
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  async function handleExport() {
    setExporting(true);
    setError('');
    try {
      const res = await apiFetch<{ data: any[] }>(`/workouts/range?from=${from}&to=${to}&limit=500`);
      const entries = res.data;
      if (entries.length === 0) {
        setError('No workouts found for this date range.');
        return;
      }

      const headers = ['Date', 'Workout', 'Type', 'Sets', 'Duration (min)', 'Notes'];
      const rows = entries.map((e: any) => [
        e.logDate?.split('T')[0] ?? '',
        e.name ?? '',
        e.workoutType ?? '',
        e.sets?.length ?? 0,
        e.durationMin ?? '',
        e.notes ?? '',
      ]);

      const csvContent = [headers, ...rows]
        .map((row) =>
          row.map((cell: any) => {
            const str = String(cell);
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          }).join(','),
        )
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workouts-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card className="space-y-4">
      <h3 className="font-semibold">Export Workouts</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Download your workout history as a CSV file.
      </p>
      <div className="flex gap-2 items-end overflow-hidden">
        <div className="flex-1 min-w-0">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">From</label>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-2 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 appearance-none [-webkit-appearance:none] [&::-webkit-date-and-time-value]:text-left"
          />
        </div>
        <div className="flex-1 min-w-0">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">To</label>
          <input
            type="date"
            value={to}
            max={todayString()}
            onChange={(e) => setTo(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-2 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 appearance-none [-webkit-appearance:none] [&::-webkit-date-and-time-value]:text-left"
          />
        </div>
      </div>
      <Button variant="outline" onClick={handleExport} isLoading={exporting} className="w-full">
        Export to CSV
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Card>
  );
}

// ─── Restart Tutorial Card ────────────────────────────────────

function RestartTutorialCard() {
  return (
    <Card className="space-y-3">
      <h3 className="font-semibold">App Tutorial</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Take a guided tour of FitTrackr&apos;s features.
      </p>
      <Button
        variant="outline"
        onClick={() => {
          localStorage.removeItem('FitTrackr-tutorial-complete');
          window.dispatchEvent(new CustomEvent('tutorial-restart'));
        }}
        className="w-full"
      >
        <GraduationCap className="h-4 w-4 mr-2" />
        Restart Tutorial
      </Button>
    </Card>
  );
}

// ─── Feedback Card ────────────────────────────────────────────

function FeedbackCard() {
  return (
    <Card className="space-y-3">
      <h3 className="font-semibold">Send Feedback</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Found a bug or have a feature request? We&apos;d love to hear from you.
      </p>
      <Button
        variant="outline"
        onClick={() => {
          window.location.href = 'mailto:fittrackr@geehive.com?subject=FitTrackr Feedback';
        }}
        className="w-full"
      >
        <MessageSquare className="h-4 w-4 mr-2" />
        Send Feedback
      </Button>
    </Card>
  );
}
