import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained build for the Docker runner stage: `.next/standalone` ships
  // its own minimal server.js and only the node_modules it actually traced.
  output: "standalone",

  // The tracer pulls these in defensively, but the compiled server in
  // .next/server never reads them at runtime (verified against a standalone
  // build with all three removed). Excluding them keeps application source and
  // the internal build spec out of the deployed image.
  // `uploads/**` is not source at all: with the default relative UPLOADS_DIR the
  // tracer copies stored bill images into the build output, which would bake
  // client data into a distributable image. Production uses an absolute path
  // outside the project, but local builds must not leak either.
  outputFileTracingExcludes: {
    "/*": ["docs/**", "scripts/**", "src/**", "uploads/**"],
    "/**": ["docs/**", "scripts/**", "src/**", "uploads/**"],
  },

  experimental: {
    // Bill images are uploaded through a Server Action, and those bodies are
    // capped at 1 MB by default — well under the 10 MB the app itself allows
    // (MAX_UPLOAD_BYTES). Sits above 10 MB to leave room for the multipart
    // boundary and part-header overhead.
    serverActions: { bodySizeLimit: "11mb" },
  },
};

export default nextConfig;
