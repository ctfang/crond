<?php
namespace App\Services;

// Copy this content into an Origami service. The project entry loads the framework.
function handle(\Framework\Request $request)
{
    \Framework\Logger::info('Service invoked', ['method' => $request->method]);
    return [
        'app' => \Framework\Config::get('app.name'),
        'message' => $request->input('message', 'Hello from Script Framework')
    ];
}
