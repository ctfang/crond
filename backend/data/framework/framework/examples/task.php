<?php
namespace App\Jobs;

use Framework\Task;
use Framework\Logger;
use Framework\Config;
use Framework\Database;

// Copy this content into a PHP scheduled task. The project entry loads the framework.
Task::run('example', function () {
    Logger::info('Hello from scheduled task', [
        'app' => Config::get('app.name'),
        'project' => Config::env('CROND_PROJECT_ID')
    ]);
    // After creating a collection named task_runs in Data Store:
    // Database::collection('task_runs')->insert(['message' => 'Task completed']);
});
