# 项目框架使用说明

本项目默认使用通用脚本框架 Script Framework，为定时任务和无状态服务提供支持，无需单独安装或启用。

所有用户、所有项目共用服务器 data/framework/ 中的默认框架，可通过 CROND_FRAMEWORK_DIR 指定目录。
“框架文档”页面仅供查看说明、示例和源码，不提供编辑、保存、新建、重命名、删除或终端操作。
框架文件由服务器管理员统一维护，更新后所有项目的后续执行使用更新内容。
任务、服务、数据与日志仍按项目分别管理。

## 统一入口

所有 PHP 定时任务、试运行、终端 PHP 和无状态服务均使用 Origami，并自动经过根目录 bootstrap.php。
入口先加载 Composer 的 vendor/autoload.php，再加载 framework/bootstrap.php。
业务脚本直接使用框架提供的类，不需要重复引入入口。

## 命名空间

框架类统一位于 `Framework\`：PHP 任务可使用 `use Framework\Task;` 等导入；无状态服务示例直接使用 `\Framework\...` 全限定类名。
任务和服务均可声明自己的命名空间；服务处理器可以定义为 `App\Services\handle`。
旧全局类名继续兼容。`App\` 业务类自动映射到 `src/`，无需先安装 Composer。
完整示例和说明见 framework/README.md 与 framework/examples/。

## 目录

- bootstrap.php：统一启动入口。
- composer.json / composer.lock：Composer 依赖声明和锁文件。
- vendor/：后台安装的依赖，执行时自动载入，无需手动复制。
- framework/：定时任务与无状态服务共用的框架代码。
- framework/settings.php：全局默认配置。
- src/：业务代码，支持 App 命名空间的 PSR-4 自动加载。
- framework/examples/：可复制到编辑器的任务和服务示例。
- framework/README.md：框架 API 说明。
- framework/STORAGE.md：全局共享框架与文本文件存储说明。

## 编写任务

<?php
Task::run('daily_report', function () {
    Logger::info('开始生成报表', ['app' => Config::get('app.name')]);
    // 在这里编写业务逻辑。
});

Task 自动记录开始、结束、耗时和失败，异常不会被吞掉。

## 编写无状态服务

<?php
function handle(\Framework\Request $request)
{
    \Framework\Logger::info('收到服务请求', ['method' => $request->method]);
    return [
        'app' => \Framework\Config::get('app.name'),
        'message' => $request->input('message', 'Hello from Script Framework')
    ];
}

在无状态服务编辑器中保存上述代码。入口提供与定时任务相同的配置、日志和数据接口；日志独立保存，返回值作为服务响应。

## 发起 HTTP 请求

```php
$data = Http::get('https://example.com/api/items', [
    'query' => ['page' => 1], 'timeout' => 10
])->throwIfFailed()->json();
Http::post('https://example.com/api/items', ['name' => 'demo'])->throwIfFailed();
```

定时任务与无状态服务共用 `Http`。支持请求头、JSON、表单、原始正文和超时，响应可读取状态码、响应头及正文。详见 framework/README.md 与 framework/examples/http.php。

## 配置与数据

服务器管理员统一维护 framework/settings.php，业务代码通过 Config::get('app.name') 读取。
先在数据存储模块创建集合，再用 Database::collection('name')->insert/find/update/delete。
每次执行的工作目录会清理，需要保留的数据应存入集合。

## Composer 依赖

默认框架的 composer.json 由服务器管理员维护，页面只提供查阅。
第三方依赖需要由管理员在部署环境中准备，并验证与执行引擎的兼容性。
PHP 任务与服务统一使用 Origami，仅能使用当前虚拟机支持的 PHP 语法和扩展，无需系统 PHP。

无状态服务保存后通过“访问”按钮打开；地址为 /<项目标识>/<服务路径>。
例如项目标识 my-project、服务路径 /hello，对应 /my-project/hello；不同项目的路径相互隔离，调用仍需登录与项目权限。

## 查看日志

顶部“项目日志”可查看定时任务、终端与服务日志。日志与服务 JSON 响应分开保存。
