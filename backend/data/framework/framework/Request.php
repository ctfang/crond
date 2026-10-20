<?php
namespace Framework;

class Request
{
    public $method;
    public $query;
    public $headers;
    public $body;
    public function __construct($input) { foreach ($input as $key => $value) { $this->$key = $value; } }
    public function json() { return json_decode($this->body, true); }
    public function input($key, $default = null) { $body = $this->json() ?? []; return $body[$key] ?? $this->query[$key][0] ?? $default; }
}
