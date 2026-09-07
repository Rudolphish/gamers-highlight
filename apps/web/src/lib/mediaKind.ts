// 画面が扱うメディアの種類。
//
// **`MediaType` を直接 import しない。** Prismaが生成する型はDBの都合（enumの値）で、
// クライアントコンポーネントの props に持ち込むと `@prisma/client` がバンドルに入る。
// ここに写しを1つ置いて、画面側は全部これを使う。
export type MediaKind = "IMAGE" | "VIDEO" | "YOUTUBE";
