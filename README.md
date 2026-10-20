# Crond 定时任务管理平台

React 前端 + Go 后台。后台基于 [go-home-admin/go-admin](https://github.com/go-home-admin/go-admin)，使用其启动容器、Gin 路由与 GORM，默认使用 SQLite，无需额外启动 MySQL 或 Redis。

## 本地启动

需要 Node.js 20.19+、Go 1.27.1+、C 编译器（SQLite 驱动需要 CGO）。Shell 任务与终端需要 `bash`；所有 PHP 执行入口使用后台内置的 Origami，无需安装系统 PHP。

```sh
npm install
cd backend
go mod download
cp .env.example .env
go run .
```

另一个终端启动前端：

```sh
npm run dev
```

打开 http://localhost:3000，点击“测试账号一键登录”。前端将 `/api` 请求代理到本机 `127.0.0.1:8080`。也可以在项目根目录执行 `npm run dev:backend` 启动后台。

## 功能

- 后台测试账号登录、HttpOnly Cookie 会话、退出登录；Google 登录由 Firebase 获取身份令牌，Go 验证后建立会话。QQ 登录使用 QQ 互联 OAuth 授权码流程，配置应用 ID、密钥和回调地址后启用。
- 项目、成员、任务、执行日志、PHP 框架文件、无状态服务、数据集合和记录的持久化接口。
- 页面支持项目创建、切换、重命名、删除，以及任务和服务启停。
- 框架文档提供说明、示例与源码浏览；所有用户和项目共用默认框架，页面只读。
- 数据集合名称在项目内唯一，所有集合（含 `mock_` 前缀）都持久化；记录 `key` 在集合内唯一，省略时后台生成，更新时保留原 key。
- 项目拥有者管理成员；编辑者读写任务和数据；查看者只读；跨项目访问会被拒绝。
- 五段 Cron 表达式（也支持 `@every` 等 robfig/cron 描述符），时区 Asia/Shanghai。启用的任务自动调度，服务重启后恢复调度。
- Shell/PHP/HTTP 任务真实执行。每个脚本在独立临时工作目录中运行，载入项目文件，PHP 支持已设置的框架入口；单个任务不重叠运行，执行上限 30 秒，输出上限 1 MiB。完成后保存真实执行日志。
- 无状态服务由 [Origami](https://github.com/php-any/origami) Go 虚拟机执行，可通过 `/api/projects/{projectId}/invoke{route}` 调用（须登录），支持 `handle(Request $request)` 返回 JSON，每次请求运行独立虚拟机；Request 提供 method、query、headers、body、`json()` 和 `input()`。
- PHP 执行目录提供 `src/Database.php`，支持 `Database::collection(name)->insert/find/update/delete`。Shell 使用 `CROND_API_URL` 和 `CROND_API_TOKEN` 调用数据 API。执行凭据仅能读写当前项目，执行结束即撤销。

示例测试项目含一个未启用的 Shell 任务，可手动执行或启用调度。

## 存储与配置

默认数据文件：`backend/data/crond.db`。账号、会话和业务数据保存在后台数据库中，刷新浏览器或重启服务不会丢失。此前保存在浏览器或 Firestore 的数据不会自动迁移。

框架代码采用文本文件存储：`backend/data/projects/<用户ID>/files/`，同一用户的多个项目共享代码和 Composer 依赖。编辑器保存直接写入磁盘，终端改动同步到同一目录；也可使用本地编辑器修改文件。`.crond-files.json` 仅记录稳定文件 ID 等元数据，不保存代码内容。框架文件读写不需要数据库；项目、权限、日志以及依赖安装状态仍使用数据库。

启动时自动迁移旧数据库中的框架文件，并在用户目录保留 `.legacy-files-<项目ID>.json` 原始备份。同名文件内容冲突时中止迁移并报告路径，不覆盖已有代码。删除某个项目保留其他项目使用的共享框架，删除最后一个项目才清理用户文件目录。共享框架只能由拥有者修改，项目成员可查看；PHP/Markdown/Composer 文件均是普通 UTF-8 文本文件，单文件上限 2 MiB，不支持符号链接。

配置见 `backend/.env.example`：

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| HTTP_PORT | 8080 | 后台端口；调整后需同步 Vite 代理 |
| CROND_DB_PATH | ./data/crond.db | SQLite 文件路径，相对后台目录 |
| CROND_FRAMEWORK_DIR | ./data/framework | 默认框架模板目录；部署时需随程序提供 |
| CROND_COMPOSER_PHAR | ./data/tools/composer.phar | 由 Origami 解释执行的 Composer PHAR |
| CROND_FILES_DIR | SQLite 文件所在目录下的 projects | 历史用户源文件与自定义业务文件根目录 |
| CROND_WORK_DIR | ./data/workspaces | 脚本工作目录 |
| CROND_TEST_LOGIN | true | 设置 false 关闭共享测试账号入口 |
| FIREBASE_API_KEY | 从 ../firebase-applet-config.json 读取 | Google 身份验证使用的公开 Web API Key |

服务默认只监听本机。Shell 任务使用 Bash；PHP 定时任务、试运行、手动执行、无状态服务、终端 PHP 与 Composer 均使用后台二进制内的 Origami。Shell 任务中的 `php`/`composer` 命令同样通过 Origami 包装器启动。各执行进程不提供容器隔离；当前配置用于本地开发。测试账号是共享账号，部署时应关闭入口，并配置正式身份认证与隔离执行环境。

## 默认脚本框架与 Composer

创建项目时需填写全局唯一的项目标识 `slug`（1–63 个字符，小写字母开头，支持数字和单个连字符，不能以连字符结尾）。无状态服务通过 `域名/项目标识/服务路径` 访问，例如项目 `my-project` 的 `/hello` 服务地址为 `/my-project/hello`；不同项目可使用相同服务路径。同一项目按请求方法与路径匹配服务，可分别定义 GET、POST 等方法，未指定时默认 GET，方法不匹配返回 405。服务地址栏显示此地址，仍需登录并具有项目调用权限。

默认框架原始代码位于 `backend/data/framework/`，包括统一入口、核心 PHP 类、Database.php、Composer 配置和说明文件。后台直接从磁盘读取，不再使用 go:embed 打包框架。部署时需同时携带此目录，或通过 `CROND_FRAMEWORK_DIR` 指定绝对路径。所有用户、所有项目共用这一份默认框架；文档展示和后续执行直接读取当前内容。历史用户目录中的同名框架副本不再生效，原文件保留。

所有项目默认提供 Script Framework，无需安装或启用框架。新旧项目统一引用服务器默认框架，不再复制为用户可编辑版本。

进入“框架文档”首先显示全局默认 `README.md`，可浏览说明、示例和源码。页面仅供查看，不提供文件修改或终端；后台拒绝通过文件接口修改默认框架文件。框架由服务器管理员统一维护。

根目录 `bootstrap.php` 是 PHP 定时任务、试运行、终端 PHP 与无状态服务的统一入口：先载入 `vendor/autoload.php`，再启动 `framework/bootstrap.php`。业务脚本无需重复 require；此前配置的自定义入口作为统一入口后的扩展继续执行。Composer PHAR 使用其自身入口，仍由 Origami 解释执行。

框架类统一位于 `Framework\` 命名空间，旧全局类名继续兼容；`App\` 到 `src/` 的业务类自动加载无需安装 Composer，任务和服务均支持自己的命名空间。框架提供 `Config::get/env`、`Logger::info/error`、`Task::run`、`Http::get/post/put/patch/delete/request` 和 `Database::collection()`。配置在 `framework/settings.php`，示例在 `framework/examples/`，API 说明在 `framework/README.md`。

当前兼容性限制：已验证普通 Bash、Origami 的 PHP 文件/`-r`/参数传递，以及真实 Composer 2.8.3 的 `--version`。`composer install/require` 目前仍受 Origami 的 Composer 命令类兼容性缺口影响，不能视为已支持依赖安装；失败会明确返回错误并保留上次成功的依赖，不会回退系统 PHP。Composer 2.2 LTS 的安装也存在语法兼容性错误。

Composer 依赖声明由服务器管理员维护和部署，页面只读。默认支持 `App\` 到 `src/` 的 PSR-4 自动加载。
历史命令 API 保留用于后台操作，默认框架源文件的终端修改不会同步保存。

所有 PHP 任务与服务使用的包都需实际验证其语法和扩展是否受 Origami 支持。自动加载与锁文件行为参考 [Composer 官方说明](https://getcomposer.org/doc/01-basic-usage.md)。Shell 继续使用 Bash 和项目数据 API。

## QQ 登录配置

在 QQ 互联创建网站应用，并在后台 `.env` 配置 `QQ_APP_ID`、`QQ_APP_KEY`、`QQ_REDIRECT_URL`。回调路径固定为 `/api/auth/qq/callback`，地址须与 QQ 平台注册的一致。例如开发代理地址 `http://localhost:3000/api/auth/qq/callback`；正式环境使用站点的 HTTPS 地址。密钥仅放在后台。

点击 QQ 登录后跳转授权，回调验证绑定浏览器的十分钟一次性 state，再验证 OpenID 所属应用并建立 HttpOnly 会话。QQ 不提供邮箱，系统使用 `{openid}.{appid}@qq.crond.local` 作为成员管理标识，可从 `/api/auth/me` 查询。

## 验证

```sh
npm run test:backend
npm run test:frontend
npm run lint
npm run build
```

前端回归测试覆盖文件选择、轮询期间的草稿保留、快捷键保存以及保存期间继续输入。后台测试覆盖目录级联操作、数据唯一性、任务与服务启停、QQ OAuth state 校验及会话建立，以及会话撤销、权限隔离、CRUD、真实脚本/HTTP/PHP 执行、框架入口、定时调度、超时取消、数据库重启持久化。

## API

接口文档和 curl 示例见 [backend/API.md](backend/API.md)。

框架来源 commit：`2b1ade1d90accf57e81554893075033e8ec48301`。保留其 Apache-2.0 许可证，位于 `backend/LICENSE`；不使用上游依赖 MySQL 的示例实体测试。

脚本引擎固定为 [Origami commit `97ceb072c9d57fe36184af1a3a2152e9b51e9fec`](https://github.com/php-any/origami/commit/97ceb072c9d57fe36184af1a3a2152e9b51e9fec)（Go 模块版本 `v0.0.0-20261020005324-97ceb072c9d5`，2026-10-20）。所有 PHP 执行入口均使用此引擎，支持 PHP 风格语法和部分 PHP 标准库；任务与服务代码须符合 Origami 支持的语法与功能，执行失败直接返回错误。
