// メディア詳細（拡大表示）。IMAGE/VIDEO両対応。将来的にコメント機能もここに追加予定。
type LightboxProps = {
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
};

export function Lightbox({ mediaType, mediaUrl }: LightboxProps) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/80">
      {mediaType === "VIDEO" ? (
        <video
          src={mediaUrl}
          controls
          autoPlay
          className="max-h-[90vh] max-w-[90vw]"
        />
      ) : (
        <img src={mediaUrl} alt="" className="max-h-[90vh] max-w-[90vw]" />
      )}
    </div>
  );
}
