"use client";

import { useEffect, useRef, useState } from "react";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
} from "@/lib/attachment-limits";

/**
 * Bill/receipt picker with an immediate preview.
 *
 * The point is confirmation: until the voucher is saved there was previously
 * nothing on screen to show an image had actually been picked, so a mis-click
 * produced a voucher with no bill and no warning. Here the chosen file is
 * rendered straight from the browser — no upload round-trip — together with
 * its name and size, and it can be removed or swapped before saving.
 *
 * Client-side checks mirror the server's exactly, but they are a convenience,
 * not a control: the server re-validates and additionally sniffs the file's
 * magic bytes, because `file.type` is supplied by the browser.
 */
export function BillUpload({
  name = "bill",
  label = "Bill / receipt image",
  hint,
  existingCount = 0,
}: {
  name?: string;
  label?: string;
  hint?: string;
  /** Images already attached — changes the copy from "attach" to "replace". */
  existingCount?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The preview URL is created in the event handler and tracked in a ref, not
  // derived in an effect: deriving it would mean calling setState during an
  // effect, which cascades an extra render on every file pick. The ref exists
  // so the last URL can still be revoked on unmount — an object URL pins the
  // image bytes in memory until it is released.
  const urlRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  function select(file: File | null) {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;

    if (!file) {
      setPicked(null);
      return;
    }
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    setPicked({ file, url });
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setError(null);

    if (!file) {
      select(null);
      return;
    }
    if (!ALLOWED_IMAGE_TYPES[file.type]) {
      setError("Only JPEG, PNG or WebP images can be attached.");
      clear();
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `That image is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`
      );
      clear();
      return;
    }
    select(file);
  }

  function clear() {
    // Resetting the input's value is what actually removes the file from the
    // form submission; clearing React state alone would not.
    if (inputRef.current) inputRef.current.value = "";
    select(null);
  }

  return (
    <div>
      <label htmlFor={name} className="block text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">
        {label}
      </label>

      <input
        ref={inputRef}
        id={name}
        name={name}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onChange}
        className="block w-full text-[13px] file:mr-3 file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-[12px] file:font-semibold hover:file:border-accent"
      />

      {hint && !picked && !error && (
        <p className="text-muted text-[12px] mt-1">{hint}</p>
      )}

      {existingCount > 0 && !picked && (
        <p className="text-muted text-[12px] mt-1">
          {existingCount} image{existingCount === 1 ? "" : "s"} already
          attached. Choosing a new one replaces {existingCount === 1 ? "it" : "them"}.
        </p>
      )}

      {error && <p className="text-debit text-[13px] mt-2">{error}</p>}

      {picked && (
        <div className="mt-2 flex items-start gap-3 border border-line-strong bg-surface p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={picked.url}
            alt={`Preview of ${picked.file.name}`}
            className="h-20 w-20 object-cover border border-line"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium break-all">
              {picked.file.name}
            </div>
            <div className="text-muted text-[12px] mt-0.5">
              {formatBytes(picked.file.size)} · ready to upload
            </div>
            <button
              type="button"
              onClick={clear}
              className="mt-1.5 border border-line-strong bg-background px-2 py-1 text-[12px] font-semibold hover:border-accent"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
