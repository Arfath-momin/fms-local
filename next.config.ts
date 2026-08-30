import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained build for the Docker runner stage: `.next/standalone` ships
  // its own minimal server.js and only the node_modules it actually traced.
  output: "standalone",

  // DO NOT add outputFileTracingExcludes back. There was a block here holding
  // ["docs/**", "scripts/**", "src/**", "tests/**", "uploads/**"], meant to keep
  // application source out of the deployed image. It also matched INSIDE
  // node_modules, and stripped every dependency's src/ directory: after a
  // build, `find .next/standalone/node_modules -path '*/src/*' -name '*.js'`
  // returned zero files.
  //
  // Nothing broke for weeks because no dependency needed one at runtime. Then
  // @react-pdf/renderer did, and every PDF returned 500 in production while
  // working perfectly in development — because `next dev` does not trace files
  // at all, so the fault could not appear until the container ran:
  //
  //   Cannot find module '.../node_modules/restructure/src/EncodeStream.js'
  //
  // Anchoring the patterns as "./src/**" does not help; they still match at any
  // depth. The saving was ~4 MB of source in an 80 MB bundle, against silently
  // breaking any dependency that ships and loads its own src/ — a trade worth
  // making in exactly one direction.
  //
  // Bill images are kept out of the image by .dockerignore, which excludes
  // uploads/ from the build context, so that protection did not depend on this.

  // The tracer pulls these in defensively, but the compiled server in
  // .next/server never reads them at runtime (verified against a standalone
  // build with all three removed). Excluding them keeps application source and
  // the internal build spec out of the deployed image.
  // `uploads/**` is not source at all: with the default relative UPLOADS_DIR the
  // tracer copies stored bill images into the build output, which would bake
  // client data into a distributable image. Production uses an absolute path
  // outside the project, but local builds must not leak either.
  // `tests/**` joins the list because the standalone output was carrying the
  // whole suite into the deployed image — harmless, but it is not application
  // code and has no business in a production bundle.

  experimental: {
    // Bill images are uploaded through a Server Action, and those bodies are
    // capped at 1 MB by default — well under the 10 MB the app itself allows
    // (MAX_UPLOAD_BYTES). Sits above 10 MB to leave room for the multipart
    // boundary and part-header overhead.
    serverActions: { bodySizeLimit: "11mb" },
  },
};

export default nextConfig;
