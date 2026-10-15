import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { withAuthErrorContext } from "@/lib/authErrorLog";

export const dynamic = "force-dynamic";

const handler = NextAuth(authOptions);

// ログインの失敗を記録し終えてから返す（端末の情報もここで渡す。lib/authErrorLog.ts）
async function route(req: Request, ctx: { params: { nextauth: string[] } }): Promise<Response> {
  return withAuthErrorContext(req, () => handler(req, ctx) as Promise<Response>);
}

export { route as GET, route as POST };
