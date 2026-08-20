import type { GeneratedImage } from "@/types/generateImagePipeline";

interface ImageResultProps {
  image: GeneratedImage;
}

export function ImageResult({ image }: ImageResultProps) {
  // Prefer public_url for display; fall back to url. Both a remote/storage URL
  // and a base64 data URL render in a plain <img> — we use <img> rather than
  // next/image because the image host is dynamic and unknown ahead of time.
  // `||` rather than `??` for the same reason the narrower uses it: an empty
  // string is a valid `.optional()` value on the wire but not a usable URL.
  const src = image.public_url || image.url;

  return (
    <section
      aria-label="Generated image"
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-6"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={image.caption || "Generated image"}
        className="w-full rounded-md border border-slate-200"
      />
      <a href={src} download className="inline-block text-xs font-medium text-blue-700 underline">
        Download image →
      </a>
    </section>
  );
}
