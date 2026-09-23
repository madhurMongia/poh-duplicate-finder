import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { fetchProfilePreview, IPFS_GATEWAY, type ProfilePreview } from '../api';
import { ExternalLinkIcon } from './ExternalLinkIcon';

export type LookupRequest = { kind: 'photo'; photo: File } | { kind: 'profile'; profile: string };

interface Props {
  disabled: boolean;
  onSubmit(request: LookupRequest): void;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

// Mirrors core's parseProfileRef: first 40-hex-char run (optionally 0x-prefixed),
// so pasted pohIds, addresses, and profile URLs all work.
const PROFILE_REF = /(?:0x)?([0-9a-f]{40})(?![0-9a-f])/i;

function parseRef(input: string): string | null {
  const match = PROFILE_REF.exec(input);
  return match ? `0x${match[1].toLowerCase()}` : null;
}

export function LookupForm({ disabled, onSubmit }: Props) {
  const [tab, setTab] = useState<'profile' | 'photo'>('profile');
  const [profile, setProfile] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<ProfilePreview | null>(null);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'missing'>('idle');
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ref = tab === 'profile' ? parseRef(profile) : null;
    if (!ref) {
      setPreview(null);
      setPreviewState('idle');
      return;
    }
    setPreviewState('loading');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchProfilePreview(ref, controller.signal)
        .then((result) => {
          setPreview(result);
          setPreviewState(result ? 'idle' : 'missing');
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setPreview(null);
            setPreviewState('idle');
          }
        });
    }, 400); // debounce keystrokes; abort stale requests on change
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tab, profile]);

  function pickPhoto(file: File | null) {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhoto(null);
    setPhotoPreview(null);
    setPhotoError(null);
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setPhotoError('Only JPEG or PNG photos are supported.');
    } else if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError(`Photo is too large (${(file.size / 1024 / 1024).toFixed(1)} MB); max 6 MB.`);
    } else {
      setPhoto(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    pickPhoto(event.dataTransfer.files?.[0] ?? null);
  }

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
        <>
          <input
            type="text"
            placeholder="0x… pohId, address, or v2.proofofhumanity.id profile URL"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          {previewState === 'loading' && (
            <div className="profile-preview pending">
              <span className="spinner" aria-hidden /> Looking up profile…
            </div>
          )}
          {previewState === 'missing' && (
            <div className="profile-preview missing">No PoH v2 profile found for this ref.</div>
          )}
          {previewState === 'idle' && preview && (
            <div className="profile-preview">
              {preview.photoUri && (
                <img src={`${IPFS_GATEWAY}${preview.photoUri}`} alt={preview.name ?? 'profile'} />
              )}
              <div className="profile-preview-info">
                <strong>{preview.name ?? 'Unnamed profile'}</strong>
                <span className="meta">
                  <span className="chip">{preview.chain}</span>
                  <code>{`${preview.humanityId.slice(0, 10)}…${preview.humanityId.slice(-6)}`}</code>
                </span>
                <a href={preview.profileUrl} target="_blank" rel="noreferrer">
                  View profile <ExternalLinkIcon />
                </a>
              </div>
            </div>
          )}
        </>
      ) : photo && photoPreview ? (
        <div className="photo-preview">
          <img src={photoPreview} alt="selected" />
          <span className="file-name">{photo.name}</span>
          <button
            type="button"
            className="clear"
            onClick={() => pickPhoto(null)}
            disabled={disabled}
          >
            Remove
          </button>
        </div>
      ) : (
        <div
          className={dragging ? 'dropzone dragging' : 'dropzone'}
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInput.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div>
            <strong>Drop a photo here</strong> or click to browse
          </div>
          <div className="hint">JPEG or PNG up to 6 MB · one clearly visible face</div>
          {photoError && (
            <div className="hint photo-error" role="alert">
              {photoError}
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            hidden
            onChange={(e) => {
              pickPhoto(e.target.files?.[0] ?? null);
              e.target.value = ''; // allow re-selecting the same file after Remove
            }}
            disabled={disabled}
          />
        </div>
      )}

      <button
        type="submit"
        className="primary"
        aria-busy={disabled}
        disabled={disabled || (tab === 'profile' ? !profile.trim() : !photo)}
      >
        {disabled && <span className="spinner spinner-on-accent" aria-hidden />}
        {disabled ? 'Searching the registry…' : 'Find duplicates'}
      </button>
    </form>
  );
}
