/**
 * 本番で動いている Node.js の版が、知られている脆弱性を直した版以上かを判定する（/admin の「サーバーの実行環境」）。
 *
 * Vercel の関数の Node.js は Vercel が管理していて、こちらは版の系統（2026-10-23 時点で 24.x）しか選べない。
 * 修正版に入れ替わったかは外から見えないので、実際に動いている版（process.version）を画面に出して確かめる。
 *
 * **新しい Node.js のセキュリティリリースが出たら、下の表を書き換える。** 系統ごとの「直った最初の版」。
 * 表に無い系統（サポートの切れた古い系統など）は「不明」として扱う（直ったとは言わない）。
 */
export const NODE_SECURITY_RELEASE = {
  /** どのリリースの修正か（画面に出す） */
  label: "2026-10-21 のセキュリティリリース",
  url: "https://nodejs.org/en/blog/vulnerability/october-2026-security-releases",
  fixed: { 22: "22.23.4", 24: "24.22.1", 26: "26.12.1" } as Record<number, string>,
};

function parse(version: string): [number, number, number] | null {
  const m = version.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export type NodeVersionStatus =
  | { state: "patched"; version: string; required: string }
  | { state: "outdated"; version: string; required: string }
  | { state: "unknown"; version: string };

export function nodeVersionStatus(version: string): NodeVersionStatus {
  const v = parse(version);
  const required = v ? NODE_SECURITY_RELEASE.fixed[v[0]] : undefined;
  const r = required ? parse(required) : null;
  if (!v || !required || !r) return { state: "unknown", version };
  const newer = v[1] !== r[1] ? v[1] > r[1] : v[2] >= r[2];
  return { state: newer ? "patched" : "outdated", version, required };
}
