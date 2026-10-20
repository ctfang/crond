<?php
// The single entry for PHP tasks and Origami services.
$autoload = __DIR__ . '/vendor/autoload.php';
if (file_exists($autoload)) require_once $autoload;
require_once __DIR__ . '/framework/bootstrap.php';

// Business classes also load when no Composer vendor directory has been installed.
spl_autoload_register(function ($class) {
    $prefix = 'App\\';
    if (strpos($class, $prefix) !== 0) return;
    $relative = substr($class, strlen($prefix));
    if (strpos($relative, '..') !== false || strpos($relative, '/') !== false) return;
    $file = __DIR__ . '/src/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($file)) require_once $file;
});
