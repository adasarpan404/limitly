-- Concurrency limiter using a lease-based sorted set
-- KEYS[1] = concurrency key
-- ARGV[1] = limit
-- ARGV[2] = ttl (seconds)
-- ARGV[3] = slot id
-- ARGV[4] = current timestamp (milliseconds)

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local slot_id = ARGV[3]
local now = tonumber(ARGV[4])
local expires_at = now + (ttl * 1000)

redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
local current = redis.call('ZCARD', key)

if current < limit then
    redis.call('ZADD', key, expires_at, slot_id)
    redis.call('PEXPIRE', key, ttl * 1000)
    local remaining = limit - current - 1
    local reset = math.ceil(expires_at / 1000)
    return {1, limit, remaining, reset, 0, slot_id}
else
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local reset
    if #oldest > 0 then
        reset = math.ceil(tonumber(oldest[2]) / 1000)
    else
        reset = math.ceil(expires_at / 1000)
    end
    local retry_after = math.max(1, reset - math.ceil(now / 1000))
    return {0, limit, 0, reset, retry_after, ''}
end