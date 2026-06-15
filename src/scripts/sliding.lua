-- Sliding window rate limiter using sorted sets
-- KEYS[1] = rate limit key
-- ARGV[1] = limit
-- ARGV[2] = window (seconds)
-- ARGV[3] = current timestamp (milliseconds)
-- ARGV[4] = unique request id

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local request_id = ARGV[4]

local window_start = now - (window * 1000)

-- Remove entries outside the sliding window
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

local current_count = redis.call('ZCARD', key)

if current_count < limit then
    redis.call('ZADD', key, now, request_id)
    redis.call('PEXPIRE', key, window * 1000)
    current_count = current_count + 1
    local remaining = limit - current_count
    local reset = math.ceil((now + (window * 1000)) / 1000)
    return {1, limit, remaining, reset, 0}
else
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local reset
    if #oldest > 0 then
        reset = math.ceil((tonumber(oldest[2]) + (window * 1000)) / 1000)
    else
        reset = math.ceil((now + (window * 1000)) / 1000)
    end
    local retry_after = math.max(1, reset - math.ceil(now / 1000))
    return {0, limit, 0, reset, retry_after}
end