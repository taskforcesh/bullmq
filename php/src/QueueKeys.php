<?php

declare(strict_types=1);

namespace BullMQ;

/**
 * Handles queue key generation.
 */
class QueueKeys
{
    private string $prefix;

    public function __construct(string $prefix = 'bull')
    {
        $this->prefix = $prefix;
    }

    /**
     * Get the prefix used for keys.
     */
    public function getPrefix(): string
    {
        return $this->prefix;
    }

    /**
     * Get all keys for a queue.
     *
     * @param string $name Queue name
     * @return array<string, string> Array of key names to full key paths
     */
    public function getKeys(string $name): array
    {
        $names = [
            '',
            'active',
            'wait',
            'waiting-children',
            'paused',
            'completed',
            'failed',
            'delayed',
            'repeat',
            'stalled',
            'limiter',
            'prioritized',
            'id',
            'stalled-check',
            'meta',
            'pc',
            'events',
            'marker',
            'de',
        ];

        $keys = [];
        foreach ($names as $nameType) {
            $keys[$nameType] = $this->toKey($name, $nameType);
        }

        return $keys;
    }

    /**
     * Generate a key for a specific type.
     *
     * @param string $name Queue name
     * @param string $type Key type
     */
    public function toKey(string $name, string $type): string
    {
        return "{$this->getQueueQualifiedName($name)}:{$type}";
    }

    /**
     * Get the fully qualified queue name.
     *
     * @param string $name Queue name
     */
    public function getQueueQualifiedName(string $name): string
    {
        return "{$this->prefix}:{$name}";
    }
}
