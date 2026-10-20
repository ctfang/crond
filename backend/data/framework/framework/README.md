# Script Framework 1.2.0

项目内置的轻量 PHP 脚本框架，无需 Composer。PHP 定时任务与 Origami 服务共用此框架；Shell 任务使用 Bash，可调用同一个项目数据 API。

`framework/` 提供通用的配置、日志和数据访问支持，`Task` 是定时任务的执行封装。无状态服务通过 `handle(Request $request)` 返回响应，同样使用公共配置、日志和数据接口。

根目录 `bootstrap.php` 是统一入口，先加载 Composer 自动加载器，再加载此目录下的 `bootstrap.php`；所有 PHP 任务和服务默认经过统一入口，脚本无需重复 require。

- `settings.php`：项目配置，`Config::get('app.name', 'default')` 按点分路径读取。
- `Config::env('CROND_PROJECT_ID')`：读取执行环境。执行环境不继承后台密钥。
- `Logger::info('message', ['key' => 'value'])` / `error()`：JSON 日志，写入标准错误并由后台持久化，不污染服务响应。
- `Http::get/post/put/patch/delete/request`：HTTP 客户端，支持查询参数、请求头、JSON、表单和超时；任务与服务均可调用。
- `Task::run('name', function () { ... })`：记录开始、结束、耗时和失败；异常继续抛出，任务状态会标记失败。
- `Database::collection('name')->insert/find/update/delete`：项目内持久化数据 API；使用前先在数据存储模块创建集合。

`examples/task.php` 与 `examples/service.php` 可复制到任务或服务编辑器，不会自行调度。

每次执行的工作目录都会清理，请用 Database 存储需要保留的数据。任务不重叠、超时和调度由平台负责。

所有用户和项目共用服务器默认框架。框架文档页面只读，源码及依赖配置由服务器管理员统一维护。

## 命名空间与自动加载

框架类位于 `Framework\` 命名空间，包括 `Config`、`Logger`、`Task`、`Http`、`HttpResponse`、`Request`、`Database` 和 `CrondCollection`。
PHP 任务可以通过 `use Framework\Config;` 等导入。Origami 无状态服务示例使用 `\Framework\Config::get('app.name')` 这样的全限定类名，避免导入别名解析歧义。
旧的全局类名仍兼容；新代码建议使用全限定类名，避免业务类同名冲突。

```php
<?php
namespace App\Services;

function handle(\Framework\Request $request)
{
    return ['app' => \Framework\Config::get('app.name'), 'message' => $request->input('message')];
}
```

服务代码独立加载，支持 `namespace App\Services;`，`handle` 定义在该命名空间中。
每份服务代码使用一个处理器命名空间。Origami 当前使用分号形式的 namespace 声明，花括号形式存在引擎兼容性问题。PHP 任务同样可以声明自己的命名空间。

`App\` 下的业务类按目录自动加载：例如 `App\Domain\Message` 对应 `src/Domain/Message.php`。
此映射无需安装 Composer 即可使用；框架仍优先加载存在的 Composer 自动加载器，供第三方依赖使用。
框架文件由服务器管理员维护，业务类通过服务器源文件或现有业务文件接口部署，文档页面仅供查看。

## HTTP 请求

```php
$response = Http::get('https://example.com/api/items', [
    'query' => ['page' => 1],
    'headers' => ['Accept' => 'application/json'],
    'timeout' => 10
]);
$data = $response->throwIfFailed()->json();
$created = Http::post('https://example.com/api/items', ['name' => 'demo'])->json();
```

`get($url, $options)`、`delete($url, $options)`；`post/put/patch($url, $data, $options)` 的数组数据按 JSON 发送，字符串按原始正文发送。通用入口为 `request($method, $url, $options)`，也支持 HEAD 等方法。

选项：`query` 为查询参数，`headers` 为请求头，`timeout` 为正数秒数；`json`、`form`、`body` 分别发送 JSON、表单和原始正文，三者只能选一项，不能与 `$data` 重复指定。默认超时为 20 秒，可用 `settings.php` 中的 `http.timeout` 修改。

返回 `HttpResponse`：`status()`、`headers()`、`header($name, $default)`、`body()`、`json()`、`successful()`。响应头名称不区分大小写，`headers()` 保留每个头的值数组；`header()` 用逗号连接多个值。`json()` 返回关联数组或 JSON 标量，无效 JSON 抛出异常。

HTTP 4xx/5xx 仍可读取响应，调用 `throwIfFailed()` 时抛出异常；网络失败和超时直接抛出 `RuntimeException`。不自动跟随重定向，3xx 响应由调用者处理。仅支持 HTTP/HTTPS，HTTPS 默认验证证书，不自动携带平台 API 凭据。

PHP 任务与服务均通过 Origami 调用此接口，无需 Composer 或 cURL 扩展。完整示例见 `examples/http.php`。
