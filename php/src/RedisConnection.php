<?php

declare(strict_types=1);

namespace BullMQ;

use Predis\Client as PredisClient;

/**
 * Manages Redis connections for BullMQ.
 */
class RedisConnection
{
    public const MINIMUM_VERSION = '5.0.0';
    public const RECOMMENDED_MINIMUM_VERSION = '6.2.0';

    private PredisClient $client;
    private ?string $version = null;

    /**
     * Create a new Redis connection.
     *
     * @param array<string, mixed>|PredisClient|string $options Connection options, Predis client, or Redis URI
     */
    public function __construct(array|PredisClient|string $options = [])
    {
        if ($options instanceof PredisClient) {
            $this->client = $options;
        } elseif (is_string($options)) {
            $this->client = new PredisClient($options);
        } else {
            $defaultOptions = [
                'host' => 'localhost',
                'port' => 6379,
                'database' => 0,
                'password' => null,
                'username' => null,
            ];

            $finalOptions = array_merge($defaultOptions, $options);
            $this->client = new PredisClient($finalOptions);
        }
    }

    /**
     * Get the underlying Redis client.
     */
    public function getClient(): PredisClient
    {
        return $this->client;
    }

    /**
     * Close the Redis connection.
     */
    public function close(): void
    {
        $this->client->disconnect();
    }

    /**
     * Get the Redis server version.
     *
     * @return string The Redis version
     * @throws \RuntimeException If the version cannot be retrieved
     */
    public function getRedisVersion(): string
    {
        if ($this->version !== null) {
            return $this->version;
        }

        $info = $this->client->info('server');
        
        if (!isset($info['Server']['redis_version'])) {
            throw new \RuntimeException('Could not retrieve Redis version');
        }

        $this->version = $info['Server']['redis_version'];

        // Check eviction policy
        $memoryInfo = $this->client->info('memory');
        $maxmemoryPolicy = $memoryInfo['Memory']['maxmemory_policy'] ?? 'noeviction';
        
        if ($maxmemoryPolicy !== 'noeviction') {
            trigger_error(
                "IMPORTANT! Eviction policy is {$maxmemoryPolicy}. It should be \"noeviction\"",
                E_USER_WARNING
            );
        }

        return $this->version;
    }

    /**
     * Check if the Redis version is lower than the specified version.
     */
    public static function isVersionLowerThan(string $version, string $than): bool
    {
        return version_compare($version, $than, '<');
    }
}
