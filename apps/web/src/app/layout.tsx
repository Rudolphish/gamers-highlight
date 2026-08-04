import "./globals.css";
import { SessionProvider } from "@/components/providers/SessionProvider";

export const metadata = {
  title: "Gamer's Highlight",
  description: "ゲームのスクショを、みんなで集めて残す",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png",
  },
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
