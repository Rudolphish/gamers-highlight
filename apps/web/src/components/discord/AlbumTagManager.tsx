"use client";

// アルバムに紐付くハッシュタグ（別名）の一覧・追加・削除UI。
// 「#eldenring」「#elden_ring」のような表記ゆれを、同じアルバムに複数タグとして
// 登録することで統合できるようにする（タグ検知の精度を上げるための機能）。
//
// タグを追加する際、既に別のアルバムに紐付いているタグを指定すると、
// このアルバムへ「付け替え」される（＝表記ゆれの統合操作そのものになる）。

type GameTag = { id: string; tag: string; guildId: string };

type AlbumTagManagerProps = {
  albumId: string;
  tags: GameTag[];
  guildId: string; // 現状は1サーバー運用前提。複数サーバー対応時はセレクトに変更
};

export function AlbumTagManager({ albumId, tags }: AlbumTagManagerProps) {
  // TODO:
  // - 追加: POST /api/albums/:id/tags { guildId, tag }
  // - 削除: DELETE /api/albums/:id/tags/:tagId
  return (
    <div className="rounded-lg border p-4">
      <h2 className="font-medium">タグ（ハッシュタグ別名）</h2>
      <p className="mt-1 text-sm text-gray-500">
        Discordでこのアルバムに投稿する際のハッシュタグを複数登録できます。
        「#eldenring」と「#elden_ring」のような表記ゆれをまとめたい場合、
        両方をここに追加してください。
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {tags.map((t) => (
          <li key={t.id} className="rounded-full border px-3 py-1 text-sm">
            #{t.tag}
            {/* TODO: 削除ボタン */}
          </li>
        ))}
      </ul>
      {/* TODO: タグ追加用の入力フォーム */}
    </div>
  );
}
