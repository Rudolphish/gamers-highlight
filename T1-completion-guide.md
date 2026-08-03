# T1 完成指南

## 背景信息

- **当前任务**：实现搜索API的权限过滤。
- **目标文件**：`apps/web/src/app/api/photos/search/route.ts`
- **前提条件**：无需引入新的类型定义或组件。

## 实现步骤

1. 使用 `getServerSession(authOptions)` 进行登录验证，确保只有登录用户才能访问。
2. 引入 `hasAlbumPermission(albumId, userId, role)` 函数进行权限检查。此函数在 `apps/web/src/lib/permissions.ts` 中定义，不需修改该文件内容。
3. 确保只有拥有查看权限的相册中的照片才被返回。

## 完成条件

- [ ] 未登录用户返回401状态码。
- [ ] 非成员用户的相册照片不包含在结果中。
- [ ] 未分类（`albumId` 为 `null`）的照片仅由其发布者可见。
- [ ] 查询参数（游戏名、上传者、起始日期和结束日期）的处理保持不变。

请参考以下代码片段进行实现：

```typescript
import { getServerSession } from "next-auth";
import { hasAlbumPermission } from "../lib/permissions";
import prisma from "../lib/db";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // 假设获取查询参数
  const game = req.url.split("?game=")[1] ?? "";
  const uploader = req.url.split("?uploader=")[1] ?? "";
  const from = new Date(req.url.split("&from=")[1]) ?? new Date();
  const to = new Date(req.url.split("&to=")[1]) ?? new Date();

  // 获取用户信息
  const user = session?.user.email ? await prisma.user.findUnique({ where: { email: session.user.email } }) : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // 过滤权限合规的照片
  let photos = await prisma.photo.findMany({
    where: {
      gameId: game ? { contains: game } : undefined,
      uploaderId: uploader ? { contains: uploader } : undefined,
      createdAt: { gte: from, lt: to },
    },
  });

  // 应用权限过滤
  photos = photos.filter((photo) => {
    if (photo.albumId) return hasAlbumPermission(photo.albumId, user.id, "VIEWER");
    return photo.uploaderId === user.id;
  });

  return NextResponse.json({ photos });
}
```
