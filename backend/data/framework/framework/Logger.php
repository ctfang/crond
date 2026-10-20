<?php
namespace Framework;

use RuntimeException;

class Logger
{
    private static $stream = null;
    public static function write($level, $message, array $context = [])
    {
        $line = json_encode([
            'time' => time(),
            'level' => $level,
            'message' => $message,
            'context' => $context
        ], JSON_UNESCAPED_UNICODE);
        // stderr is captured as a log and never mixed into service JSON responses.
        // Resolve the original class explicitly when called through the global alias.
        if (\Framework\Logger::$stream === null) \Framework\Logger::$stream = fopen('php://stderr', 'w');
        if (\Framework\Logger::$stream === false) {
            throw new RuntimeException('Cannot open log stream');
        }
        fwrite(\Framework\Logger::$stream, $line . "\n");
    }

    public static function info($message, array $context = [])
    {
        self::write('info', $message, $context);
    }

    public static function error($message, array $context = [])
    {
        self::write('error', $message, $context);
    }
}
