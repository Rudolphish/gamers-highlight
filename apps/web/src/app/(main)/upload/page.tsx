// アップロード画面：画像 or 30秒以内の動画クリップをアップロード
//
// 動画の場合のサムネイル方針：
//   - デフォルト：lib/video-thumbnail.ts の extractFirstFrame() で1フレーム目を自動生成
//   - 任意：ユーザーが好きな画像ファイルを選んでサムネイルとして指定
//
// 実装の流れ（TODO）：
//   1. ファイル選択 → contentTypeで画像/動画を判定
//   2. 動画の場合、サムネイルを決定（自動抽出 or 任意アップロード画像）
//      → サムネイルは通常の画像アップロードと同じ署名付きURLフローで先にアップロード
//   3. POST /api/photos で本体分の署名付きURLを取得（thumbnailUrlを含めて送信）
//   4. 返ってきたuploadUrlへ本体ファイルを直接PUT
export default function UploadPage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">スクショ/クリップをアップロード</h1>
      <p className="mt-2 text-sm text-gray-500">
        画像、または30秒以内の動画クリップをアップロードできます。
      </p>
      {/* TODO: ファイル選択フォーム、サムネイル選択UI（自動 or 任意画像） */}
    </main>
  );
}
