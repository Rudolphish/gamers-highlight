// Web と Bot でメディアの上限値が食い違っていないかを静的に見る。
//
// **なぜ要るか**: Botは tsconfig の rootDir が src なので
// `apps/web/src/lib/media-limits.ts` を直接importできず、値の写しを
// `apps/bot/src/lib/mediaLimits.ts` に置いている。写しは必ず片方だけ古くなる。
//
// 食い違うと出方が分かりにくい。Botの上限だけ小さいと、Discordに投げた動画が
// **エラーも出ずに無視される**（Botはログに出すだけで、ユーザーには何も返らない）。
// 逆にBotの上限だけ大きいと、Botは受け取るのにingestが `skipped` を返して同じく黙って消える。
//
// あわせて、画面やドキュメントに数値がベタ書きされていないかも見る。
// 30MB→100MB・30秒→2分の変更で、実際に3ファイル（画面2箇所・マニュアル1箇所）が
// 古い数値のまま残りかけた。
//
// 使い方: node tools/local-test/audit-media-limits.mjs
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const problems = [];
const rows = [];

/** `export const NAME = 100 * 1024 * 1024;` のような式を評価して数値にする */
function readConst(source, name) {
  const m = source.match(new RegExp(`export const ${name}\\s*=\\s*([^;]+);`));
  if (!m) return null;
  const expr = m[1].trim();
  if (!/^[\d\s*+/()-]+$/.test(expr)) return null; // 数式以外は評価しない
  return Function(`"use strict"; return (${expr});`)();
}

const web = read("apps/web/src/lib/media-limits.ts");
const bot = read("apps/bot/src/lib/mediaLimits.ts");

const webVideoSize = readConst(web, "MAX_VIDEO_SIZE_BYTES");
const botVideoSize = readConst(bot, "MAX_VIDEO_SIZE_BYTES");
const webImageSize = readConst(web, "MAX_IMAGE_SIZE_BYTES");
const webDuration = readConst(web, "MAX_VIDEO_DURATION_SECONDS");

for (const [名前, 値] of Object.entries({
  "web MAX_VIDEO_SIZE_BYTES": webVideoSize,
  "bot MAX_VIDEO_SIZE_BYTES": botVideoSize,
  "web MAX_IMAGE_SIZE_BYTES": webImageSize,
  "web MAX_VIDEO_DURATION_SECONDS": webDuration,
})) {
  if (値 === null) problems.push(`${名前} を読み取れませんでした（定義の形が変わった？）`);
}

rows.push({
  項目: "動画のサイズ上限",
  web: webVideoSize === null ? "?" : `${webVideoSize / 1024 / 1024}MB`,
  bot: botVideoSize === null ? "?" : `${botVideoSize / 1024 / 1024}MB`,
  一致: webVideoSize === botVideoSize ? "OK" : "NG",
});
if (webVideoSize !== botVideoSize) {
  problems.push(
    `動画のサイズ上限が食い違っている: web=${webVideoSize} bot=${botVideoSize}` +
      "（apps/bot/src/lib/mediaLimits.ts を合わせる）"
  );
}

// 画面・マニュアルに数値がベタ書きされていないか。
// 「15MB」「100MB」「2分」「120秒」のような表記を、定数から作らずに書いていると
// 次に上限を変えたときに必ず取り残される。
// 「◯分以内」まで拾うと、マニュアルの「/tag は直近10分以内の投稿に効く」という
// 別物の記述に当たった（上限値ではないので直しようがない）。上限の言い回しに絞る。
const HARDCODE = /(\d+)\s*MB|(\d+)\s*(?:秒|分)まで/g;
const SCAN = [
  "apps/web/src/app/(main)/upload/page.tsx",
  "apps/web/src/components/manual/ManualContent.tsx",
];
for (const rel of SCAN) {
  const source = read(rel);
  // テンプレートリテラル内の `${MEDIA_LIMIT_LABELS.x}` は数値ではないので当たらない。
  // 当たるのは本当にベタ書きした数値だけ。
  const hits = [...source.matchAll(HARDCODE)].map((m) => m[0].trim());
  rows.push({ 項目: rel.split("/").pop(), web: hits.length === 0 ? "定数から生成" : hits.join(","), bot: "-", 一致: hits.length === 0 ? "OK" : "NG" });
  if (hits.length > 0) {
    problems.push(`${rel}: 上限値がベタ書きされている（${hits.join(", ")}）→ MEDIA_LIMIT_LABELS から作る`);
  }
}

// 手動アップロードが長さを測って送っているか。
// **送らなければAPI側の判定は素通りする。** 実際に2026-09-06まではそうなっていて、
// 「30秒まで」と画面にもドキュメントにも書いてあるのに一度も効いていなかった。
// 判定は実際のimport文で見る（コメントに単語が出てくるだけで通ってしまうため）。
const uploadPage = read("apps/web/src/app/(main)/upload/page.tsx");
const MEASURES = /import\s*\{[^}]*\breadVideoDuration\b[^}]*\}\s*from\s+["']@\/lib\/video-thumbnail["']/;
const SENDS = /durationSeconds/;
const wired = MEASURES.test(uploadPage) && SENDS.test(uploadPage);
rows.push({ 項目: "手動アップロードが長さを送る", web: wired ? "OK" : "送っていない", bot: "-", 一致: wired ? "OK" : "NG" });
if (!wired) {
  problems.push(
    "apps/web/src/app/(main)/upload/page.tsx が readVideoDuration を使っていない" +
      "（長さの制限がどの経路でも効かなくなる）"
  );
}

console.table(rows);

if (problems.length > 0) {
  console.error(`\nNG ${problems.length} 件`);
  for (const p of problems) console.error(`  ${p}`);
  process.exitCode = 1;
} else {
  console.log(`\nOK: 上限値の食い違いなし（動画 ${webVideoSize / 1024 / 1024}MB・${webDuration}秒、画像 ${webImageSize / 1024 / 1024}MB）`);
}
