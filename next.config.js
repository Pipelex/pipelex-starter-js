/** @type {import('next').NextConfig} */
const nextConfig = {
  // The PDF example uploads a file in the browser, base64-encodes it, and
  // sends it to a Server Action. Base64 inflates payloads by ~37%, so an
  // 8 MB PDF (MAX_PDF_BYTES in src/lib/fileEncoding.ts) becomes an ~11 MB
  // request body — over the 1 MB Server Action default.
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  // `next dev` logs every Server Function call with its arguments, and a file
  // input reaches its Server Action as a base64 `data:` URL — so every document
  // dropped into the PDF or image example was printed whole into the dev
  // server's log. Only the object form turns that one log off: `logging: false`
  // would silence the fetch logs too.
  logging: {
    serverFunctions: false,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
