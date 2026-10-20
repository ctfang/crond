<?php
namespace Framework;

use Throwable;

class Task
{
    public static function run($name, $callback)
    {
        $started = microtime(true);
        Logger::info('Task started', ['task' => $name]);
        try {
            $result = $callback();
            Logger::info('Task completed', [
                'task' => $name,
                'duration_ms' => (microtime(true) - $started) * 1000
            ]);
            return $result;
        } catch (Throwable $error) {
            Logger::error('Task failed', [
                'task' => $name,
                'error' => $error->getMessage()
            ]);
            // Preserve failure status for the scheduler and execution log.
            throw $error;
        }
    }
}
