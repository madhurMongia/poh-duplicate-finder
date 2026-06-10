import { useState, type FormEvent } from 'react';

export type LookupRequest = { kind: 'photo'; photo: File } | { kind: 'profile'; profile: string };

interface Props {
  disabled: boolean;
  onSubmit(request: LookupRequest): void;
}

export function LookupForm({ disabled, onSubmit }: Props) {
  const [tab, setTab] = useState<'profile' | 'photo'>('profile');
  const [profile, setProfile] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (tab === 'profile' && profile.trim()) {
      onSubmit({ kind: 'profile', profile: profile.trim() });
    } else if (tab === 'photo' && photo) {
      onSubmit({ kind: 'photo', photo });
    }
  }

  return (
    <form className="lookup-form" onSubmit={submit}>
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'profile'}
          className={tab === 'profile' ? 'tab active' : 'tab'}
          onClick={() => setTab('profile')}
        >
          Profile ID / URL
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'photo'}
          className={tab === 'photo' ? 'tab active' : 'tab'}
          onClick={() => setTab('photo')}
        >
          Upload photo
        </button>
      </div>

      {tab === 'profile' ? (
        <input
          type="text"
          placeholder="0x… pohId, address, or v2.proofofhumanity.id profile URL"
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          disabled={disabled}
        />
      ) : (
        <input
          type="file"
          accept="image/jpeg,image/png"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          disabled={disabled}
        />
      )}

      <button
        type="submit"
        className="primary"
        disabled={disabled || (tab === 'profile' ? !profile.trim() : !photo)}
      >
        Find duplicates
      </button>
    </form>
  );
}
