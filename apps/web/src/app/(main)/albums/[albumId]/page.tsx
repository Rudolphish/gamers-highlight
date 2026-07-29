// アルバム詳細画面：写真グリッド表示、メンバー一覧、招待ボタン、タグ管理
export default async function AlbumDetailPage({
  params,
}: {
  params: { albumId: string };
}) {
  // TODO: GET /api/albums/:id, GET /api/albums/:id/photos, GET /api/albums/:id/tags
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">アルバム詳細 ({params.albumId})</h1>
      {/* <PhotoGrid photos={photos} /> */}
      {/* <ShareModal albumId={params.albumId} /> */}
      {/* <AlbumTagManager albumId={params.albumId} tags={tags} guildId={guildId} /> */}
    </main>
  );
}
