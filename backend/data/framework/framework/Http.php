<?php
namespace Framework;

use RuntimeException;
use InvalidArgumentException;

class Http
{
    public static function get($url, array $options = []) { return self::request('GET', $url, $options); }
    public static function post($url, $data = null, array $options = []) { return self::send('POST', $url, $data, $options); }
    public static function put($url, $data = null, array $options = []) { return self::send('PUT', $url, $data, $options); }
    public static function patch($url, $data = null, array $options = []) { return self::send('PATCH', $url, $data, $options); }
    public static function delete($url, array $options = []) { return self::request('DELETE', $url, $options); }

    private static function send($method, $url, $data, array $options)
    {
        if ($data !== null) {
            foreach (['json', 'form', 'body'] as $key) {
                if (array_key_exists($key, $options)) throw new InvalidArgumentException('Specify request data only once');
            }
            if (is_array($data)) $options['json'] = $data;
            else $options['body'] = $data;
        }
        return self::request($method, $url, $options);
    }

    public static function request($method, $url, array $options = [])
    {
        $method = strtoupper($method);
        if (!preg_match('/^[A-Z]+$/', $method)) throw new InvalidArgumentException('Invalid HTTP method');
        if (!preg_match('#^https?://#i', $url)) throw new InvalidArgumentException('HTTP URL must use http:// or https://');
        $timeout = isset($options['timeout']) ? $options['timeout'] : Config::get('http.timeout', 20);
        if (!is_numeric($timeout) || $timeout <= 0) throw new InvalidArgumentException('HTTP timeout must be positive');
        if (isset($options['query']) && count($options['query']) > 0) {
            $parts = explode('#', $url, 2);
            $separator = strpos($parts[0], '?') === false ? '?' : '&';
            $url = $parts[0] . $separator . http_build_query($options['query']);
            if (isset($parts[1])) $url .= '#' . $parts[1];
        }
        $headers = [];
        foreach (isset($options['headers']) ? $options['headers'] : [] as $name => $value) {
            if (!preg_match('/^[A-Za-z0-9!#$%&\x27*+.^_`|~-]+$/', $name) || strpos($value, "\r") !== false || strpos($value, "\n") !== false) {
                throw new InvalidArgumentException('Invalid HTTP header');
            }
            $headers[strtolower($name)] = (string) $value;
        }
        $body = '';
        $bodyCount = 0;
        foreach (['json', 'form', 'body'] as $key) {
            if (array_key_exists($key, $options)) $bodyCount++;
        }
        if ($bodyCount > 1) throw new InvalidArgumentException('Use only one of json, form or body');
        if (array_key_exists('json', $options)) {
            $body = json_encode($options['json']);
            if ($body === false) throw new InvalidArgumentException('Cannot encode HTTP JSON request');
            if (!isset($headers['content-type'])) $headers['content-type'] = 'application/json';
        } elseif (array_key_exists('form', $options)) {
            $body = http_build_query($options['form']);
            if (!isset($headers['content-type'])) $headers['content-type'] = 'application/x-www-form-urlencoded';
        } elseif (array_key_exists('body', $options)) {
            $body = (string) $options['body'];
        }
        // Origami uses the host HTTP client; native PHP uses its stream wrapper.
        if (function_exists('script_http_request')) {
            $result = json_decode(script_http_request($method, $url, json_encode($headers), base64_encode($body), (float) $timeout), true);
            if (isset($result['error'])) throw new RuntimeException($result['error']);
            return new HttpResponse($result['status'], $result['headers'], base64_decode($result['body']));
        }
        $lines = [];
        foreach ($headers as $name => $value) $lines[] = $name . ': ' . $value;
        $context = stream_context_create(['http' => [
            'method' => $method, 'header' => implode("\r\n", $lines), 'content' => $body,
            'timeout' => (float) $timeout, 'ignore_errors' => true, 'follow_location' => 0
        ]]);
        $content = @file_get_contents($url, false, $context);
        if ($content === false) throw new RuntimeException('HTTP request failed: ' . $method . ' ' . $url);
        $status = 0;
        $responseHeaders = [];
        foreach ($http_response_header as $line) {
            if (strpos($line, 'HTTP/') === 0) {
                $parts = explode(' ', $line, 3);
                $status = (int) $parts[1];
                $responseHeaders = [];
            } elseif (strpos($line, ':') !== false) {
                $parts = explode(':', $line, 2);
                $name = strtolower(trim($parts[0]));
                if (!isset($responseHeaders[$name])) $responseHeaders[$name] = [];
                $responseHeaders[$name][] = trim($parts[1]);
            }
        }
        return new HttpResponse($status, $responseHeaders, $content);
    }
}

class HttpResponse
{
    private $statusCode;
    private $responseHeaders;
    private $content;
    public function __construct($status, array $headers, $body)
    {
        $this->statusCode = $status;
        $this->responseHeaders = $headers;
        $this->content = $body;
    }
    public function status() { return $this->statusCode; }
    public function headers() { return $this->responseHeaders; }
    public function header($name, $default = null)
    {
        $name = strtolower($name);
        return isset($this->responseHeaders[$name]) ? implode(', ', $this->responseHeaders[$name]) : $default;
    }
    public function body() { return $this->content; }
    public function successful() { return $this->statusCode >= 200 && $this->statusCode < 300; }
    public function json()
    {
        $value = json_decode($this->content, true);
        if (json_last_error() !== 0) throw new RuntimeException('HTTP response is not valid JSON');
        return $value;
    }
    public function throwIfFailed()
    {
        if ($this->statusCode >= 400) throw new RuntimeException('HTTP request returned status ' . $this->statusCode);
        return $this;
    }
}
