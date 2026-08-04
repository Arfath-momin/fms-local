// Upload limits shared by the server validator and the client-side picker.
//
// Deliberately kept out of src/lib/attachments.ts: that module is `server-only`
// (it touches the filesystem and the database), so a Client Component cannot
// import it. Keeping the constants here means the browser preview and the
// server check enforce the same numbers instead of drifting apart.
//
// These are a convenience for the user, never a security boundary — the server
// re-validates and additionally sniffs the file's magic bytes, because
// `file.type` comes from the browser and can say anything.

/** Accepted upload MIME types, mapped to the extension we store them under. */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
