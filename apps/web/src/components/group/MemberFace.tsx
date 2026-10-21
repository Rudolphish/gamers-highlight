"use client";

import { useState } from "react";
import Image from "next/image";

// グループの見出しに並べる顔1つ（MemberFaces から使う）。Discord のアイコンがあれば画像、無ければ・読めなければ頭文字の丸。
// **画像が読めなかったら頭文字に戻す。** Discord のアイコンのURLはハッシュつきで、アイコンを変えると古いURLは404になる。
// ログインのたびにURLを新しくしている（lib/discordAccount.ts）が、次にログインするまでは古いままなので、
// 壊れた画像の印を出さないようにする。onError を使うのでここだけクライアント部品にしている
export function MemberFace({
  name,
  initial,
  avatarUrl,
  color,
  overlap,
}: {
  name: string | null;
  initial: string;
  avatarUrl: string | null;
  color: string;
  overlap: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const base = `flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-steam-bg text-xs font-bold text-accent-ink ${overlap ? "-ml-2" : ""}`;
  if (avatarUrl && !broken) {
    return (
      <span title={name ?? undefined} data-face="avatar" className={base} style={{ background: color }}>
        <Image src={avatarUrl} alt="" width={32} height={32} className="h-full w-full object-cover" onError={() => setBroken(true)} />
      </span>
    );
  }
  return (
    <span title={name ?? undefined} data-face="initial" className={base} style={{ background: color }}>
      {initial}
    </span>
  );
}
