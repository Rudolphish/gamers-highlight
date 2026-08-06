import "./globals.css";
import { SessionProvider } from "@/components/providers/SessionProvider";

export const metadata = {
  title: "ShareStaq",
  description: "ゲームのスクショを、みんなで集めて残す",
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
