import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const CROP_SIZE = 288;
const OUTPUT_SIZE = 512;
const MAX_OUTPUT_SIZE = 2 * 1024 * 1024;

function getImageLayout(imageSize, zoom) {
  const scale =
    (CROP_SIZE / Math.min(imageSize.width, imageSize.height)) * zoom;
  return {
    scale,
    width: imageSize.width * scale,
    height: imageSize.height * scale,
  };
}

function clampPosition(position, layout) {
  return {
    x: Math.min(0, Math.max(CROP_SIZE - layout.width, position.x)),
    y: Math.min(0, Math.max(CROP_SIZE - layout.height, position.y)),
  };
}

function canvasToFile(canvas) {
  return new Promise((resolve, reject) => {
    const qualities = [0.9, 0.82, 0.74];
    const encode = (index) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Unable to create the cropped profile photo.'));
            return;
          }
          if (blob.size > MAX_OUTPUT_SIZE && index < qualities.length - 1) {
            encode(index + 1);
            return;
          }
          if (blob.size > MAX_OUTPUT_SIZE) {
            reject(new Error('The cropped photo is still too large. Choose a smaller image.'));
            return;
          }
          resolve(new File([blob], 'visitor-profile.jpg', { type: 'image/jpeg' }));
        },
        'image/jpeg',
        qualities[index]
      );
    };
    encode(0);
  });
}

export default function VisitorProfilePhotoCropDialog({ file, onCancel, onApply }) {
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const [imageSize, setImageSize] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [error, setError] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [sourceUrl] = useState(() => URL.createObjectURL(file));

  useEffect(() => () => URL.revokeObjectURL(sourceUrl), [sourceUrl]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isApplying) onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isApplying, onCancel]);

  const layout = imageSize ? getImageLayout(imageSize, zoom) : null;

  const handleImageLoad = (event) => {
    const size = {
      width: event.currentTarget.naturalWidth,
      height: event.currentTarget.naturalHeight,
    };
    const nextLayout = getImageLayout(size, zoom);
    setImageSize(size);
    setPosition({
      x: (CROP_SIZE - nextLayout.width) / 2,
      y: (CROP_SIZE - nextLayout.height) / 2,
    });
  };

  const handlePointerDown = (event) => {
    if (!layout) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: position.x,
      y: position.y,
    };
  };

  const handlePointerMove = (event) => {
    if (!dragRef.current || !layout) return;
    setPosition(clampPosition({
      x: dragRef.current.x + event.clientX - dragRef.current.pointerX,
      y: dragRef.current.y + event.clientY - dragRef.current.pointerY,
    }, layout));
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const handleZoomChange = (event) => {
    const nextZoom = Number(event.target.value);
    if (!imageSize) {
      setZoom(nextZoom);
      return;
    }

    const previousLayout = getImageLayout(imageSize, zoom);
    const nextLayout = getImageLayout(imageSize, nextZoom);
    const centerX = CROP_SIZE / 2;
    const centerY = CROP_SIZE / 2;
    const nextPosition = {
      x: centerX - ((centerX - position.x) / previousLayout.width) * nextLayout.width,
      y: centerY - ((centerY - position.y) / previousLayout.height) * nextLayout.height,
    };
    setZoom(nextZoom);
    setPosition(clampPosition(nextPosition, nextLayout));
  };

  const handleApply = async () => {
    const image = imageRef.current;
    if (!image || !layout) return;

    setIsApplying(true);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Unable to process the cropped profile photo.');

      const sourceX = -position.x / layout.scale;
      const sourceY = -position.y / layout.scale;
      const sourceSize = CROP_SIZE / layout.scale;
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        OUTPUT_SIZE,
        OUTPUT_SIZE
      );
      onApply(await canvasToFile(canvas));
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : 'Unable to crop this photo.');
      setIsApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="visitor-photo-crop-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 id="visitor-photo-crop-title" className="text-lg font-bold text-slate-900 dark:text-white">
              Crop profile photo
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Drag the photo to position it in the square.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cancel photo crop"
            onClick={onCancel}
            disabled={isApplying}
            className="rounded-full p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div
          className="relative mx-auto h-72 w-72 touch-none overflow-hidden rounded-xl bg-slate-200 dark:bg-slate-700"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-label="Photo crop area"
        >
          {sourceUrl && (
            <img
              ref={imageRef}
              src={sourceUrl}
              alt="Selected photo to crop"
              onLoad={handleImageLoad}
              draggable="false"
              className="pointer-events-none absolute max-w-none select-none"
              style={layout ? {
                width: layout.width,
                height: layout.height,
                left: position.x,
                top: position.y,
              } : { visibility: 'hidden' }}
            />
          )}
        </div>

        <label className="mt-4 block text-sm font-semibold text-slate-700 dark:text-slate-200">
          Zoom
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={handleZoomChange}
            className="mt-2 block w-full accent-shelf-primary"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isApplying}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!imageSize || isApplying}
            className="flex-1 rounded-lg bg-shelf-primary px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isApplying ? 'Cropping…' : 'Use photo'}
          </button>
        </div>
      </section>
    </div>
  );
}
