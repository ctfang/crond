<?php
namespace Framework;

class Config
{
    private static $values = [];
    public static function load(array $values) { self::$values = $values; }
    public static function get($key, $default = null)
    {
        $value = self::$values;
        foreach (explode('.', $key) as $part) {
            if (!is_array($value) || !array_key_exists($part, $value)) return $default;
            $value = $value[$part];
        }
        return $value;
    }
    public static function env($name, $default = null)
    {
        $value = getenv($name);
        return $value === false || $value === '' ? $default : $value;
    }
}
