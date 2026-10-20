# Crond API

默认地址 `http://127.0.0.1:8080/api`；前端通过同源 `/api` 代理访问。除健康检查和登录外，接口需要登录 Cookie。错误返回 `{"error":"说明"}`，使用 400/401/403/404/409/500 等 HTTP 状态码。

```sh
curl -c /tmp/crond.cookies -X POST http://127.0.0.1:8080/api/auth/test
curl -b /tmp/crond.cookies http://127.0.0.1:8080/api/projects
```

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | /health | 健康检查 |
| POST | /auth/test | 登录共享测试账号（可配置关闭） |
| POST | /auth/google | 提交 `{ "idToken": "Firebase ID token" }` 验证身份 |
| POST | /auth/qq | 返回 QQ 授权 URL 并建立一次性 state Cookie（需配置 QQ 环境变量） |
| GET | /auth/qq/callback | QQ 授权回调，验证身份后建立会话并跳转首页 |
| GET | /auth/me | 当前账号 |
| POST | /auth/logout | 撤销当前会话 |
| POST | /cron/preview | 校验 `{ "cronExp": "0 9 * * *" }`，返回预计下次执行时间与时区 |
| GET/POST | /projects | 列出可访问项目 / 创建项目 `{ "name": "项目名称", "slug": "my-project" }` |
| PATCH/DELETE | /projects/{projectId} | 修改 / 删除项目及其数据（仅拥有者） |
| GET | /projects/{projectId}/composer | 查看 Composer 可用性、依赖是否过期、安装状态及输出 |
| GET (WebSocket) | /projects/{projectId}/terminal/ws | 连接交互式 Bash PTY（仅拥有者，登录 Cookie） |
| POST | /projects/{projectId}/terminal/command/{sessionId} | 当前拥有者终端会话调用依赖安装流程 |
| POST | /projects/{projectId}/terminal/sync/{sessionId} | Shell 提示符触发源文件同步（仅当前项目会话） |
| GET | /projects/{projectId}/terminal | 查看项目命令状态、输出和依赖状态 |
| POST | /projects/{projectId}/terminal | 异步执行 `{ "command": "ls -la" }`（仅拥有者），返回 202 |
| POST | /projects/{projectId}/composer/install | 异步执行 `{ "operation": "install" }` 或 `update`（仅拥有者），返回 202；同项目已有安装返回 409 |
| GET/POST | /projects/{projectId}/{resource} | 列表 / 新建资源 |
| PATCH/DELETE | /projects/{projectId}/{resource}/{id} | 修改 / 删除资源 |
| POST | /projects/{projectId}/execute | 试运行未保存的任务，返回真实 output/status/duration/http |
| POST | /projects/{projectId}/jobs/{id}/run | 执行保存的任务并写入日志 |
| GET | /projects/{projectId}/jobs/{id}/logs | 任务执行日志 |
| GET | /projects/{projectId}/logs | 项目全部执行日志 |
| GET/POST | /projects/{projectId}/collections/{id}/records | 列出记录 / 写入 `{ "data": {...} }` |
| PATCH/DELETE | /projects/{projectId}/collections/{id}/records/{recordId} | 替换记录 data / 删除记录 |
| ANY | /projects/{projectId}/invoke{route} | 使用 Origami 引擎调用启用的无状态服务 |

`resource` 为 jobs / members / files / services / collections。字段与 `src/types.ts` 一致，id/projectId/ownerId/时间字段由后台维护。成员新增参数为 userEmail 和 role（editor 或 viewer）；用户必须已经登录过本系统。项目拥有者可以管理成员，查看者不能写入数据。

任务示例：

```json
{
  "name": "备份检查",
  "type": "shell",
  "status": "inactive",
  "cronExp": "*/5 * * * *",
  "content": "echo 'Hello from Go worker'"
}
```

HTTP 任务 content 是 URL，或 JSON 字符串 `{ "url": "https://example.com", "method": "POST", "headers": {"Content-Type":"application/json"}, "body": "{}" }`。

所有 PHP 启动均使用 Origami：定时任务、`execute` 试运行、已保存任务的 `run`、无状态服务、终端 PHP 与 Composer。Shell 任务中的 `php`/`composer` 命令也使用 Origami 包装器。普通 PHP 脚本自动加载统一框架和自定义扩展入口，任务日志保留 stdout/stderr；服务日志与响应分开保存。无需系统 PHP，解析或执行失败直接返回错误。

Cron 预览、保存与实际调度共用五段表达式解析规则，也支持 `@every 5m`、`@daily` 等描述符。预览接口返回 `{ "nextRun": "2026-10-20T09:00:00+08:00", "timezone": "Asia/Shanghai" }`，无可执行日期时 `nextRun` 为 null；空字符串采用默认 `* * * * *`。前端按返回的时区展示时间。修改任务名称、内容或其他任务不重置现有周期；只有表达式改变或任务重新启用时重新计算调度。

脚本运行时提供项目范围的短期 Bearer 凭据，环境变量 `CROND_API_URL` 已包含 `/api/projects/{projectId}`，`CROND_API_TOKEN` 用于 Authorization。凭据不允许修改项目拥有者或管理成员，执行结束即撤销。浏览器登录会话有效期 24 小时。

