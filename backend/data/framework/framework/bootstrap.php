<?php
// Loaded before every PHP task and Origami service when selected as project entry.
require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Http.php';
require_once __DIR__ . '/Request.php';
require_once __DIR__ . '/Logger.php';
require_once __DIR__ . '/Task.php';
require_once __DIR__ . '/../src/Database.php';

\Framework\Config::load(require __DIR__ . '/settings.php');
date_default_timezone_set(\Framework\Config::get('app.timezone', 'Asia/Shanghai'));

// Retain existing task scripts while new code imports Framework classes explicitly.
foreach (['Config', 'Http', 'HttpResponse', 'Logger', 'Task', 'Database', 'CrondCollection'] as $class) {
    if (!class_exists($class, false)) class_alias('Framework\\' . $class, $class);
}

// A concrete subclass keeps Request type hints compatible in both execution engines.
if (!class_exists('Request', false)) {
    class Request extends \Framework\Request {}
}
