"use client";

import { useState } from "react";
import Image, { type ImageProps } from "next/image";
import { Spinner } from "@/components/ui/Spinner";

type LoadingImageProps = Omit<ImageProps, "fill" | "sizes"> & {
  /** ラッパーdivのサイズ指定。親が明確な高さを持つグリッド/サムネイル用途を想定し、既定でh-full w-full */
  wrapperClassName?: string;
  /** next/imageのsizes。グリッドのサムネイル想定でデフォルトを設定済み */
  sizes?: string;
};

/** 読み込み完了までスピナーを重ねて表示するnext/imageのラッパー。R2から配信される写真/サムネイル向け。 */
export function LoadingImage({
  className = "",
  wrapperClassName = "h-full w-full",
  sizes = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw",
  onLoad,
  onError,
  ...rest
}: LoadingImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={`relative ${wrapperClassName}`}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-steam-panel">
          <Spinner size={18} className="text-steam-muted" />
        </div>
      )}
      <Image
        {...rest}
        fill
        sizes={sizes}
        onLoad={(e) => {
          setLoaded(true);
          onLoad?.(e);
        }}
        onError={(e) => {
          setLoaded(true);
          onError?.(e);
        }}
        className={`${className} transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
