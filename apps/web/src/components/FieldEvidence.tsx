import { useEffect, useRef, useState } from 'react';
import { useSealLoad, usePhotoBlob, useUploadPhotos } from '../features/fieldwork/hooks';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { shrinkPhoto } from '../lib/image';
import type { Collection, CollectionPhoto } from '../lib/types';
import { Alert, Button, Card, Dialog, Spinner } from './ui';

const MAX_PHOTOS = 8;
const PER_UPLOAD = 4;

/** Loads one photo (with the sign-in token) and shows it as an image. */
function useObjectUrl(collectionId: string, photoId: string) {
  const { data: blob, isError } = usePhotoBlob(collectionId, photoId);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return { url, failed: isError };
}

function Thumb({ collectionId, photo, onOpen }: { collectionId: string; photo: CollectionPhoto; onOpen: () => void }) {
  const { url, failed } = useObjectUrl(collectionId, photo.id);
  return (
    <button type="button" onClick={onOpen} disabled={!url} className="aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700">
      {url ? <img src={url} alt={photo.caption ?? `Photo by ${photo.by}`} className="size-full object-cover" /> : <span className="text-xs text-slate-500">{failed ? 'Unavailable' : 'Loading…'}</span>}
    </button>
  );
}

function FullPhoto({ collectionId, photo }: { collectionId: string; photo: CollectionPhoto }) {
  const { url } = useObjectUrl(collectionId, photo.id);
  return url ? <img src={url} alt={photo.caption ?? `Photo by ${photo.by}`} className="max-h-[70vh] w-full rounded-md object-contain" /> : <Spinner label="Loading photo" />;
}

/**
 * Photos and the seal for a collection. Everyone who can open the job sees the photos (so the purchase manager can check them).
 * The field officer adds photos and seals; the seal code is shown only to the field officer and the purchase manager.
 */
export function FieldEvidence({ collection: c, role }: { collection: Collection; role: string }) {
  const upload = useUploadPhotos(c.id);
  const seal = useSealLoad(c.id);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<CollectionPhoto | null>(null);

  if (c.status === 'CANCELLED') return null;

  const isFieldOfficer = role === 'FIELD_OFFICER';
  const atFarm = c.status === 'PICKED_UP' || c.status === 'LOADED';
  const canAdd = isFieldOfficer && atFarm && !c.sealed && c.photos.length < MAX_PHOTOS;
  const canSeal = isFieldOfficer && c.status === 'LOADED' && !c.sealed && c.photos.length > 0;

  const onPick = async (list: FileList | null) => {
    const chosen = Array.from(list ?? []).slice(0, Math.min(PER_UPLOAD, MAX_PHOTOS - c.photos.length));
    if (inputRef.current) inputRef.current.value = '';
    if (chosen.length === 0) return;
    setError(null);
    try {
      await upload.mutateAsync({ files: await Promise.all(chosen.map((f) => shrinkPhoto(f))) });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const doSeal = async () => {
    setError(null);
    try {
      await seal.mutateAsync(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Field evidence</h2>
        {canAdd && (
          <>
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="Choose photos" onChange={(e) => void onPick(e.target.files)} />
            <Button variant="secondary" onClick={() => inputRef.current?.click()} loading={upload.isPending}>Add photos</Button>
          </>
        )}
      </div>
      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}

      {c.photos.length === 0 ? (
        <p className="text-sm text-slate-600">{isFieldOfficer ? 'No photos yet. Add photos of the prawns and the loaded vehicle once the transport officer has picked up.' : 'No photos have been added yet.'}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {c.photos.map((p) => <Thumb key={p.id} collectionId={c.id} photo={p} onOpen={() => setOpen(p)} />)}
        </div>
      )}
      {c.photos.length > 0 && <p className="mt-2 text-xs text-slate-500">{c.photos.length} of {MAX_PHOTOS} photos · added by {c.photos[0]?.by}</p>}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="mb-2 text-sm font-semibold">Seal</h3>
        {c.sealed ? (
          <div className="space-y-2 text-sm">
            <p>Sealed by <strong>{c.sealedBy}</strong>{c.sealedAt ? ` on ${formatDateTime(c.sealedAt)}` : ''}.</p>
            {c.sealCode ? (
              <>
                <p className="select-all rounded-md bg-slate-100 px-3 py-2 text-center font-mono text-xl font-semibold tracking-widest" aria-label="Seal code">{c.sealCode}</p>
                <p className="text-xs text-slate-500">Write this code on the seal. Do not share it with the driver or the gate. The security officer has to type it from the seal at check-in, and the server checks it.</p>
              </>
            ) : <p className="text-xs text-slate-500">The code is kept private. The security officer enters it from the seal at the factory gate.</p>}
          </div>
        ) : (
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              {canSeal ? 'The vehicle is loaded and photographed. Seal the load to let the driver dispatch.'
                : isFieldOfficer ? (c.status === 'LOADED' ? 'Add at least one photo, then seal the load.' : 'You can seal the load once the transport officer has loaded the vehicle.')
                : 'Not sealed yet. The field officer seals the load after loading.'}
            </p>
            {canSeal && <Button onClick={() => void doSeal()} loading={seal.isPending}>Seal the load</Button>}
          </div>
        )}
      </div>

      <Dialog open={open !== null} title={open?.caption ?? 'Photo'} onClose={() => setOpen(null)}>
        {open && <FullPhoto collectionId={c.id} photo={open} />}
        {open && <p className="mt-2 text-xs text-slate-500">{open.by} · {formatDateTime(open.at)}</p>}
      </Dialog>
    </Card>
  );
}
