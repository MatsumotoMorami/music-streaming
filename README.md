## 在线音乐房间

私用。

数据库（Prisma + SQLite）设置
1. 在项目根目录创建 `.env` 并添加 `DATABASE_URL="file:./dev.db"`。
2. 安装依赖并生成 Prisma 客户端：

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
```

注意：现有的 `server/users.json` 不会被自动迁移，按需手动迁移用户数据。