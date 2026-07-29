// ホーム/タイムライン：自分と共有されたアルバムの一覧
export default async function HomePage() {
  // TODO: GET /api/albums を叩いてAlbumGridに渡す
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">マイアルバム</h1>
      {/* <AlbumGrid albums={albums} /> */}
    </main>
  );
}
