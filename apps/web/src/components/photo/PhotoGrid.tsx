type Media = {
  id: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
};

export function PhotoGrid({ photos }: { photos: Media[] }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
      {photos.map((item) => (
        <div key={item.id} className="relative aspect-square overflow-hidden rounded">
          {item.mediaType === "VIDEO" && !item.thumbnailUrl ? (
            // Discord経由などサムネイルが無い動画は、ブラウザの先頭フレーム表示に委ねる
            <video src={item.mediaUrl} preload="metadata" muted className="h-full w-full object-cover" />
          ) : (
            <img
              src={item.thumbnailUrl ?? item.mediaUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          )}
          {item.mediaType === "VIDEO" && (
            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
              ▶ {item.durationSeconds ?? "?"}s
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
