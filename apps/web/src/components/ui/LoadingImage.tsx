"use client";

import { useState, type ImgHTMLAttributes } from "react";
import { Spinner } from "@/components/ui/Spinner";

type LoadingImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  /** ラッパーdivのサイズ指定。親が明確な高さを持つグリッド/サムネイル用途を想定し、既定でh-full w-full */
  wrapperClassName?: string;
};

/** 読み込み完了までスピナーを重ねて表示する<img>のラッパー。R2から配信される写真/サムネイル向け。 */
export function LoadingImage({
  className = "",
  wrapperClassName = "h-full w-full",
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...rest}
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
