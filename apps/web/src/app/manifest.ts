import type { MetadataRoute } from "next";

// ホーム画面に「アプリとして」入れるための設定（Web アプリのマニフェスト）。Next.js が `/manifest.webmanifest` で配り、
// `<link rel="manifest">` も自動で出す。これがあると Android や PC の Chrome・Edge に「インストール」が出て、
// アドレスバー無しの窓で開ける（無かった頃は、ブラウザのタブで開くショートカットにしかならなかった）。
// iPhone は Safari の「ホーム画面に追加」で、もともと apple-icon.png を使って入れられている。
//
// アイコンは docs/design/favicon/m1.svg（と、Android が丸や角丸に切り抜く用の m1-maskable.svg）から書き出したもの
// （docs/design/favicon.md）。色はログインしていない人にも出るので、テーマではなく既定のブルーの地の色にしてある。
// **/icons と /manifest.webmanifest は middleware の matcher に入れない**（ログイン前にも取りに来るため）
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ShareStaq",
    short_name: "ShareStaq",
    description: "ゲームのスクショを、みんなで集めて残す",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#11161d",
    theme_color: "#11161d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
