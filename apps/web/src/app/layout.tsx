import "./globals.css";
import { SessionProvider } from "@/components/providers/SessionProvider";

export const metadata = {
  title: "ShareStaq",
  description: "ゲームのスクショを、みんなで集めて残す",
};

// `viewportFit: "cover"` は、スマホの下のタブが `env(safe-area-inset-bottom)` で iPhone のホームバーを避けるために要る。
// これが無いと、その値はいつも0になる（components/layout/BottomTabs.tsx）。
// themeColor はブラウザのURLバーの色。本文の背景（steam-bg）に合わせる
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#11161d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
