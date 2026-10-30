"use client";

import Link from "next/link";
import Image from "next/image";
import { ShoppingCart } from "lucide-react";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { EmptyState } from "@/components/ui/EmptyState";
import type { WishlistPrice } from "@/lib/wishlistPrice";
import { PriceLine } from "./WishlistPriceLine";
import { ProposalPurchases, type PurchasePerson } from "./ProposalPurchases";

export type AgreedProposal = {
  id: string;
  steamAppId: number;
  title: string;
  coverUrl: string | null;
  /** 「みんなでやりたい」に上がった時刻（エポックミリ秒）。新しく上がった順に並べる */
  agreedAt: number;
  people: PurchasePerson[];
};

/**
 * 「みんなでやりたい」（2026-10-30〜。lib/proposalPromotion.ts）。
 * グループの全員が「やりたい」を押したゲームが上がり、やりたい人が全員「買った」を押すとゲームリストの「プレイ予定」に入る。
 *
 * ウィッシュリストのタブのいちばん上に置く（買う段階なので、提案者ごとの区画より先に目に入るように）。
 * 価格はウィッシュリストと同じ取得（GameProposals が読む `/proposals/prices`）を受け取って出す。
 */
export function AgreedProposals({
  groupId,
  items,
  currentUserId,
  isOwner,
  prices,
}: {
  groupId: string;
  items: AgreedProposal[];
  currentUserId: string;
  isOwner: boolean;
  /** null＝読み込み中 */
  prices: Record<number, WishlistPrice> | null;
}) {
  const sorted = [...items].sort((a, b) => b.agreedAt - a.agreedAt);

  return (
    <CollapsibleSection title="みんなでやりたい">
      {sorted.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="まだありません"
          description="ウィッシュリストで全員が「やりたい」を押したゲームが、ここに上がります。やりたい人が全員「買った」を押すと、ゲームリストの「プレイ予定」に入ります。"
        />
      ) : (
        <div data-testid="agreed-proposals" className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((p) => (
            <div key={p.id} data-testid="agreed-proposal" className="rounded-xl bg-steam-panel p-3">
              <div className="flex items-start gap-3">
                {p.coverUrl && (
                  <Link href={`/groups/${groupId}/proposals/${p.id}`} className="flex-shrink-0">
                    <Image
                      src={p.coverUrl}
                      alt={p.title}
                      width={80}
                      height={48}
                      className="h-12 w-20 rounded-lg object-cover transition hover:brightness-110"
                    />
                  </Link>
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/groups/${groupId}/proposals/${p.id}`}
                    className="block truncate text-sm font-bold text-steam-text hover:text-steam-blue"
                  >
                    {p.title}
                  </Link>
                  <p className="truncate text-xs text-steam-muted">全員が買うとゲームリストへ</p>
                </div>
              </div>
              <div className="mt-2">
                <PriceLine price={prices === null ? "loading" : prices[p.steamAppId]} />
              </div>
              <div className="mt-2">
                <ProposalPurchases
                  groupId={groupId}
                  proposalId={p.id}
                  people={p.people}
                  currentUserId={currentUserId}
                  isOwner={isOwner}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}
