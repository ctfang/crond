<?php
namespace App\Jobs;

// Copy into a task, or use the same calls inside a service's handle() function.
$response = \Framework\Http::get('https://example.com/api/items', [
    'query' => ['page' => 1],
    'headers' => ['Accept' => 'application/json'],
    'timeout' => 10
]);
$data = $response->throwIfFailed()->json();
\Framework\Logger::info('HTTP request completed', ['status' => $response->status(), 'data' => $data]);

// Arrays are sent as JSON; strings are sent as a raw body.
// $created = \Framework\Http::post('https://example.com/api/items', ['name' => 'demo'])->throwIfFailed()->json();
// $form = \Framework\Http::request('POST', 'https://example.com/login', ['form' => ['username' => 'demo']]);
