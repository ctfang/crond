<?php
namespace Framework;

use RuntimeException;

/** Project-scoped database helper supplied to each Crond PHP execution. */
class Database
{
    public static function request($method, $path, $payload = null)
    {
        $url = getenv('CROND_API_URL') . $path;
        $token = getenv('CROND_API_TOKEN');
        $headers = "Authorization: Bearer " . $token . "\r\nContent-Type: application/json\r\n";
        $options = ['http' => [
            'method' => $method,
            'header' => $headers,
            'timeout' => 20,
            'ignore_errors' => true,
        ]];
        if ($payload !== null) $options['http']['content'] = json_encode($payload);
        $body = file_get_contents($url, false, stream_context_create($options));
        if ($body === false) throw new RuntimeException('Cannot connect to Crond data API');
        $result = json_decode($body, true);
        if (isset($result['error'])) throw new RuntimeException($result['error']);
        return $result;
    }
    public static function collection($name)
    {
        foreach (self::request('GET', '/collections') as $collection) {
            if ($collection['name'] === $name || $collection['id'] === $name) {
                return new CrondCollection($collection['id']);
            }
        }
        throw new RuntimeException('Collection not found: ' . $name);
    }
}
class CrondCollection
{
    private $id;
    public function __construct($id) { $this->id = $id; }
    private function path() { return '/collections/' . rawurlencode($this->id) . '/records'; }
    public function insert(array $data) { return Database::request('POST', $this->path(), ['data' => $data]); }
    public function find(array $filter = [])
    {
        $results = [];
        foreach (Database::request('GET', $this->path()) as $record) {
            $matches = true;
            foreach ($filter as $key => $value) {
                if (!array_key_exists($key, $record['data']) || $record['data'][$key] !== $value) { $matches = false; break; }
            }
            if ($matches) $results[] = $record['data'];
        }
        return $results;
    }
    public function update($id, array $data) { return Database::request('PATCH', $this->path() . '/' . rawurlencode($id), ['data' => $data]); }
    public function delete($id) { return Database::request('DELETE', $this->path() . '/' . rawurlencode($id)); }
}