脚本内数据写入：

```sh
curl -H "Authorization: Bearer $CROND_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data":{"message":"from shell"}}' \
  "$CROND_API_URL/collections/COLLECTION_ID/records"
```

PHP 示例（先创建名为 system_configs 的集合）：

```php
<?php
require_once 'src/Database.php';
Database::collection('system_configs')->insert(['value' => time()]);
print_r(Database::collection('system_configs')->find());
```

无状态服务使用 Origami 运行，成功响应包含 `X-Crond-Engine: origami`。每次请求独立执行，保留项目引导文件、短期数据凭据以及 30 秒执行上限。

无状态服务示例：项目 slug 为 `my-project`，保存 route `/hello` 后使用已登录浏览器调用 `/my-project/hello`：

```php
<?php
function handle(Request $request) {
    return ['message' => $request->input('message', 'Hello'), 'method' => $request->method];
}
```

项目 `slug` 为全局唯一的 URL 标识：1–63 个字符，以小写字母开头，支持小写字母、数字和单个连字符，不能以连字符结尾；api/admin/src/assets/node_modules/public 为系统保留路径。创建时必填，重复返回 409，无效返回 400；拥有者可通过 PATCH 修改 slug。访问格式为 `/{slug}{route}`，如 `/my-project/hello`，服务根路径 `/` 对应 `/my-project/`。不同项目允许配置相同 route；匿名请求返回 401，无调用权限返回 404。Cookie 路径为 `/`，覆盖管理接口与项目服务地址。内部测试入口 `/api/projects/{projectId}/invoke{route}` 仍可使用。

框架文档页面不再提供终端。历史终端 API 保留用于后台操作，源文件同步拒绝修改默认框架文件；默认框架由服务器管理员统一维护。终端会话仍受登录及项目拥有者权限控制。


文件目录重命名会原子更新子文件路径；删除目录会级联删除子文件，删除框架入口会清空项目 entryFileId。入口只能引用当前项目的文件，空字符串可取消入口。重复文件路径、集合名称和记录 key 返回 409。记录省略 key 时后台自动生成，PATCH 替换 data 但保留未显式修改的 key；空白或非字符串 key 返回 400。

所有项目默认附带 Script Framework，旧项目在后台启动时自动补齐。项目 framework 字段包含 name、version、entryFileId；entryFileId 是当前实际入口，framework.entryFileId 是推荐入口。Origami 服务的 stderr 日志单独保存到项目日志，不混入 HTTP 响应；项目日志会同时包含定时任务与服务执行。

统一执行入口为项目根目录 bootstrap.php，它载入 Composer 自动加载器和默认框架；旧自定义入口随后作为扩展执行。Composer lock 保存到文件列表，vendor 单独持久化并复制到各执行目录。修改 composer.json/lock 后执行会提示重新安装依赖。

框架 files 资源使用用户共享的文本文件目录 `data/projects/<用户ID>/files/`，不存储数据库文件记录。同一拥有者的项目共享文件 ID、内容和依赖快照；GET 返回当前请求的 projectId。files 的 POST/PATCH/DELETE 仅拥有者可用，成员可以查看。删除共享入口会清空相关项目的入口引用；删除最后一个项目时清理该用户的框架目录。可通过 CROND_FILES_DIR 设置根目录；普通文本文件可直接修改并由后续文件列表读取，索引文件 .crond-files.json 不应手动修改。

默认框架模板从 `./data/framework/` 读取，可通过 `CROND_FRAMEWORK_DIR` 指定目录。模板不再嵌入后台二进制，部署时需携带完整框架目录；缺少必要入口、说明或 Database.php 时后台明确报错。所有用户、所有项目共用此默认框架；历史用户目录中的同名副本不再生效，原文件保留。`GET /api/framework` 返回全局只读框架文件，文件接口禁止覆盖、重命名和删除默认框架。

终端命令分流：php 包装器启动后台二进制 --origami-cli，composer 由同一 Origami CLI 解释 composer.phar；其他命令保留系统 Bash。JSON 命令编码和状态解析使用 Go 辅助程序。CROND_COMPOSER_PHAR 指定 archive 路径，CROND_COMPOSER_BINARY 仅兼容旧 PHAR 路径，不再执行其系统程序。已验证真实 PHAR 版本查询，但当前 Origami 的 Composer 命令类兼容性尚不足以运行 install/require；错误原样返回，不回退到系统 PHP，也不覆盖已成功的 vendor 快照。

## 无状态服务请求方法

服务的 `method` 可配置为 GET、POST、PUT、PATCH、DELETE、HEAD 或 OPTIONS，未指定时默认 GET。创建或修改服务时与 `route` 一同保存，例如 `{ "name": "创建用户", "method": "POST", "route": "/users", "content": "..." }`。

项目内以“请求方法 + 路径”唯一定位服务，同路径不同方法可以分别定义；重复组合返回 409。无效方法返回 400。调用已启用的路径但方法不匹配时返回 405，`Allow` 响应头列出支持的方法；HEAD、OPTIONS 也需要显式定义。项目地址与内部 invoke 地址使用相同匹配规则，仍保留登录和权限校验。

测试弹窗默认选择服务已保存的请求方法，填写参数后手动发送；可改用其他方法验证 405 响应。
