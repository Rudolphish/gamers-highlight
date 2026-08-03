// Discord連携設定画面：アカウント連携、Botの導入案内
export default function DiscordSettingsPage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">Discord連携設定</h1>
      {/* TODO: GET /api/discord/link で連携状況を確認、未連携ならOAuth誘導 */}
    </main>
  );
}
