"use client";

import { useActionState, useRef } from "react";
import type { UploadState } from "./actions";

export type AttachmentItem = { id: string; uploadedAt: string };

export function AttachmentPanel({
  attachments,
  action,
  canUpload,
}: {
  attachments: AttachmentItem[];
  action: (prev: UploadState, formData: FormData) => Promise<UploadState>;
  canUpload: boolean;
}) {
  const [state, formAction, pending] = useActionState<UploadState, FormData>(
    action,
    null
  );
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="mt-6 max-w-lg">
      <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted mb-2">
        Attachments{" "}
        <span className="normal-case font-normal">
          — receipt / bill images
        </span>
      </h2>

      {attachments.length === 0 ? (
        <p className="text-muted text-[13px]">No images attached.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <a
              key={a.id}
              href={`/api/attachments/${a.id}`}
              target="_blank"
              rel="noreferrer"
              className="block border border-line-strong hover:border-accent"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/attachments/${a.id}`}
                alt="Attached receipt"
                className="h-24 w-24 object-cover"
              />
            </a>
          ))}
        </div>
      )}

      {canUpload && (
        <form
          action={(fd) => {
            formAction(fd);
            fileRef.current?.form?.reset();
          }}
          className="mt-3 flex items-center gap-2"
        >
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp"
            required
            className="text-[13px]"
          />
          <button
            type="submit"
            disabled={pending}
            className="border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold hover:border-accent disabled:opacity-60"
          >
            {pending ? "Uploading…" : "Attach image"}
          </button>
        </form>
      )}
      {state?.error && (
        <p className="text-debit text-[13px] mt-2">{state.error}</p>
      )}
    </div>
  );
}
